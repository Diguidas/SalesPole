import {
  BadGatewayException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod, VendedorLogado } from '../auth/vendedores.service';
import { SapClient } from '../sap/sap.client';
import { SapCancelarResp, SapCriarPedidoResp } from '../sap/sap.types';
import { SUPABASE } from '../supabase/supabase.module';
import { classificar, Desfecho, MAX_TENTATIVAS, OrdemSap, proximaTentativa } from './pedido.desfecho';
import { conferirPreco, tabelaDoItem, type DadosProdutoSrv, type LinhaPrecoSrv } from './pedido.preco';
import { aposCorte, feriadosDoLocal, type FeriadoRow } from './pedido.entrega';
import { descontoLiberadoPeloIncentivo, incentivoAplicavel, type IncentivoRow } from './pedido.incentivo';
import { avaliarCombosSrv, conferirBrindes, type ComboRow } from './pedido.combo';
import { hashItens, PedidoEntrada, validarPedido } from './pedido.validacao';

/** Brindes de combo com o mesmo tipo de bonificacao e centro de custo: viram UMA ordem de bonificacao (Z011) no mesmo envio da venda. */
export interface PlanoBonificacao {
  tipo_bonificacao: string;
  centro_custo: string;
  combos: string[];
  itens: Array<{ produto: string; unidade: string; quantidade: string; preco: string | null }>;
}

export interface PedidoRow {
  id: string;
  codigo: string;
  cod_vendedor: string;
  cod_cliente: string;
  criado_no_app_em: string;
  dt_entrega: string | null;
  cond_pagamento: string | null;
  ordem_compra_cliente: string | null;
  endereco_entrega: string | null;
  observacao: string | null;
  tipo: string;
  tipo_bonificacao: string | null;
  centro_custo: string | null;
  justificativa: string | null;
  motivo_rejeicao: string | null;
  itens: Array<{ produto: string; unidade: string; quantidade: string; preco: string | null; preco_tabela?: string | null; desconto?: number | null; brinde?: boolean; combo_id?: string | null; tipo_bonificacao?: string | null; centro_custo?: string | null }>;
  itens_hash: string;
  status: string;
  ordens_sap: OrdemSap[];
  erro: string | null;
  tentativas: number;
}

export interface ResultadoPush {
  id: string | null;
  /** recebido | aguardando_aprovacao | aprovado | rejeitado | enviando | enviado | parcial | erro | invalido | conflito */
  status: string;
  codigo?: string;
  ordens?: OrdemSap[];
  erro?: string | null;
  erros?: string[];
  dt_entrega?: string | null;
  tentativas?: number;
  /** pedidos recentes do mesmo cliente com os mesmos itens (aviso; nao bloqueia) */
  possivel_duplicidade?: Array<{ codigo: string; recebido_em: string }>;
}

const dataSP = (iso: string) =>
  new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

@Injectable()
export class PedidosService {
  private readonly logger = new Logger(PedidosService.name);

  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly sap: SapClient,
  ) {}

  /**
   * Recebe UM pedido do app. Idempotente pelo id (UUID do celular): reenviar o
   * mesmo pedido devolve o estado atual, sem criar outro. `prazoAte` (epoch ms)
   * limita o tempo gasto chamando o SAP dentro da requisicao; passado o prazo o
   * pedido fica 'recebido' e o job de retentativa envia.
   */
  async receber(v: VendedorLogado, raw: unknown, prazoAte: number): Promise<ResultadoPush> {
    const val = validarPedido(raw);
    if (!val.ok) return { id: val.id, status: 'invalido', erros: val.erros };
    const p = val.pedido;

    if (!v.rota) return { id: p.id, status: 'invalido', erros: ['Sincronize antes de enviar pedidos'] };

    const codCliente = normCod(p.codCliente);
    const { data: naCarteira, error: eCart } = await this.sb
      .from('rota_clientes')
      .select('cod_cliente')
      .eq('rota', v.rota)
      .eq('cod_cliente', codCliente)
      .limit(1);
    if (eCart) throw eCart;
    if (!naCarteira?.length) return { id: p.id, status: 'invalido', erros: ['Cliente fora da carteira do vendedor'] };

    // ja recebido antes? (reenvio: so devolve o estado)
    let row = await this.buscar(p.id);
    if (row && row.cod_vendedor !== v.codVendedor) {
      return { id: p.id, status: 'conflito', erros: ['id ja usado por outro vendedor'] };
    }

    let novo = false;
    if (!row) {
      novo = true;
      const errosBonif = await this.conferirBonificacao(p);
      if (errosBonif.length) return { id: p.id, status: 'invalido', erros: errosBonif };
      const conf = await this.conferirDescontos(p, codCliente, v.codVendedor);
      if (conf.erros.length) return { id: p.id, status: 'invalido', erros: conf.erros };
      // as linhas de brinde passam a carregar o tipo e o centro de custo da bonificacao (o ABAP cria a ordem Z011 por grupo)
      if (conf.itens) p.itens = conf.itens;
      await this.inserir(v, p, codCliente);
      row = await this.buscar(p.id);
      if (!row) throw new Error('pedido nao encontrado apos inserir');
      await this.evento(p.id, 'recebido', { itens: p.itens.length, vendedor: v.codVendedor, tipo: p.tipo });
      if (p.tipo === 'bonificacao') await this.evento(p.id, 'aguardando_aprovacao', { tipo_bonificacao: p.tipoBonificacao, centro_custo: p.centroCusto });
    }

    if (row.status !== 'enviado' && Date.now() < prazoAte) {
      row = await this.tentarEnviar(row.id);
    }

    const resultado = this.visao(row);
    if (novo && !p.duplicadoDe) resultado.possivel_duplicidade = await this.possiveisDuplicados(row);
    return resultado;
  }

  /**
   * Trava de desconto: o preco de cada item nao pode ficar abaixo de tabela x (1 - desconto_max).
   * A tabela e a que o servidor tem HOJE (lista+grupo do cliente). Se nao da para calcular a tabela
   * (sem preco vigente, unidade sem conversao, cliente sem area) o item nao e barrado: pedido feito
   * offline com tabela antiga nao pode ser recusado por falta de dado.
   */
  /** Bonificacao: o tipo e o centro de custo precisam existir (e estar ativos) no cadastro do painel. */
  async conferirBonificacao(p: PedidoEntrada): Promise<string[]> {
    if (p.tipo !== 'bonificacao') return [];
    const [{ data: t, error: eT }, { data: c, error: eC }] = await Promise.all([
      this.sb.from('bonificacao_tipos').select('codigo').eq('codigo', p.tipoBonificacao).eq('ativo', true).maybeSingle(),
      this.sb.from('centros_custo').select('codigo').eq('codigo', p.centroCusto).eq('ativo', true).maybeSingle(),
    ]);
    if (eT) throw eT;
    if (eC) throw eC;
    const erros: string[] = [];
    if (!t) erros.push(`tipo de bonificacao ${p.tipoBonificacao} nao cadastrado. Sincronize para atualizar a lista.`);
    if (!c) erros.push(`centro de custo ${p.centroCusto} nao cadastrado. Sincronize para atualizar a lista.`);
    return erros;
  }

  async conferirDescontos(p: PedidoEntrada, codCliente: string, codVendedor: string): Promise<{ erros: string[]; itens?: PedidoEntrada['itens'] }> {
    const comPreco = p.itens.filter((i) => i.preco !== null && !i.brinde);
    if (!comPreco.length && !p.itens.some((i) => i.brinde)) return { erros: [] };

    const { data: cli, error: eCli } = await this.sb.from('clientes').select('areas').eq('cod_cliente', codCliente).maybeSingle();
    if (eCli) throw eCli;
    const areas = ((cli as { areas?: unknown } | null)?.areas ?? []) as Array<{
      tipo_material?: string; lista_preco?: { codigo?: string } | null; rede?: { codigo?: string } | null;
      canal?: { codigo?: string } | null; escritorio?: { codigo?: string } | null;
    }>;

    const codigos = [...new Set(p.itens.map((i) => i.produto))];
    const { data: prods, error: eProd } = await this.sb.from('produtos').select('cod_produto,tipo_material,dados').in('cod_produto', codigos);
    if (eProd) throw eProd;
    const porProduto = new Map(
      ((prods ?? []) as Array<{ cod_produto: string; tipo_material: string | null; dados: DadosProdutoSrv | null }>).map((x) => [x.cod_produto, x]),
    );

    // desconto por incentivo: libera desconto alem do maximo da lista (regras do painel, por quantidade)
    const { data: inc, error: eInc } = await this.sb
      .from('incentivos_desconto')
      .select('id,cod_produto,escopo,escopo_valor,linha_id,grupo_id,categoria_id,marca,qtd_minima,desconto_pct,desconto_extra_max_pct,vigencia_ini,vigencia_fim,ativo')
      .eq('ativo', true); // tabela pequena: o filtro por produto/escopo e feito em incentivoAplicavel
    if (eInc) throw eInc;
    const incentivos = (inc ?? []) as IncentivoRow[];
    const ctxInc = {
      codCliente,
      codVendedor,
      canais: [...new Set(areas.map((a) => a.canal?.codigo).filter((x): x is string => !!x))],
      escritorios: [...new Set(areas.map((a) => a.escritorio?.codigo).filter((x): x is string => !!x))],
      hoje: dataSP(new Date().toISOString()),
    };

    // combos (condicao no pedido -> brinde / desconto): o brinde enviado precisa caber no que os combos do pedido dao
    const [{ data: cmb, error: eCmb }, { data: cmbItens, error: eCmbI }] = await Promise.all([
      this.sb
        .from('combos')
        .select('id,nome,escopo,escopo_valor,beneficio,brinde_cod_produto,brinde_qtd,tipo_bonificacao,centro_custo,desconto_pct,desconto_extra_max_pct,repete,max_repeticoes,vigencia_ini,vigencia_fim,ativo')
        .eq('ativo', true),
      this.sb.from('combo_itens').select('combo_id,alvo_tipo,alvo_valor,qtd_minima'),
    ]);
    if (eCmb) throw eCmb;
    if (eCmbI) throw eCmbI;
    const combos = ((cmb ?? []) as Array<Omit<ComboRow, 'itens'>>).map((c) => ({
      ...c,
      itens: ((cmbItens ?? []) as Array<{ combo_id: string; alvo_tipo: string; alvo_valor: string; qtd_minima: number }>).filter((x) => x.combo_id === c.id),
    }));
    const classificacoes = Object.fromEntries([...porProduto].map(([k, x]) => [k, x.dados?.classificacao]));
    const doCombo = avaliarCombosSrv(
      combos,
      p.itens.filter((i) => !i.brinde).map((i) => ({ produto: i.produto, quantidade: Number(i.quantidade) })),
      ctxInc,
      classificacoes,
    );
    const brindesDoPedido = p.itens.filter((i) => i.brinde);
    const errosBrinde = conferirBrindes(brindesDoPedido.map((i) => ({ produto: i.produto, quantidade: Number(i.quantidade) })), doCombo);
    if (brindesDoPedido.length && p.tipo === 'bonificacao') errosBrinde.push('combo nao vale em pedido de bonificacao');
    const plano = this.planoDaBonificacao(brindesDoPedido, doCombo.brindesPorCombo, errosBrinde);
    const itensFinais = plano.length ? this.itensComBonificacao(p.itens, plano) : undefined;

    const pltyps = [...new Set(areas.map((a) => a.lista_preco?.codigo).filter((x): x is string => !!x))];
    if (!pltyps.length) return { erros: errosBrinde, itens: itensFinais };
    const [{ data: g, error: eG }, { data: l, error: eL }] = await Promise.all([
      this.sb.from('precos_grupo').select('pltyp,kdgrp,cod_produto,kbetr,kpein,kmein,datab,datbi,desconto_max').in('cod_produto', codigos).in('pltyp', pltyps),
      this.sb.from('precos_lista').select('pltyp,cod_produto,kbetr,kpein,kmein,datab,datbi,desconto_max').in('cod_produto', codigos).in('pltyp', pltyps),
    ]);
    if (eG) throw eG;
    if (eL) throw eL;
    type Base = LinhaPrecoSrv & { pltyp: string; cod_produto: string; kdgrp?: string };
    const grupos = (g ?? []) as Base[];
    const listas = (l ?? []) as Base[];

    const hoje = dataSP(new Date().toISOString());
    const erros: string[] = [...errosBrinde];
    for (const i of comPreco) {
      const prod = porProduto.get(i.produto);
      if (!prod) continue;
      const tipo = prod.tipo_material === 'FERT' ? 'FERT' : prod.tipo_material === 'HAWA' || prod.tipo_material === 'ZVAR' ? 'HAWA' : null;
      const area = areas.find((a) => a.tipo_material === tipo);
      const pltyp = area?.lista_preco?.codigo;
      if (!pltyp) continue;
      const kdgrp = area?.rede?.codigo ?? '';
      const tabela = tabelaDoItem(
        grupos.filter((x) => x.cod_produto === i.produto && x.pltyp === pltyp && (x.kdgrp ?? '') === kdgrp),
        listas.filter((x) => x.cod_produto === i.produto && x.pltyp === pltyp),
        hoje,
        i.unidade,
        prod.dados ?? {},
      );
      if (!tabela) continue;
      const extraInc = descontoLiberadoPeloIncentivo(incentivoAplicavel(incentivos, i.produto, Number(i.quantidade), ctxInc, prod.dados?.classificacao));
      const dc = doCombo.descontoPorProduto[i.produto];
      // combo e incentivo no mesmo produto: vale o que libera mais desconto
      const extra = Math.max(extraInc, dc ? dc.pct + dc.extra : 0);
      const msg = conferirPreco(Number(i.preco), { ...tabela, descontoMax: tabela.descontoMax + extra });
      if (msg) erros.push(`produto ${i.produto}: ${msg}. Sincronize para atualizar os precos.`);
    }
    return { erros, itens: itensFinais };
  }

  /** Troca as linhas de brinde do pedido pelas do plano: uma por produto e grupo (tipo de bonificacao + centro de custo). */
  private itensComBonificacao(itens: PedidoEntrada['itens'], plano: PlanoBonificacao[]): PedidoEntrada['itens'] {
    const brindes = plano.flatMap((g) =>
      g.itens.map((i) => ({
        produto: i.produto, unidade: i.unidade, quantidade: i.quantidade, preco: null, preco_tabela: i.preco, desconto: 100,
        brinde: true, combo_id: null, tipo_bonificacao: g.tipo_bonificacao, centro_custo: g.centro_custo,
      })),
    );
    return [...itens.filter((i) => !i.brinde), ...brindes];
  }

  /**
   * Agrupa os brindes do pedido por (tipo de bonificacao, centro de custo) do combo que os deu. Cada grupo vira um
   * pedido de bonificacao automatico. Quantidade e preco (tabela, so informativo) vem das linhas de brinde do pedido.
   */
  private planoDaBonificacao(
    brindes: PedidoEntrada['itens'],
    grants: Array<{ comboNome: string; produto: string; quantidade: number; tipo_bonificacao: string | null; centro_custo: string | null }>,
    erros: string[],
  ): PlanoBonificacao[] {
    const restante = new Map<string, { qtd: number; unidade: string; preco: string | null }>();
    for (const b of brindes) {
      const a = restante.get(b.produto);
      restante.set(b.produto, { qtd: (a?.qtd ?? 0) + Number(b.quantidade), unidade: a?.unidade ?? b.unidade, preco: a?.preco ?? b.preco_tabela ?? null });
    }
    const grupos = new Map<string, PlanoBonificacao>();
    for (const g of grants) {
      const r = restante.get(g.produto);
      if (!r || r.qtd <= 0) continue;
      const q = Math.min(g.quantidade, r.qtd);
      if (!g.tipo_bonificacao || !g.centro_custo) {
        erros.push(`combo "${g.comboNome}" sem tipo/centro de custo de bonificacao: edite o combo no painel`);
        continue;
      }
      r.qtd -= q;
      const chave = `${g.tipo_bonificacao}|${g.centro_custo}`;
      const grupo = grupos.get(chave) ?? { tipo_bonificacao: g.tipo_bonificacao, centro_custo: g.centro_custo, combos: [], itens: [] };
      if (!grupo.combos.includes(g.comboNome)) grupo.combos.push(g.comboNome);
      const item = grupo.itens.find((i) => i.produto === g.produto);
      if (item) item.quantidade = String(Number(item.quantidade) + q);
      else grupo.itens.push({ produto: g.produto, unidade: r.unidade, quantidade: String(q), preco: r.preco });
      grupos.set(chave, grupo);
    }
    return [...grupos.values()];
  }

  /**
   * Cancela uma ordem do SAP a pedido do vendedor. So pode cancelar ordem da carteira dele, em um status que o
   * painel liberou (parametros.status_cancelaveis; vazio = desligado). O SAP ainda confere se ja foi faturada.
   * Toda tentativa fica em pedido_cancelamentos.
   */
  async cancelarOrdemSap(v: VendedorLogado, ordemRaw: string, motivo?: string | null, por?: string | null): Promise<{ status: 'cancelado'; ordem: string; mensagem: string }> {
    const ordem = (ordemRaw ?? '').trim();
    if (!/^\d{1,10}$/.test(ordem)) throw new UnprocessableEntityException('Numero de ordem invalido');
    if (!v.rota) throw new ForbiddenException('Sincronize antes de cancelar pedidos');

    const { data: par, error: eP } = await this.sb.from('parametros').select('valor').eq('chave', 'status_cancelaveis').maybeSingle();
    if (eP) throw eP;
    const liberados = (Array.isArray((par as { valor?: unknown } | null)?.valor) ? ((par as { valor: unknown[] }).valor) : [])
      .map((x) => String(x).trim().toLowerCase())
      .filter(Boolean);
    if (!liberados.length) throw new ForbiddenException('O cancelamento de pedidos pelo app nao esta habilitado');

    const { data: o, error: eO } = await this.sb.from('pedidos_sap').select('ordem, cod_cliente, status').eq('ordem', ordem).maybeSingle();
    if (eO) throw eO;
    const ordemRow = o as { ordem: string; cod_cliente: string; status: string | null } | null;
    if (!ordemRow) throw new NotFoundException('Pedido nao encontrado');

    const { data: naCarteira, error: eC } = await this.sb
      .from('rota_clientes').select('cod_cliente').eq('rota', v.rota).eq('cod_cliente', ordemRow.cod_cliente).limit(1);
    if (eC) throw eC;
    if (!naCarteira?.length) throw new ForbiddenException('Pedido fora da carteira do vendedor');

    const statusAntes = ordemRow.status ?? '';
    if (!liberados.includes(statusAntes.trim().toLowerCase())) {
      throw new ConflictException(`Pedido com status "${statusAntes || 'sem status'}" nao pode ser cancelado pelo app`);
    }

    const auditar = async (resultado: 'cancelado' | 'recusado' | 'erro', http: number, mensagens: unknown) => {
      const { error } = await this.sb.from('pedido_cancelamentos').insert({
        ordem, cod_vendedor: v.codVendedor, status_antes: statusAntes, motivo: motivo?.trim().slice(0, 300) || null, resultado, http, mensagens, por: por ?? null,
      });
      if (error) this.logger.warn(`auditoria do cancelamento da ordem ${ordem} nao gravada: ${error.message}`);
    };

    let r: { status: number; data: SapCancelarResp };
    try {
      r = await this.sap.postComStatus<SapCancelarResp>('cancelar_pedido', { codvendedor: v.codVendedor, ordem });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 500) : String(e);
      await auditar('erro', 0, [{ tipo: 'E', mensagem: msg }]);
      throw new BadGatewayException('O SAP nao respondeu. Tente de novo em instantes.');
    }

    const textos = [r.data.erro, ...(r.data.mensagens ?? []).map((m) => m.mensagem)].filter((x): x is string => !!x);
    const detalhe = textos.join(' ') || `Erro ${r.status} no SAP`;

    if (r.status === 200 && r.data.cancelado === 'true') {
      // o SAP recusa todos os itens: reflete ja no Supabase (o proximo sync confirma o status real)
      await this.sb.from('pedidos_sap').update({ status: 'Recusado' }).eq('ordem', ordem);
      await auditar('cancelado', r.status, r.data.mensagens ?? []);
      this.logger.log(`Ordem ${ordem} cancelada por ${v.codVendedor} (status antes: ${statusAntes})`);
      return { status: 'cancelado', ordem, mensagem: 'Pedido cancelado.' };
    }

    await auditar(r.status === 409 || r.status === 403 || r.status === 404 ? 'recusado' : 'erro', r.status, r.data.mensagens ?? [r.data.erro ?? null]);
    if (r.status === 409) throw new ConflictException(detalhe);
    if (r.status === 403) throw new ForbiddenException(detalhe);
    if (r.status === 404) throw new NotFoundException(detalhe);
    if (r.status === 422) throw new UnprocessableEntityException(detalhe);
    throw new BadGatewayException(detalhe);
  }

  /** Vendedor pede para reenviar um pedido em 'erro' (depois de corrigir o problema). */
  async reenviar(v: VendedorLogado, id: string): Promise<ResultadoPush> {
    const row = await this.buscar(id);
    if (!row || row.cod_vendedor !== v.codVendedor) throw new NotFoundException('Pedido nao encontrado');
    if (row.status !== 'erro') return this.visao(row);
    return this.visao(await this.tentarEnviar(id, true));
  }

  /**
   * Uma tentativa de envio ao SAP. A reserva e atomica no banco: se outro
   * processo ja esta enviando (ou o pedido ja foi enviado), devolve o estado atual.
   */
  async tentarEnviar(id: string, forcar = false): Promise<PedidoRow> {
    const { data, error } = await this.sb.rpc('fn_pedido_reservar', { p_id: id, p_forcar: forcar });
    if (error) throw new Error(`fn_pedido_reservar: ${error.message}`);
    const row = (data as PedidoRow[] | null)?.[0];
    if (!row) return (await this.buscar(id))!;

    const t0 = Date.now();
    let http = 0;
    let desfecho: Desfecho;
    let mensagens: unknown;
    try {
      const r = await this.sap.postComStatus<SapCriarPedidoResp>('criar_pedido', await this.corpoSap(row));
      http = r.status;
      mensagens = r.data.mensagens;
      desfecho = classificar(r.status, r.data);
      // venda criada: o brinde de combo segue como ORDEM DE BONIFICACAO do mesmo pedido (uma por tipo + centro de custo)
      const grupos = this.gruposBonificacao(row);
      if (desfecho.tipo === 'ok' && grupos.length) desfecho = await this.enviarBonificacoes(row, grupos, desfecho);
    } catch (e) {
      // rede, timeout, resposta que nao e JSON (ex.: pagina de erro/401 do SAP)
      desfecho = { tipo: 'transitorio', erro: e instanceof Error ? e.message.slice(0, 1000) : String(e) };
    }

    await this.aplicar(row, desfecho);
    await this.evento(row.id, 'tentativa_sap', {
      tentativa: row.tentativas,
      http,
      resultado: desfecho.tipo,
      ms: Date.now() - t0,
      mensagens,
    });
    this.logger.log(`Pedido ${row.codigo} (tentativa ${row.tentativas}): ${desfecho.tipo} em ${Date.now() - t0}ms`);

    return (await this.buscar(id))!;
  }

  // ---------------------------------------------------------------------

  /**
   * Feriados (nacional + estado + cidade do cliente) para o SAP nao marcar a entrega neles.
   * Se a consulta falhar, segue sem feriados: nao pode travar o envio do pedido.
   */
  private async feriadosDoCliente(row: PedidoRow): Promise<string[]> {
    try {
      const hoje = dataSP(new Date().toISOString());
      const { data: cli } = await this.sb.from('clientes').select('endereco').eq('cod_cliente', row.cod_cliente).maybeSingle();
      const end = ((cli as { endereco?: { uf?: string; cidade?: string } } | null)?.endereco ?? {}) as { uf?: string; cidade?: string };
      const { data } = await this.sb.from('feriados').select('data, uf, cidade').eq('ativo', true).gte('data', hoje);
      return feriadosDoLocal((data ?? []) as FeriadoRow[], end.uf, end.cidade).slice(0, 60);
    } catch (e) {
      this.logger.warn(`feriados nao consultados (${(e as Error).message}): seguindo sem eles`);
      return [];
    }
  }

  /** Campos comuns da venda e das ordens de bonificacao do combo. */
  private async corpoBase(row: PedidoRow) {
    return {
      codvendedor: row.cod_vendedor,
      codigocli: row.cod_cliente,
      codigo_interno: row.codigo, // sequencial de 7 digitos atribuido aqui no servidor
      dt_criacao: dataSP(row.criado_no_app_em),
      dt_entrega: row.dt_entrega ?? '',
      cond_pagamento: row.cond_pagamento ?? '',
      ordem_compra_cliente: row.ordem_compra_cliente ?? '',
      endereco_entrega: row.endereco_entrega ?? '',
      observacao: row.observacao ?? '',
      // pedido feito depois da hora de corte (17h) conta como do dia seguinte; entrega nunca cai em feriado
      apos_corte: aposCorte(row.criado_no_app_em) ? 'true' : 'false',
      feriados: await this.feriadosDoCliente(row),
    };
  }

  private async corpoSap(row: PedidoRow) {
    return {
      ...(await this.corpoBase(row)),
      // bonificacao: o SAP cria a ordem Z011 com tipo (ORD_REASON) e centro de custo. A justificativa NAO vai.
      tipo: row.tipo ?? 'venda',
      tipo_bonificacao: row.tipo === 'bonificacao' ? (row.tipo_bonificacao ?? '') : '',
      centro_custo: row.tipo === 'bonificacao' ? (row.centro_custo ?? '') : '',
      // o brinde de combo NAO vai na venda: vai na(s) ordem(ns) de bonificacao (ver enviarBonificacoes)
      itens: row.itens.filter((i) => !i.brinde).map((i) => ({
        produto: i.produto,
        unidade: i.unidade,
        quantidade: i.quantidade,
        preco: i.preco ?? '',
      })),
    };
  }

  /** Brindes de combo do pedido agrupados por (tipo de bonificacao + centro de custo), sempre na mesma ordem. */
  private gruposBonificacao(row: PedidoRow): Array<{ tipo: string; centro: string; itens: Array<{ produto: string; unidade: string; quantidade: string; preco: string }> }> {
    const mapa = new Map<string, { tipo: string; centro: string; itens: Array<{ produto: string; unidade: string; quantidade: string; preco: string }> }>();
    for (const i of row.itens.filter((x) => x.brinde)) {
      const tipo = i.tipo_bonificacao ?? '';
      const centro = i.centro_custo ?? '';
      const g = mapa.get(`${tipo}|${centro}`) ?? { tipo, centro, itens: [] };
      // preco = tabela (so informativo: a ordem de bonificacao nao cobra), como nas bonificacoes feitas a mao
      g.itens.push({ produto: i.produto, unidade: i.unidade, quantidade: i.quantidade, preco: i.preco_tabela ?? '' });
      mapa.set(`${tipo}|${centro}`, g);
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g);
  }

  /**
   * Cria no SAP a ordem de bonificacao de cada grupo de brindes, DEPOIS da venda. O codigo interno de cada uma e o do pedido
   * + B1, B2... (o SAP nao duplica por esse codigo, entao repetir o envio so cria a que falta). Se uma falhar, o pedido
   * fica 'parcial' com as ordens ja criadas e o job repete.
   */
  private async enviarBonificacoes(
    row: PedidoRow,
    grupos: ReturnType<PedidosService['gruposBonificacao']>,
    venda: Extract<Desfecho, { tipo: 'ok' }>,
  ): Promise<Desfecho> {
    const ordens = [...venda.ordens];
    const bonif = (os: OrdemSap[]) => os.map((o) => ({ ...o, bonificacao: true }));
    for (const [n, g] of grupos.entries()) {
      let d: Desfecho;
      try {
        const corpo = {
          ...(await this.corpoBase(row)),
          codigo_interno: `${row.codigo}B${n + 1}`,
          dt_entrega: venda.dtEntrega ?? row.dt_entrega ?? '', // a mesma data que o SAP deu para a venda
          ordem_compra_cliente: '',
          observacao: `Brinde do combo (pedido ${row.codigo})`,
          tipo: 'bonificacao',
          tipo_bonificacao: g.tipo,
          centro_custo: g.centro,
          itens: g.itens,
        };
        const r = await this.sap.postComStatus<SapCriarPedidoResp>('criar_pedido', corpo);
        d = classificar(r.status, r.data);
      } catch (e) {
        d = { tipo: 'transitorio', erro: e instanceof Error ? e.message.slice(0, 1000) : String(e) };
      }
      if (d.tipo === 'ok') {
        ordens.push(...bonif(d.ordens));
        continue;
      }
      if (d.tipo === 'parcial') ordens.push(...bonif(d.ordens));
      return { tipo: 'parcial', ordens, dtEntrega: venda.dtEntrega, erro: `Bonificacao do combo: ${d.erro}` };
    }
    return { tipo: 'ok', ordens, dtEntrega: venda.dtEntrega };
  }

  private async aplicar(row: PedidoRow, d: Desfecho) {
    const esgotou = row.tentativas >= MAX_TENTATIVAS;
    let upd: Record<string, unknown>;

    switch (d.tipo) {
      case 'ok':
        upd = {
          status: 'enviado',
          ordens_sap: d.ordens,
          erro: null,
          proxima_tentativa_em: null,
          enviado_sap_em: new Date().toISOString(),
          ...(d.dtEntrega ? { dt_entrega: d.dtEntrega } : {}),
        };
        break;
      case 'permanente':
        upd = { status: 'erro', erro: d.erro, proxima_tentativa_em: null };
        break;
      case 'parcial':
        upd = {
          status: esgotou ? 'erro' : 'parcial',
          ordens_sap: d.ordens,
          erro: esgotou ? `${d.erro} (esgotou ${MAX_TENTATIVAS} tentativas)` : d.erro,
          proxima_tentativa_em: esgotou ? null : proximaTentativa(row.tentativas),
          ...(d.dtEntrega ? { dt_entrega: d.dtEntrega } : {}),
        };
        break;
      case 'transitorio':
        upd = {
          status: esgotou ? 'erro' : 'recebido',
          erro: esgotou ? `${d.erro} (esgotou ${MAX_TENTATIVAS} tentativas)` : d.erro,
          proxima_tentativa_em: esgotou ? null : proximaTentativa(row.tentativas),
        };
        break;
    }

    const { error } = await this.sb.from('pedidos_app').update(upd).eq('id', row.id);
    if (error) throw new Error(`atualizar pedido ${row.id}: ${error.message}`);
  }

  private async inserir(v: VendedorLogado, p: PedidoEntrada, codCliente: string) {
    // "duplicar pedido": o original precisa existir e ser do mesmo vendedor; senao ignora o vinculo
    let duplicadoDe: string | null = null;
    if (p.duplicadoDe) {
      const orig = await this.buscar(p.duplicadoDe);
      if (orig && orig.cod_vendedor === v.codVendedor) duplicadoDe = orig.id;
    }

    const { error } = await this.sb.from('pedidos_app').upsert(
      {
        id: p.id,
        cod_vendedor: v.codVendedor,
        cod_cliente: codCliente,
        criado_no_app_em: p.criadoNoAppEm,
        dt_entrega: p.dtEntrega,
        cond_pagamento: p.condPagamento,
        ordem_compra_cliente: p.ordemCompraCliente,
        endereco_entrega: p.enderecoEntrega,
        observacao: p.observacao,
        tipo: p.tipo,
        tipo_bonificacao: p.tipoBonificacao,
        centro_custo: p.centroCusto,
        justificativa: p.justificativa,
        // bonificacao nao vai ao SAP sozinha: espera a aprovacao (mudar o status para 'aprovado')
        status: p.tipo === 'bonificacao' ? 'aguardando_aprovacao' : 'recebido',
        itens: p.itens,
        itens_hash: hashItens(codCliente, p.itens),
        duplicado_de: duplicadoDe,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (error) throw new Error(`inserir pedido: ${error.message}`);
  }

  private async possiveisDuplicados(row: PedidoRow) {
    const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data } = await this.sb
      .from('pedidos_app')
      .select('codigo, recebido_em')
      .eq('cod_cliente', row.cod_cliente)
      .eq('itens_hash', row.itens_hash)
      .neq('id', row.id)
      .gte('recebido_em', desde)
      .order('recebido_em', { ascending: false })
      .limit(5);
    return (data ?? []) as Array<{ codigo: string; recebido_em: string }>;
  }

  private async buscar(id: string): Promise<PedidoRow | null> {
    const { data, error } = await this.sb.from('pedidos_app').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`buscar pedido: ${error.message}`);
    return (data as PedidoRow | null) ?? null;
  }

  private async evento(pedidoId: string, tipo: string, detalhe: unknown) {
    const { error } = await this.sb.from('pedido_eventos').insert({ pedido_id: pedidoId, tipo, detalhe });
    if (error) this.logger.warn(`evento ${tipo} nao gravado: ${error.message}`);
  }

  private visao(row: PedidoRow): ResultadoPush {
    return {
      id: row.id,
      status: row.status,
      codigo: row.codigo,
      ordens: row.ordens_sap,
      erro: row.erro,
      dt_entrega: row.dt_entrega,
      tentativas: row.tentativas,
    };
  }
}
