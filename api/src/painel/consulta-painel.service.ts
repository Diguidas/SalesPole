import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { PedidosService } from '../pedidos/pedidos.service';
import { SUPABASE } from '../supabase/supabase.module';
import { SyncService } from '../sync/sync.service';
import { UsuarioPainel } from './painel.guard';
import { Escopo, exigirRota, exigirVendedor } from './escopo';

type Linha = Record<string, any>;

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const POR_PAGINA = 50;
const hojeSp = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const pagina = (p: unknown) => Math.max(1, Math.trunc(Number(p)) || 1);
/** Texto de busca (vai dentro de um `ilike`): tira os coringas % e _. */
const texto = (v: unknown, max = 80) => String(v ?? '').trim().replace(/[%_]/g, ' ').slice(0, max);
/** Valor exato (status, codigo): so apara e limita; nada de coringa aqui. */
const exato = (v: unknown, max = 40) => String(v ?? '').trim().slice(0, max);

/** Consulta geral do painel: pedidos (SAP e app) e clientes da carteira, com detalhe. */
@Injectable()
export class ConsultaPainelService {
  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly sync: SyncService,
    private readonly pedidos: PedidosService,
  ) {}

  // =====================================================================
  // Pedidos
  // =====================================================================

  /** Pedidos do SAP (padrao) ou os criados pelo app/painel (origem=app), com filtros e paginacao. */
  async listarPedidos(escopo: Escopo | null, f: { origem?: string; ini?: string; fim?: string; vendedor?: string; busca?: string; status?: string; antecipado?: string; pendentes?: string; pagina?: string }) {
    if ((f.ini && !DIA.test(f.ini)) || (f.fim && !DIA.test(f.fim))) throw new UnprocessableEntityException('datas devem ser AAAA-MM-DD');
    const ini = f.ini || diasAtras(30);
    const fim = f.fim || hojeSp();
    if (ini > fim) throw new UnprocessableEntityException('O inicio e depois do fim');
    const pg = pagina(f.pagina);
    const vendedor = (f.vendedor ?? '').replace(/^0+/, '');

    if (f.origem === 'app') return this.listarPedidosApp(escopo, { ini, fim, vendedor, busca: texto(f.busca), status: exato(f.status, 30) }, pg);

    const { data, error } = await this.sb.rpc('fn_pedidos_painel', {
      p_ini: ini, p_fim: fim, p_vendedor: vendedor, p_busca: texto(f.busca), p_status: exato(f.status, 40), p_antecipado: f.antecipado === '1', p_pendentes: f.pendentes === '1', p_limite: POR_PAGINA, p_offset: (pg - 1) * POR_PAGINA, p_rotas: escopo?.rotas ?? null,
    });
    if (error) throw new Error(`fn_pedidos_painel: ${error.message}`);
    const linhas = (data ?? []) as Linha[];
    return {
      origem: 'sap',
      pagina: pg,
      por_pagina: POR_PAGINA,
      total: linhas.length ? Number(linhas[0].total) : 0,
      itens: linhas.map((l) => ({ ...l, valor: l.valor == null ? null : Number(l.valor), dias: Number(l.dias), total: undefined })),
    };
  }

  /** Pedidos criados pelo app ou pelo painel (inclui os que ainda nao chegaram ao SAP). */
  private async listarPedidosApp(escopo: Escopo | null, f: { ini: string; fim: string; vendedor: string; busca: string; status: string }, pg: number) {
    let q = this.sb
      .from('pedidos_app')
      .select('id, codigo, cod_vendedor, cod_cliente, tipo, status, erro, ordens_sap, itens, recebido_em, criado_por_painel, motivo_rejeicao')
      .gte('recebido_em', `${f.ini}T00:00:00-03:00`)
      .lte('recebido_em', `${f.fim}T23:59:59-03:00`)
      .order('recebido_em', { ascending: false });
    if (escopo) q = q.in('cod_vendedor', escopo.vendedores);
    if (f.vendedor) q = q.eq('cod_vendedor', f.vendedor);
    if (f.status) q = q.eq('status', f.status);
    const { data, error } = await q.limit(1000);
    if (error) throw error;
    const b = f.busca.toLowerCase();
    const todos = ((data ?? []) as Linha[]).filter((p) => !b || String(p.codigo).includes(b) || String(p.cod_cliente).includes(b));
    const fatia = todos.slice((pg - 1) * POR_PAGINA, pg * POR_PAGINA);

    const [cli, ven] = await Promise.all([
      fatia.length ? this.sb.from('clientes').select('cod_cliente, nome_fantasia, razao_social').in('cod_cliente', [...new Set(fatia.map((p) => p.cod_cliente))]) : Promise.resolve({ data: [], error: null }),
      fatia.length ? this.sb.from('vendedores').select('cod_vendedor, nome').in('cod_vendedor', [...new Set(fatia.map((p) => p.cod_vendedor))]) : Promise.resolve({ data: [], error: null }),
    ]);
    if (cli.error) throw cli.error;
    if (ven.error) throw ven.error;
    const nCli = new Map(((cli.data ?? []) as Linha[]).map((c) => [c.cod_cliente, c.nome_fantasia || c.razao_social]));
    const nVen = new Map(((ven.data ?? []) as Linha[]).map((v) => [v.cod_vendedor, v.nome]));
    return {
      origem: 'app',
      pagina: pg,
      por_pagina: POR_PAGINA,
      total: todos.length,
      itens: fatia.map((p) => ({
        id: p.id, codigo: p.codigo, tipo: p.tipo, status: p.status, erro: p.erro, motivo_rejeicao: p.motivo_rejeicao,
        recebido_em: p.recebido_em, criado_por_painel: p.criado_por_painel, ordens: ((p.ordens_sap ?? []) as Linha[]).map((o) => o.ordem),
        qtd_itens: Array.isArray(p.itens) ? p.itens.length : 0,
        cod_cliente: p.cod_cliente, cliente: nCli.get(p.cod_cliente) ?? null, cod_vendedor: p.cod_vendedor, vendedor: nVen.get(p.cod_vendedor) ?? null,
      })),
    };
  }

  /**
   * Dados do PDF de confirmacao de um pedido criado pelo app/painel. O painel monta o documento com o mesmo codigo
   * do app (pedidoPdf.ts); aqui so entrega o que ele precisa, ja lido do banco.
   */
  async pedidoAppParaPdf(idRaw: string, escopo: Escopo | null = null) {
    const id = String(idRaw ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new UnprocessableEntityException('id invalido');
    const { data, error } = await this.sb
      .from('pedidos_app')
      .select('id, codigo, cod_vendedor, cod_cliente, criado_no_app_em, recebido_em, dt_entrega, status, tipo, tipo_bonificacao, cond_pagamento, ordem_compra_cliente, endereco_entrega, observacao, itens, ordens_sap')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Pedido nao encontrado');
    const p = data as Linha;
    exigirVendedor(escopo, p.cod_vendedor);
    const itens = (Array.isArray(p.itens) ? p.itens : []) as Linha[];
    const codigos = [...new Set(itens.map((i) => String(i.produto)))];

    const [cli, ven, usu, pro, tip] = await Promise.all([
      this.sb.from('clientes').select('*').eq('cod_cliente', p.cod_cliente).maybeSingle(),
      this.sb.from('vendedores').select('cod_vendedor, nome').eq('cod_vendedor', p.cod_vendedor).maybeSingle(),
      this.sb.from('usuarios_vendedor').select('email').eq('cod_vendedor', p.cod_vendedor).eq('ativo', true).limit(1),
      codigos.length ? this.sb.from('produtos').select('cod_produto, descricao, tipo_material, dados').in('cod_produto', codigos) : Promise.resolve({ data: [], error: null }),
      p.tipo === 'bonificacao' && p.tipo_bonificacao ? this.sb.from('bonificacao_tipos').select('descricao').eq('codigo', p.tipo_bonificacao).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    for (const r of [cli, ven, usu, pro, tip]) if (r.error) throw r.error;

    const c = cli.data as Linha | null;
    const produtos: Record<string, Linha> = {};
    for (const x of (pro.data ?? []) as Linha[]) {
      const d = (x.dados ?? {}) as Linha;
      produtos[x.cod_produto] = {
        descricao: x.descricao, tipo_material: x.tipo_material, unidade_venda: d.unidade_venda ?? null, unidade_venda_texto: d.unidade_venda_texto ?? null,
        unidade_base: d.unidade_base ?? null, conversoes: Array.isArray(d.conversoes) ? d.conversoes : null, pesoliquido: d.peso?.pesoliquido ?? null,
      };
    }
    return {
      pedido: {
        id: p.id, codigo: p.codigo, criado_em: p.criado_no_app_em ?? p.recebido_em, dt_entrega: p.dt_entrega, status: p.status, tipo: p.tipo === 'bonificacao' ? 'bonificacao' : 'venda',
        cond_pagamento: p.cond_pagamento, ordem_compra_cliente: p.ordem_compra_cliente, endereco_entrega: p.endereco_entrega, observacao: p.observacao,
        itens, ordens_sap: Array.isArray(p.ordens_sap) ? p.ordens_sap : [],
      },
      cliente: c
        ? {
            cod_cliente: c.cod_cliente, nome_fantasia: c.nome_fantasia, razao_social: c.razao_social, cnpjcpf: c.cnpjcpf, telefone: c.telefone,
            endereco: c.endereco, areas: Array.isArray(c.areas) ? c.areas : [], formas_pagamento: Array.isArray(c.formas_pagamento) ? c.formas_pagamento : null,
          }
        : null,
      vendedor: ven.data ? { codigo: (ven.data as Linha).cod_vendedor, nome: (ven.data as Linha).nome ?? null, email: ((usu.data ?? []) as Linha[])[0]?.email ?? null } : null,
      produtos,
      tipo_bonificacao: (tip.data as Linha | null)?.descricao ?? p.tipo_bonificacao ?? null,
    };
  }

  /** Detalhe de uma ordem do SAP: itens, notas, quem vende, se pode cancelar e o historico de cancelamento. */
  async pedido(ordemRaw: string, escopo: Escopo | null = null) {
    const ordem = this.ordemValida(ordemRaw);
    const { data: p, error } = await this.sb.from('pedidos_sap').select('*').eq('ordem', ordem).maybeSingle();
    if (error) throw error;
    if (!p) throw new NotFoundException('Pedido nao encontrado');
    const ped = p as Linha;

    const [cli, rc, itens, canc, par] = await Promise.all([
      this.sb.from('clientes').select('cod_cliente, nome_fantasia, razao_social').eq('cod_cliente', ped.cod_cliente).maybeSingle(),
      this.sb.from('rota_clientes').select('rota').eq('cod_cliente', ped.cod_cliente).order('rota').limit(1),
      this.sb.from('pedido_itens_sap').select('item, cod_produto, denominacao, quantidade, unidade_venda, valor_unitario, recusa, cod_recusa, situacao, qtd_faturada, valor_faturado').eq('ordem', ordem).order('item'),
      this.sb.from('pedido_cancelamentos').select('resultado, status_antes, motivo, http, por, criado_em').eq('ordem', ordem).order('criado_em', { ascending: false }).limit(10),
      this.sb.from('parametros').select('valor').eq('chave', 'status_cancelaveis').maybeSingle(),
    ]);
    for (const r of [cli, rc, itens, canc, par]) if (r.error) throw r.error;

    // pedido do app/painel que originou esta ordem (so ele tem o PDF de confirmacao); pedidos que nao vieram do app ficam sem
    const { data: origemApp } = await this.sb.from('pedidos_app').select('id').filter('ordens_sap', 'cs', JSON.stringify([{ ordem }])).limit(1);
    const rota = ((rc.data ?? []) as Linha[])[0]?.rota ?? null;
    exigirRota(escopo, rota);
    const vendedores = rota ? await this.vendedoresDaRota(rota) : [];
    const liberados = (Array.isArray((par.data as Linha | null)?.valor) ? ((par.data as Linha).valor as unknown[]) : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    const status = String(ped.status ?? '').trim().toLowerCase();

    return {
      ...ped,
      valor: ped.valor == null ? null : Number(ped.valor),
      cliente: (cli.data as Linha | null)?.nome_fantasia || (cli.data as Linha | null)?.razao_social || null,
      rota,
      vendedores,
      itens: ((itens.data ?? []) as Linha[]).map((i) => ({ ...i, quantidade: i.quantidade == null ? null : Number(i.quantidade), valor_unitario: i.valor_unitario == null ? null : Number(i.valor_unitario), qtd_faturada: i.qtd_faturada == null ? null : Number(i.qtd_faturada), valor_faturado: i.valor_faturado == null ? null : Number(i.valor_faturado) })),
      cancelamentos: canc.data ?? [],
      cancelavel: liberados.includes(status),
      pedido_app_id: ((origemApp ?? []) as Linha[])[0]?.id ?? null,
    };
  }

  /** Busca a ordem de novo no SAP (cabecalho e itens) e devolve o detalhe atualizado. */
  async atualizarPedido(escopo: Escopo | null, ordemRaw: string) {
    const ordem = this.ordemValida(ordemRaw);
    const det = await this.pedido(ordem, escopo);
    const cod = det.vendedores[0]?.cod_vendedor as string | undefined;
    if (!cod) throw new ConflictException('Nao ha vendedor sincronizado para a carteira deste cliente');
    try {
      await this.sync.sincronizarOrdem(cod, ordem);
    } catch (e) {
      throw new ConflictException(`O SAP nao respondeu: ${(e as Error).message}`);
    }
    return this.pedido(ordem, escopo);
  }

  /** Cancela a ordem no SAP em nome do vendedor da carteira (so nos status liberados em Parametros). Fica auditado com o e-mail de quem pediu. */
  async cancelarPedido(u: UsuarioPainel, ordemRaw: string, motivo?: string) {
    const ordem = this.ordemValida(ordemRaw);
    const det = await this.pedido(ordem, u.escopo);
    const v = det.vendedores[0];
    if (!v?.cod_vendedor || !det.rota) throw new ConflictException('Nao ha vendedor sincronizado para a carteira deste cliente');
    return this.pedidos.cancelarOrdemSap({ email: u.email, codVendedor: v.cod_vendedor, rota: det.rota }, ordem, motivo ?? null, u.email);
  }

  // =====================================================================
  // Clientes
  // =====================================================================

  async listarClientes(escopo: Escopo | null, f: { vendedor?: string; busca?: string; escritorio?: string; canal?: string; situacao?: string; pagina?: string }) {
    const situacao = exato(f.situacao, 20);
    if (situacao && !['bloqueados', 'parados', 'vencidos', 'antecipado'].includes(situacao)) throw new UnprocessableEntityException('situacao invalida');
    const pg = pagina(f.pagina);
    const { data, error } = await this.sb.rpc('fn_clientes_painel', {
      p_vendedor: (f.vendedor ?? '').replace(/^0+/, ''), p_busca: texto(f.busca), p_escritorio: exato(f.escritorio, 10), p_canal: exato(f.canal, 10),
      p_situacao: situacao, p_limite: POR_PAGINA, p_offset: (pg - 1) * POR_PAGINA, p_rotas: escopo?.rotas ?? null,
    });
    if (error) throw new Error(`fn_clientes_painel: ${error.message}`);
    const linhas = (data ?? []) as Linha[];
    return {
      pagina: pg,
      por_pagina: POR_PAGINA,
      total: linhas.length ? Number(linhas[0].total) : 0,
      itens: linhas.map((l) => ({ ...l, valor_12m: Number(l.valor_12m), vencido: Number(l.vencido), total: undefined })),
    };
  }

  /** Escritorios e canais existentes, para os filtros. */
  async filtrosClientes() {
    const { data, error } = await this.sb.rpc('fn_clientes_filtros');
    if (error) throw new Error(`fn_clientes_filtros: ${error.message}`);
    const l = (data ?? []) as Linha[];
    const por = (t: string) => l.filter((x) => x.tipo === t).map((x) => ({ codigo: x.codigo, descricao: x.descricao })).sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
    return { escritorios: por('escritorio'), canais: por('canal') };
  }

  /** Tudo de um cliente: cadastro, comercial, financeiro, compras (12 meses), visitas e produtos que mais compra. */
  async cliente(codRaw: string, escopo: Escopo | null = null) {
    const cod = String(codRaw ?? '').trim().replace(/^0+/, '');
    if (!/^\d{1,10}$/.test(cod)) throw new UnprocessableEntityException('Codigo de cliente invalido');
    const { data: c, error } = await this.sb.from('clientes').select('*').eq('cod_cliente', cod).maybeSingle();
    if (error) throw error;
    if (!c) throw new NotFoundException('Cliente nao encontrado');
    const cli = c as Linha;

    const desde12 = diasAtras(365);
    const desdeV = diasAtras(60);
    const [rc, peds, tits, vis] = await Promise.all([
      this.sb.from('rota_clientes').select('rota, dia_semana, sequencia').eq('cod_cliente', cod).order('rota').limit(30),
      this.sb.from('pedidos_sap').select('ordem, dt_criacao, valor, status').eq('cod_cliente', cod).gte('dt_criacao', desde12).order('dt_criacao', { ascending: false }).limit(1000),
      this.sb.from('titulos').select('nfe, parcela, status, valor, vencimento, dt_compensacao, ordem, danfe_url, boleto_url').eq('cod_cliente', cod).order('vencimento', { ascending: false }).limit(60),
      this.sb.from('visitas').select('id, data_visita, cod_vendedor, status, resultado, motivo_nao_venda, validacao, fora_do_raio').eq('cod_cliente', cod).gte('data_visita', desdeV).order('data_visita', { ascending: false }).limit(10),
    ]);
    for (const r of [rc, peds, tits, vis]) if (r.error) throw r.error;

    const ultimos = ((peds.data ?? []) as Linha[]).slice(0, 10);
    const { data: recusados, error: eRec } = ultimos.length
      ? await this.sb.from('pedido_itens_sap').select('ordem').in('ordem', ultimos.map((p) => p.ordem as string)).not('recusa', 'is', null)
      : { data: [] as Linha[], error: null };
    if (eRec) throw eRec;
    const comRecusa = new Set(((recusados ?? []) as Linha[]).map((r) => r.ordem as string));

    const rotas = [...new Set(((rc.data ?? []) as Linha[]).map((r) => r.rota as string))];
    if (escopo && !rotas.some((r) => escopo.rotas.includes(r))) exigirRota(escopo, null);
    const vendedores = rotas.length ? await this.vendedoresDaRota(rotas[0]) : [];

    // compras por mes (sem os recusados)
    const lista = ((peds.data ?? []) as Linha[]).filter((p) => String(p.status ?? '').toLowerCase() !== 'recusado');
    const meses = new Map<string, { valor: number; pedidos: number }>();
    for (const p of lista) {
      const m = String(p.dt_criacao).slice(0, 7);
      const x = meses.get(m) ?? { valor: 0, pedidos: 0 };
      x.valor += Number(p.valor ?? 0);
      x.pedidos++;
      meses.set(m, x);
    }
    const agora = new Date();
    const base = agora.getFullYear() * 12 + agora.getMonth() - 11;
    const compras_por_mes = Array.from({ length: 12 }, (_, i) => {
      const n = base + i;
      const m = `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
      return { mes: m, valor: Math.round((meses.get(m)?.valor ?? 0) * 100) / 100, pedidos: meses.get(m)?.pedidos ?? 0 };
    });

    const titulos: Linha[] = ((tits.data ?? []) as Linha[]).map((t) => ({ ...t, valor: t.valor == null ? null : Number(t.valor) }));
    const abertos = titulos.filter((t) => t.status === 'Em aberto' || t.status === 'Atrasado');
    const soma = (l: Linha[]) => Math.round(l.reduce((a, t) => a + Number(t.valor ?? 0), 0) * 100) / 100;

    // produtos que mais compra (12 meses, ja somados no banco por rota); falha aqui nao derruba a tela
    let produtos: Linha[] = [];
    if (rotas[0]) {
      const { data: hp } = await this.sb.rpc('fn_historico_cliente_produto', { p_rota: rotas[0], p_meses: 12 });
      produtos = ((hp ?? []) as Linha[])
        .filter((x) => x.cod_cliente === cod)
        .sort((a, b) => Number(b.quantidade) - Number(a.quantidade))
        .slice(0, 10)
        .map((x) => ({ cod_produto: x.cod_produto, denominacao: x.denominacao, quantidade: Number(x.quantidade), unidade: x.unidade, pedidos: Number(x.pedidos), ultima_compra: x.ultima_compra }));
    }

    return {
      ...cli,
      limite_total: cli.limite_total == null ? null : Number(cli.limite_total),
      limite_disponivel: cli.limite_disponivel == null ? null : Number(cli.limite_disponivel),
      pedido_minimo: cli.pedido_minimo == null ? null : Number(cli.pedido_minimo),
      latitude: cli.latitude == null ? null : Number(cli.latitude),
      longitude: cli.longitude == null ? null : Number(cli.longitude),
      rota: rotas[0] ?? null,
      vendedores,
      visitas_na_semana: ((rc.data ?? []) as Linha[]).filter((r) => r.rota === rotas[0]).map((r) => ({ dia_semana: r.dia_semana, sequencia: r.sequencia })),
      compras_por_mes,
      total_12m: Math.round(lista.reduce((a, p) => a + Number(p.valor ?? 0), 0) * 100) / 100,
      // os 10 mais recentes, inclusive os recusados (os totais acima nao contam recusados), e se algum item foi recusado
      ultimos_pedidos: ultimos.map((p) => ({ ordem: p.ordem, dt_criacao: p.dt_criacao, valor: Number(p.valor ?? 0), status: p.status, item_recusado: comRecusa.has(p.ordem as string) })),
      titulos: { em_aberto: soma(abertos.filter((t) => t.status === 'Em aberto')), vencido: soma(abertos.filter((t) => t.status === 'Atrasado')), lista: abertos.slice(0, 30), recentes: titulos.slice(0, 10) },
      visitas: vis.data ?? [],
      produtos_mais_comprados: produtos,
    };
  }

  // ---------------- apoio ----------------

  private ordemValida(raw: string): string {
    const o = String(raw ?? '').trim();
    if (!/^\d{1,10}$/.test(o)) throw new UnprocessableEntityException('Numero de ordem invalido');
    return o;
  }

  private async vendedoresDaRota(rota: string) {
    const { data, error } = await this.sb.from('vendedores').select('cod_vendedor, nome').eq('rota', rota).order('nome');
    if (error) throw error;
    return (data ?? []) as Array<{ cod_vendedor: string; nome: string | null }>;
  }
}
