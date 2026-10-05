import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod, VendedorLogado } from '../auth/vendedores.service';
import { SapClient } from '../sap/sap.client';
import { SapCriarPedidoResp } from '../sap/sap.types';
import { SUPABASE } from '../supabase/supabase.module';
import { classificar, Desfecho, MAX_TENTATIVAS, OrdemSap, proximaTentativa } from './pedido.desfecho';
import { conferirPreco, tabelaDoItem, type DadosProdutoSrv, type LinhaPrecoSrv } from './pedido.preco';
import { hashItens, PedidoEntrada, validarPedido } from './pedido.validacao';

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
  itens: Array<{ produto: string; unidade: string; quantidade: string; preco: string | null }>;
  itens_hash: string;
  status: string;
  ordens_sap: OrdemSap[];
  erro: string | null;
  tentativas: number;
}

export interface ResultadoPush {
  id: string | null;
  /** recebido | enviando | enviado | parcial | erro | invalido | conflito */
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
      const errosPreco = await this.conferirDescontos(p, codCliente);
      if (errosPreco.length) return { id: p.id, status: 'invalido', erros: errosPreco };
      await this.inserir(v, p, codCliente);
      row = await this.buscar(p.id);
      if (!row) throw new Error('pedido nao encontrado apos inserir');
      await this.evento(p.id, 'recebido', { itens: p.itens.length, vendedor: v.codVendedor });
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
  async conferirDescontos(p: PedidoEntrada, codCliente: string): Promise<string[]> {
    const comPreco = p.itens.filter((i) => i.preco !== null);
    if (!comPreco.length) return [];

    const { data: cli, error: eCli } = await this.sb.from('clientes').select('areas').eq('cod_cliente', codCliente).maybeSingle();
    if (eCli) throw eCli;
    const areas = ((cli as { areas?: unknown } | null)?.areas ?? []) as Array<{
      tipo_material?: string; lista_preco?: { codigo?: string } | null; rede?: { codigo?: string } | null;
    }>;

    const codigos = [...new Set(comPreco.map((i) => i.produto))];
    const { data: prods, error: eProd } = await this.sb.from('produtos').select('cod_produto,tipo_material,dados').in('cod_produto', codigos);
    if (eProd) throw eProd;
    const porProduto = new Map(
      ((prods ?? []) as Array<{ cod_produto: string; tipo_material: string | null; dados: DadosProdutoSrv | null }>).map((x) => [x.cod_produto, x]),
    );

    const pltyps = [...new Set(areas.map((a) => a.lista_preco?.codigo).filter((x): x is string => !!x))];
    if (!pltyps.length) return [];
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
    const erros: string[] = [];
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
      const msg = conferirPreco(Number(i.preco), tabela);
      if (msg) erros.push(`produto ${i.produto}: ${msg}. Sincronize para atualizar os precos.`);
    }
    return erros;
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
      const r = await this.sap.postComStatus<SapCriarPedidoResp>('criar_pedido', this.corpoSap(row));
      http = r.status;
      mensagens = r.data.mensagens;
      desfecho = classificar(r.status, r.data);
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

  private corpoSap(row: PedidoRow) {
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
      itens: row.itens.map((i) => ({
        produto: i.produto,
        unidade: i.unidade,
        quantidade: i.quantidade,
        preco: i.preco ?? '',
      })),
    };
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
