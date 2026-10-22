import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod } from '../auth/vendedores.service';
import { invalidarEscopo } from '../painel/escopo';
import { SapClient } from '../sap/sap.client';
import {
  SapClientesResp,
  SapEstoqueResp,
  SapItensResp,
  SapPedidosResp,
  SapPrecosResp,
  SapProdutosResp,
  SapRemessasResp,
  SapTitulosResp,
  SapVendedorResp,
  SapSupervisoresResp,
  SapVendedoresResp,
} from '../sap/sap.types';
import { SUPABASE } from '../supabase/supabase.module';

export interface ResultadoSync {
  recurso: string;
  ok: boolean;
  ms: number;
  linhas?: number;
  erro?: string;
}

type Linha = Record<string, unknown>;

export interface RodadaIndicadores {
  rodando: boolean;
  origem: 'cron' | 'painel' | null;
  iniciado_em: string | null;
  terminou_em: string | null;
  total: number; // rotas na fila
  feitos: number;
  /** rotas puladas por ja estarem atualizadas (so no botao do painel: retoma de onde parou) */
  puladas: number;
  atual: string | null; // vendedor em andamento
  falhas: Array<{ cod_vendedor: string; erro: string }>;
  /** a API reiniciou no meio da rodada (so aparece ao ler o andamento gravado) */
  interrompida?: boolean;
}

const num = (s: string | undefined | null): number | null => {
  if (s === undefined || s === null || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
/** Coordenada: aceita virgula decimal; 0 ou vazio = sem localizacao (null). */
const coord = (s: string | undefined | null): number | null => {
  const n = num((s ?? '').replace(',', '.'));
  return n === null || n === 0 ? null : n;
};
/** '' vira null (colunas de texto opcionais). */
const txt = (s: string | undefined | null): string | null => (s ?? '').trim() || null;
/** Escritorio/equipe so entram no upsert quando o SAP manda o campo: sem ele, nao apaga o que ja foi gravado. */
const escritorioEquipe = (v: { escritorio?: string; equipe?: string }) => ({
  ...(v.escritorio !== undefined ? { escritorio: txt(v.escritorio) } : {}),
  ...(v.equipe !== undefined ? { equipe: txt(v.equipe) } : {}),
});
/** So aceita AAAA-MM-DD (o ABAP ja entrega em ISO); senao null. */
const dt = (s: string | undefined | null): string | null => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
/** Data de hoje (+n dias) no fuso de Sao Paulo, AAAA-MM-DD. */
const hojeSP = (somarDias = 0): string =>
  new Date(Date.now() + somarDias * 86_400_000).toLocaleDateString('sv-SE', {
    timeZone: 'America/Sao_Paulo',
  });

const LOTE_DB = 200;
const LOTES_EM_PARALELO = 4;
/** Botao "Sincronizar agora": rota atualizada ha menos que isso e pulada (retoma uma rodada interrompida). */
const RETOMAR_JA_ATUALIZADA_MIN = 120;
/** Itens de ordens que o SAP vai ATUALIZAR antes (SUBMIT zsdr124): pesado, lote pequeno (150 ja estourou o timeout de ~60 s do gateway). */
const LOTE_ORDENS_ATUALIZANDO = 40;
/** Itens so lidos da ZSDT139 como estao (ordens ainda sem itens, fora dos status marcados): leitura barata, o ABAP aceita ate 300. */
const LOTE_ORDENS_LEITURA = 150;
const JANELA_REMESSAS_DIAS = 14;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly sap: SapClient,
  ) {}

  // ===================================================================
  // Cadastro: vendedor, carteira, clientes (1x por dia)
  // ===================================================================

  /** Vendedor + carteira (rota, dia da semana, sequencia). Devolve a rota. */
  async sincronizarVendedor(codVendedor: string): Promise<string> {
    const inicio = new Date().toISOString();
    const v = await this.sap.get<SapVendedorResp>('vendedor', { codvendedor: codVendedor });

    await this.upsert(
      'vendedores',
      [{ cod_vendedor: v.codvendedor, nome: v.nome, documento: v.documento, rota: v.rota, ...escritorioEquipe(v), synced_at: inicio }],
      'cod_vendedor',
    );

    const carteira = (v.clientes ?? []).flatMap((c) => {
      const visitas = c.visitas?.length ? c.visitas : [{ dia_semana: '0', sequencia: '0' }];
      return visitas.map((x) => ({
        rota: v.rota,
        cod_cliente: c.codigocli,
        dia_semana: Number(x.dia_semana),
        sequencia: Number(x.sequencia),
        synced_at: inicio,
      }));
    });
    await this.upsert('rota_clientes', carteira, 'rota,cod_cliente,dia_semana');

    // saiu da carteira no SAP -> some daqui (o pull devolve a carteira completa)
    const { error } = await this.sb.from('rota_clientes').delete().eq('rota', v.rota).lt('synced_at', inicio);
    if (error) throw error;

    await this.estado('vendedor', v.rota);
    return v.rota;
  }

  /** Cadastro completo dos clientes da carteira do vendedor. */
  async sincronizarClientes(codVendedor: string, rota: string): Promise<number> {
    const inicio = new Date().toISOString();
    const r = await this.sap.get<SapClientesResp>('clientes', { codvendedor: codVendedor });

    const rows = (r.clientes ?? []).map((c) => ({
      cod_cliente: c.codigocli,
      nome_fantasia: c.nome_fantasia,
      razao_social: c.razao_social,
      cnpjcpf: c.cnpjcpf,
      telefone: c.telefone,
      bloqueado: c.bloqueado === 'true',
      endereco: c.endereco,
      limite_total: num(c.limite_total),
      limite_disponivel: num(c.limite_disponivel),
      agrupado: c.agrupado === 'true',
      dias_entrega: (c.dias_entrega ?? []).map(Number),
      classe_risco: c.classe_risco,
      areas: c.areas ?? [],
      latitude: coord(c.latitude),
      longitude: coord(c.longitude),
      pedido_minimo: num(c.pedido_minimo),
      formas_pagamento: c.formas_pagamento ?? [],
      pagamento_antecipado: c.pagamento_antecipado === 'true',
      synced_at: inicio,
    }));
    await this.upsert('clientes', rows, 'cod_cliente');

    // cliente que o SAP deixou de mandar (ex.: tabela de preco 33/63) sai da carteira.
    // So limpa se o SAP devolveu algum cliente: uma falha/resposta vazia nao pode apagar a carteira inteira.
    if (rows.length) {
      const tLimpa = Date.now();
      const { error: eLimpa } = await this.sb.rpc('fn_limpar_clientes_rota', { p_rota: rota, p_inicio: inicio });
      if (eLimpa) throw eLimpa;
      this.logger.log(`Rota ${rota}: limpeza de clientes que sairam em ${((Date.now() - tLimpa) / 1000).toFixed(1)} s`);
    }

    await this.estado('clientes', rota);
    this.logger.log(`Rota ${rota}: ${rows.length} clientes sincronizados`);
    return rows.length;
  }

  // ===================================================================
  // Catalogo: produtos (global) e precos (por rota) - 1x por dia
  // ===================================================================

  /** Catalogo de produtos: igual para todos, nao depende do vendedor. */
  async sincronizarProdutos(): Promise<number> {
    const inicio = new Date().toISOString();
    const r = await this.sap.get<SapProdutosResp>('produtos');

    const rows = (r.produtos ?? []).map((p) => ({
      cod_produto: p.codigoproduto,
      descricao: p.descricao,
      tipo: txt(p.tipo),
      unidade: txt(p.unidade),
      ean: txt(p.ean),
      ncm: txt(p.ncm),
      validade: txt(p.validade),
      tipo_material: txt(p.tipo_material),
      dados: {
        estoque: p.estoque,
        peso: p.peso,
        pedido: p.pedido,
        classificacao: p.classificacao,
        // unidade em que o pedido e feito e conversoes (preco por caixa, estoque em caixas no app)
        unidade_base: txt(p.unidade_base),
        unidade_base_texto: txt(p.unidade_base_texto),
        unidade_venda: txt(p.unidade_venda),
        unidade_venda_texto: txt(p.unidade_venda_texto),
        conversoes: (p.conversoes ?? [])
          .map((c) => ({ unidade: c.unidade, texto: txt(c.texto), fator: num(c.fator) }))
          .filter((c) => c.unidade && c.fator !== null && c.fator > 0),
      },
      synced_at: inicio,
    }));
    await this.upsert('produtos', rows, 'cod_produto');
    await this.estado('produtos', '*');
    return rows.length;
  }

  /**
   * Precos vigentes hoje das listas/grupos da carteira. O que deixou de valer
   * e removido (so existem na tabela precos vigentes).
   */
  async sincronizarPrecos(codVendedor: string, rota: string): Promise<number> {
    const inicio = new Date().toISOString();
    const r = await this.sap.get<SapPrecosResp>('precos', { codvendedor: codVendedor });

    const base = (i: SapPrecoItem) => ({
      cod_produto: i.matnr,
      datab: dt(i.datab),
      datbi: dt(i.datbi),
      kbetr: num(i.kbetr),
      kpein: num(i.kpein),
      kmein: txt(i.kmein),
      konwa: txt(i.konwa),
      krech: txt(i.krech),
      preco_kg: num(i.preco_kg),
      desconto_max: num(i.desconto_max) ?? 0,
      synced_at: inicio,
    });
    const valido = (x: { datab: string | null; datbi: string | null }) => x.datab !== null && x.datbi !== null;

    const listas = (r.listas ?? []).flatMap((l) =>
      l.itens.map((i) => ({ pltyp: l.pltyp, ...base(i) })).filter(valido),
    );
    const grupos = (r.grupos ?? []).flatMap((g) =>
      g.itens.map((i) => ({ pltyp: g.pltyp, kdgrp: g.kdgrp, ...base(i) })).filter(valido),
    );

    await this.upsert('precos_lista', listas, 'pltyp,cod_produto,datab');
    await this.upsert('precos_grupo', grupos, 'pltyp,kdgrp,cod_produto,datab');

    // lista/grupo e devolvido COMPLETO pelo SAP: o que nao veio mais deixou de valer
    for (const l of r.listas ?? []) {
      const { error } = await this.sb.from('precos_lista').delete().eq('pltyp', l.pltyp).lt('synced_at', inicio);
      if (error) throw error;
    }
    for (const g of r.grupos ?? []) {
      const { error } = await this.sb
        .from('precos_grupo')
        .delete()
        .eq('pltyp', g.pltyp)
        .eq('kdgrp', g.kdgrp)
        .lt('synced_at', inicio);
      if (error) throw error;
    }

    await this.estado('precos', rota);
    return listas.length + grupos.length;
  }

  // ===================================================================
  // Operacional: pedidos, titulos, remessas, estoque (a cada 15 min)
  // ===================================================================

  /** Pedidos dos ultimos 90 dias da carteira + itens dos que ainda precisam. */
  async sincronizarPedidos(codVendedor: string, rota: string, dias = 90, comItens = true, deveParar?: () => boolean): Promise<number> {
    const inicio = new Date().toISOString();
    // `dias` (padrao 90) em janelas de 15 (criacao): cada chamada fica bem abaixo do timeout de ~60 s do gateway do SAP.
    // A carga unica do historico (npm run historico:vendedor) usa janela maior.
    const todos: NonNullable<SapPedidosResp['pedidos']> = [];
    for (const [datain, datafim] of janelasDeDias(dias, 15)) {
      if (deveParar?.()) throw new Error('Cancelada pelo usuario');
      const r = await this.comTentativas(() => this.sap.get<SapPedidosResp>('pedidos', { codvendedor: codVendedor, datain, datafim }));
      todos.push(...(r.pedidos ?? []));
    }

    const pedidos = todos.map((p) => this.linhaPedido(p, inicio));
    await this.upsert('pedidos_sap', pedidos, 'ordem');
    if (!comItens) {
      this.logger.log(`Rota ${rota}: ${pedidos.length} pedidos (sem itens)`);
      return pedidos.length;
    }

    // itens: das ordens ainda sem itens (leitura simples) e das que estao num status marcado no painel
    // (parametro status_atualizar_sync): so essas pedem ao SAP para atualizar o ciclo antes (atualizar=X)
    const status = await this.statusParaAtualizar();
    const { data, error } = await this.sb.rpc('fn_ordens_para_itens', { p_rota: rota, p_dias: dias, ...(status ? { p_status: status } : {}) });
    if (error) throw error;
    const linhasOrdens = (data ?? []) as Array<{ ordem: string; atualizar: boolean }>;
    const lotes: Array<{ ordens: string[]; atualizar: boolean }> = [];
    for (const atualizar of [true, false]) {
      const ordens = linhasOrdens.filter((o) => !!o.atualizar === atualizar).map((o) => o.ordem);
      const tam = atualizar ? LOTE_ORDENS_ATUALIZANDO : LOTE_ORDENS_LEITURA;
      for (let i = 0; i < ordens.length; i += tam) lotes.push({ ordens: ordens.slice(i, i + tam), atualizar });
    }

    // um lote que falha (depois de uma nova tentativa) nao derruba os demais: o que ficou sem itens volta na proxima rodada
    let totalItens = 0;
    let lotesFalhos = 0;
    let primeiroErro: unknown = null;
    for (const lote of lotes) {
      if (deveParar?.()) throw new Error('Cancelada pelo usuario');
      try {
        const it = await this.comTentativas(() =>
          this.sap.get<SapItensResp>('itens', { codvendedor: codVendedor, ordens: lote.ordens.join(','), ...(lote.atualizar ? { atualizar: 'X' } : {}) }),
        );
        const linhas = this.linhasItens(it, inicio);
        await this.upsert('pedido_itens_sap', linhas, 'ordem,item');
        totalItens += linhas.length;
      } catch (e) {
        lotesFalhos++;
        primeiroErro ??= e;
        this.logger.warn(`Rota ${rota}: itens de ${lote.ordens.length} ordens falharam (${(e as Error).message.slice(0, 120)}); seguindo`);
      }
    }

    this.logger.log(`Rota ${rota}: ${pedidos.length} pedidos, ${totalItens} itens`);
    if (lotesFalhos) {
      throw new Error(`itens: ${lotesFalhos} de ${lotes.length} lotes falharam (os demais foram gravados): ${(primeiroErro as Error).message}`);
    }
    return pedidos.length;
  }

  /** Status marcados no painel (parametro status_atualizar_sync); undefined = usa o padrao da funcao SQL. */
  private async statusParaAtualizar(): Promise<string[] | undefined> {
    const { data, error } = await this.sb.from('parametros').select('valor').eq('chave', 'status_atualizar_sync').maybeSingle();
    if (error) throw error;
    const v = (data as { valor?: unknown } | null)?.valor;
    return Array.isArray(v) ? v.map(String) : undefined;
  }

  private linhaPedido(p: NonNullable<SapPedidosResp['pedidos']>[number], inicio: string) {
    return {
      ordem: p.ordem,
      cod_cliente: p.codigocli,
      tp_ped: txt(p.tp_ped),
      dt_criacao: dt(p.dt_criacao),
      dt_entrega: dt(p.dt_entrega),
      valor: num(p.valor),
      status: txt(p.status),
      refaturado: txt(p.refaturado),
      pedido_externo: txt(p.pedido_externo),
      plataforma: txt(p.plataforma),
      notas: (p.notas ?? []).map((n) => ({
        nota_fiscal: txt(n.nota_fiscal),
        serie: txt(n.serie),
        danfe_url: txt(n.danfe_url),
        xml_url: txt(n.xml_url),
        boleto_url: txt(n.boleto_url),
      })),
      synced_at: inicio,
    };
  }

  private linhasItens(it: SapItensResp, inicio: string) {
    return (it.ordens ?? []).flatMap((o) =>
      (o.itens ?? []).map((x) => ({
        ordem: o.ordem,
        item: x.item,
        cod_produto: txt(x.material),
        denominacao: txt(x.denominacao),
        grupo: txt(x.grupo),
        quantidade: num(x.quantidade),
        unidade_venda: txt(x.unidade_venda),
        valor_unitario: num(x.valor_unitario),
        recusa: txt(x.recusa),
        cod_recusa: txt(x.cod_recusa),
        situacao: txt(x.situacao),
        qtd_faturada: num(x.qtd_faturada),
        valor_faturado: num(x.valor_faturado),
        synced_at: inicio,
      })),
    );
  }

  /**
   * Busca UMA ordem no SAP na hora (cabecalho + itens), sem esperar a carga da carteira.
   * Devolve no mesmo formato das linhas do pull, ou null se o SAP nao a conhece (ou nao e da carteira do vendedor).
   */
  async sincronizarOrdem(codVendedor: string, ordem: string) {
    const inicio = new Date().toISOString();
    const r = await this.comTentativas(() => this.sap.get<SapPedidosResp>('pedidos', { codvendedor: codVendedor, ordens: ordem }));
    const achado = (r.pedidos ?? []).find((p) => String(p.ordem).replace(/^0+/, '') === ordem.replace(/^0+/, ''));
    if (!achado) return null;
    const pedido = this.linhaPedido(achado, inicio);
    await this.upsert('pedidos_sap', [pedido], 'ordem');

    const it = await this.comTentativas(() => this.sap.get<SapItensResp>('itens', { codvendedor: codVendedor, ordens: ordem, atualizar: 'X' }));
    const itens = this.linhasItens(it, inicio);
    await this.upsert('pedido_itens_sap', itens, 'ordem,item');
    return { pedido, itens };
  }

  /**
   * Lista de todos os vendedores com rota vigente no SAP, gravada em `vendedores`. Vendedor novo entra com
   * `indicadores = false` (o administrador marca no painel); quem ja existia mantem a marcacao.
   */
  async importarVendedores(): Promise<{ total: number; novos: number; supervisores: number | null }> {
    const r = await this.comTentativas(() => this.sap.get<SapVendedoresResp>('vendedores'));
    const lista = (r.vendedores ?? []).filter((v) => v.codvendedor?.trim());
    if (!lista.length) return { total: 0, novos: 0, supervisores: null };

    const codigos = lista.map((v) => normCod(v.codvendedor));
    const { data, error } = await this.sb.from('vendedores').select('cod_vendedor').in('cod_vendedor', codigos);
    if (error) throw error;
    const existentes = new Set((data ?? []).map((x: { cod_vendedor: string }) => x.cod_vendedor));

    // so cadastro: a carteira e os pedidos vem na sincronizacao. `indicadores` nao entra no upsert (preserva a marcacao)
    await this.upsert(
      'vendedores',
      lista.map((v) => ({ cod_vendedor: normCod(v.codvendedor), nome: txt(v.nome), documento: txt(v.documento), rota: txt(v.rota), ...escritorioEquipe(v) })),
      'cod_vendedor',
    );
    const supervisores = await this.importarSupervisores().catch((e) => {
      // endpoint novo no SAP: se ainda nao existir/estiver ativo, o cadastro de vendedores nao pode falhar por isso
      this.logger.warn(`Supervisores nao importados: ${(e as Error).message}`);
      return null;
    });
    return { total: lista.length, novos: codigos.filter((c) => !existentes.has(c)).length, supervisores };
  }

  /**
   * Supervisores vigentes (ZSDT087): supervisor + gerente por escritorio e equipe de vendas. A tabela inteira e a
   * foto de hoje: o que nao veio mais (fim de vigencia, troca de supervisor) e removido.
   */
  async importarSupervisores(): Promise<number> {
    const r = await this.comTentativas(() => this.sap.get<SapSupervisoresResp>('supervisores'));
    const agora = new Date().toISOString();
    const linhas = (r.supervisores ?? [])
      .filter((x) => x.codsupervisor?.trim() && x.escritorio?.trim() && x.equipe?.trim())
      .map((x) => ({
        cod_supervisor: normCod(x.codsupervisor),
        escritorio: x.escritorio.trim(),
        equipe: x.equipe.trim(),
        nome: txt(x.nome),
        cod_gerente: txt(x.codgerente) ? normCod(x.codgerente) : null,
        gerente_nome: txt(x.gerente_nome),
        dt_inicio: dt(x.dt_inicio),
        dt_fim: dt(x.dt_fim),
        synced_at: agora,
      }));
    // resposta vazia nao apaga a base (SAP fora do ar ou tabela sem vigentes: melhor manter o ultimo retrato)
    if (!linhas.length) return 0;
    await this.upsert('supervisores', linhas, 'cod_supervisor,escritorio,equipe');
    const { error } = await this.sb.from('supervisores').delete().lt('synced_at', agora);
    if (error) throw error;
    invalidarEscopo();
    return linhas.length;
  }

  /**
   * Vendedor so de indicadores: carteira, clientes (escritorio/canal) e cabecalho dos pedidos, sem itens.
   * Primeira vez da rota: 12 meses de pedidos; depois so os ultimos 90 dias.
   */
  async sincronizarParaIndicadores(codVendedor: string): Promise<string> {
    const rota = await this.sincronizarVendedor(codVendedor);
    await this.rodar('clientes', rota, () => this.sincronizarClientes(codVendedor, rota));
    const { data, error } = await this.sb.from('sync_estado').select('ultimo_sucesso').eq('recurso', 'pedidos').eq('escopo', rota).maybeSingle();
    if (error) throw error;
    const dias = data?.ultimo_sucesso ? 90 : 365;
    await this.rodar('pedidos', rota, () => this.sincronizarPedidos(codVendedor, rota, dias, false));
    return rota;
  }

  // ===================================================================
  // Vendedores marcados so para indicadores (cron 2x/dia e botao "Sincronizar agora" do painel)
  // ===================================================================

  /** Andamento da ultima rodada (em memoria: some ao reiniciar a API). */
  readonly rodadaIndicadores: RodadaIndicadores = { rodando: false, origem: null, iniciado_em: null, terminou_em: null, total: 0, feitos: 0, puladas: 0, atual: null, falhas: [] };

  /**
   * Sincroniza, uma vez por rota, os vendedores marcados em `vendedores.indicadores` que NAO usam o app
   * (os do app ja sao sincronizados pelos jobs normais). Uma falha num vendedor nao para os outros.
   * So uma rodada por vez: o cron e o botao do painel dividem o mesmo bloqueio.
   */
  async sincronizarMarcados(origem: 'cron' | 'painel' = 'cron'): Promise<RodadaIndicadores> {
    const r = this.rodadaIndicadores;
    if (r.rodando) return r;
    Object.assign(r, { rodando: true, origem, iniciado_em: new Date().toISOString(), terminou_em: null, total: 0, feitos: 0, puladas: 0, atual: null, falhas: [], interrompida: false });
    await this.gravarRodada();
    try {
      const [app, marc] = await Promise.all([
        this.sb.from('usuarios_vendedor').select('cod_vendedor').eq('ativo', true),
        this.sb.from('vendedores').select('cod_vendedor, rota').eq('indicadores', true).order('cod_vendedor'),
      ]);
      if (app.error) throw app.error;
      if (marc.error) throw marc.error;
      const doApp = new Set((app.data ?? []).map((u: { cod_vendedor: string }) => normCod(u.cod_vendedor)));

      // botao do painel: pula a rota ja atualizada ha pouco (a rodada interrompida recomeca de onde parou)
      const recentes = new Set<string>();
      if (origem === 'painel') {
        const corte = Date.now() - RETOMAR_JA_ATUALIZADA_MIN * 60_000;
        const { data: est, error: eEst } = await this.sb.from('sync_estado').select('escopo, ultimo_sucesso').eq('recurso', 'pedidos').limit(5000);
        if (eEst) throw eEst;
        for (const e of (est ?? []) as Array<{ escopo: string; ultimo_sucesso: string | null }>) {
          if (e.ultimo_sucesso && Date.parse(e.ultimo_sucesso) >= corte) recentes.add(e.escopo);
        }
      }

      const fila: string[] = [];
      const rotas = new Set<string>();
      for (const v of (marc.data ?? []) as Array<{ cod_vendedor: string; rota: string | null }>) {
        if (doApp.has(normCod(v.cod_vendedor))) continue;
        if (v.rota) {
          if (rotas.has(v.rota)) continue;
          rotas.add(v.rota);
          if (recentes.has(v.rota)) {
            r.puladas++;
            continue;
          }
        }
        fila.push(v.cod_vendedor);
      }
      r.total = fila.length;
      await this.gravarRodada();

      for (const cod of fila) {
        r.atual = cod;
        try {
          await this.sincronizarParaIndicadores(cod);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.error(`Indicadores: falha no vendedor ${cod}: ${msg}`);
          r.falhas.push({ cod_vendedor: cod, erro: msg.slice(0, 300) });
          await this.registrarErro('vendedor', cod, e).catch(() => undefined);
        }
        r.feitos++;
        await this.gravarRodada();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Rodada de indicadores falhou: ${msg}`);
      r.falhas.push({ cod_vendedor: '*', erro: msg.slice(0, 300) });
    } finally {
      r.rodando = false;
      r.atual = null;
      r.terminou_em = new Date().toISOString();
      await this.gravarRodada();
    }
    return r;
  }

  /** Grava o andamento (parametros) para sobreviver a reinicio da API; falha aqui nunca derruba a rodada. */
  private async gravarRodada() {
    const { error } = await this.sb
      .from('parametros')
      .upsert({ chave: 'rodada_indicadores', valor: { ...this.rodadaIndicadores }, descricao: 'Andamento da ultima rodada de sincronizacao dos vendedores de indicadores (uso interno)', updated_at: new Date().toISOString() }, { onConflict: 'chave' });
    if (error) this.logger.warn(`Nao gravou o andamento da rodada: ${error.message}`);
  }

  /**
   * Andamento para o painel: o da memoria quando esta API ja viu uma rodada; senao o gravado no banco.
   * Se o gravado diz "rodando" mas esta API nao esta rodando nada, a API reiniciou no meio: `interrompida`.
   */
  async andamentoRodada(): Promise<RodadaIndicadores> {
    const m = this.rodadaIndicadores;
    if (m.rodando || m.iniciado_em) return { ...m };
    const { data, error } = await this.sb.from('parametros').select('valor').eq('chave', 'rodada_indicadores').maybeSingle();
    if (error || !data?.valor) return { ...m };
    const g = data.valor as RodadaIndicadores;
    return g.rodando ? { ...g, rodando: false, atual: null, interrompida: true } : { ...g };
  }

  /** Dispara a rodada em segundo plano (a resposta HTTP nao espera: pode levar minutos). */
  iniciarSincronizacaoMarcados(): RodadaIndicadores {
    if (this.rodadaIndicadores.rodando) throw new ConflictException('Ja existe uma sincronizacao em andamento');
    void this.sincronizarMarcados('painel');
    return this.rodadaIndicadores;
  }

  /** Repete uma vez (500/504 do gateway costumam passar na segunda tentativa). */
  private async comTentativas<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(`SAP falhou, tentando de novo: ${(e as Error).message}`);
      return fn();
    }
  }

  /** Titulos (parcelas): em aberto, atrasados e compensados nos ultimos 90 dias. */
  async sincronizarTitulos(codVendedor: string): Promise<number> {
    const inicio = new Date().toISOString();
    const r = await this.sap.get<SapTitulosResp>('titulos', { codvendedor: codVendedor });

    const rows = (r.titulos ?? []).map((t) => ({
      cod_cliente: t.codigocli,
      nfe: t.nfe ?? '',
      parcela: t.parcela ?? '',
      status: txt(t.status),
      valor: num(t.valor),
      vencimento: dt(t.vencimento),
      dt_compensacao: dt(t.dt_compensacao),
      ordem: txt(t.ordem),
      danfe_url: txt(t.danfe_url),
      boleto_url: txt(t.boleto_url),
      synced_at: inicio,
    }));
    await this.upsert('titulos', rows, 'cod_cliente,nfe,parcela');
    return rows.length;
  }

  /** Remessas abertas de hoje ate +14 dias. Remessa que o SAP nao devolve mais sai. */
  async sincronizarRemessas(codVendedor: string, rota: string): Promise<number> {
    const inicio = new Date().toISOString();
    const r = await this.sap.get<SapRemessasResp>('remessas', {
      codvendedor: codVendedor,
      dataremessade: hojeSP(0),
      dataremessaate: hojeSP(JANELA_REMESSAS_DIAS),
    });

    const rows = (r.remessas ?? [])
      .map((x) => ({
        ordem: x.ordem,
        item: x.item,
        data_remessa: dt(x.data_remessa),
        cod_cliente: x.codigocli,
        tp_ped: txt(x.tp_ped),
        cod_produto: txt(x.material),
        denominacao: txt(x.denominacao),
        unidade_venda: txt(x.unidade_venda),
        quantidade_pedida: num(x.quantidade_pedida),
        quantidade_confirmada: num(x.quantidade_confirmada),
        peso: num(x.peso),
        synced_at: inicio,
      }))
      .filter((x) => x.data_remessa !== null);
    await this.upsert('remessas', rows, 'ordem,item,data_remessa');

    const { error } = await this.sb.rpc('fn_limpar_remessas', { p_rota: rota, p_inicio: inicio });
    if (error) throw error;
    return rows.length;
  }

  /** Estoque livre (deposito CD) dos centros da carteira. */
  async sincronizarEstoque(codVendedor: string): Promise<number> {
    const inicio = new Date().toISOString();
    const r = await this.sap.get<SapEstoqueResp>('estoque', { codvendedor: codVendedor });

    const rows = (r.estoque ?? []).map((e) => ({
      centro: e.centro,
      cod_produto: e.material,
      quantidade: num(e.quantidade) ?? 0,
      unidade_base: txt(e.unidade_base),
      synced_at: inicio,
    }));
    await this.upsert('estoque', rows, 'centro,cod_produto');
    return rows.length;
  }

  // ===================================================================
  // Orquestracao (cada recurso falha isolado, sem derrubar os demais)
  // ===================================================================

  async sincronizarCatalogo(codVendedor: string, rota: string): Promise<ResultadoSync[]> {
    return [await this.rodar('precos', rota, () => this.sincronizarPrecos(codVendedor, rota))];
  }

  async sincronizarOperacional(codVendedor: string, rota: string): Promise<ResultadoSync[]> {
    return [
      await this.rodar('pedidos', rota, () => this.sincronizarPedidos(codVendedor, rota)),
      await this.rodar('titulos', rota, () => this.sincronizarTitulos(codVendedor)),
      await this.rodar('remessas', rota, () => this.sincronizarRemessas(codVendedor, rota)),
      await this.rodar('estoque', rota, () => this.sincronizarEstoque(codVendedor)),
    ];
  }

  /** Tudo de um vendedor/rota, na ordem certa (usado pelo CLI e pelo primeiro acesso). */
  async sincronizarTudo(codVendedor: string): Promise<ResultadoSync[]> {
    const resultados: ResultadoSync[] = [];
    let rota = '';

    resultados.push(
      await this.rodar('vendedor', codVendedor, async () => {
        rota = await this.sincronizarVendedor(codVendedor);
        return 1;
      }),
    );
    if (!rota) return resultados;

    resultados.push(await this.rodar('clientes', rota, () => this.sincronizarClientes(codVendedor, rota)));
    resultados.push(await this.rodar('produtos', '*', () => this.sincronizarProdutos()));
    resultados.push(...(await this.sincronizarCatalogo(codVendedor, rota)));
    resultados.push(...(await this.sincronizarOperacional(codVendedor, rota)));
    return resultados;
  }

  /** Atalho do primeiro acesso: so vendedor + clientes (o resto o cron completa). */
  async sincronizarCarteira(codVendedor: string): Promise<string> {
    const rota = await this.sincronizarVendedor(codVendedor);
    await this.sincronizarClientes(codVendedor, rota);
    return rota;
  }

  async rodar(recurso: string, escopo: string, fn: () => Promise<number>): Promise<ResultadoSync> {
    const t0 = Date.now();
    try {
      const linhas = await fn();
      await this.estado(recurso, escopo);
      return { recurso, ok: true, ms: Date.now() - t0, linhas };
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      this.logger.error(`${recurso} (${escopo}) falhou: ${erro}`);
      await this.registrarErro(recurso, escopo, e).catch(() => undefined);
      return { recurso, ok: false, ms: Date.now() - t0, erro };
    }
  }

  async registrarErro(recurso: string, escopo: string, e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await this.sb.from('sync_estado').upsert(
      { recurso, escopo, ultimo_erro: msg.slice(0, 1000), ultimo_erro_em: new Date().toISOString() },
      { onConflict: 'recurso,escopo' },
    );
  }

  private async estado(recurso: string, escopo: string) {
    const { error } = await this.sb.from('sync_estado').upsert(
      { recurso, escopo, ultimo_sucesso: new Date().toISOString(), ultimo_erro: null },
      { onConflict: 'recurso,escopo' },
    );
    if (error) throw error;
  }

  /** Upsert em lotes; descarta duplicatas da mesma chave dentro do lote (o Postgres recusaria). */
  private async upsert(table: string, rows: Linha[], onConflict: string) {
    const cols = onConflict.split(',');
    const unicas = new Map<string, Linha>();
    for (const r of rows) unicas.set(cols.map((c) => String(r[c])).join('|'), r);
    const lista = [...unicas.values()];

    // lotes de LOTE_DB linhas, ate LOTES_EM_PARALELO por vez (carteira grande tem dezenas de lotes; um de cada vez demora minutos)
    const t0 = Date.now();
    const lotes: Linha[][] = [];
    for (let i = 0; i < lista.length; i += LOTE_DB) lotes.push(lista.slice(i, i + LOTE_DB));
    for (let i = 0; i < lotes.length; i += LOTES_EM_PARALELO) {
      const respostas = await Promise.all(lotes.slice(i, i + LOTES_EM_PARALELO).map((l) => this.sb.from(table).upsert(l, { onConflict })));
      const falha = respostas.find((r) => r.error);
      if (falha?.error) throw new Error(`upsert ${table}: ${falha.error.message}`);
    }
    if (lista.length > LOTE_DB) this.logger.log(`Gravou ${lista.length} linhas em ${table} (${lotes.length} lotes) em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}

type SapPrecoItem = SapPrecosResp['listas'][number]['itens'][number];

/** [inicio, fim] (YYYY-MM-DD) cobrindo os ultimos `total` dias, em janelas de `passo` dias, sem sobreposicao. */
export function janelasDeDias(total: number, passo: number): Array<[string, string]> {
  const iso = (d: number) => new Date(d).toISOString().slice(0, 10);
  const dia = 86_400_000;
  const hoje = Date.now();
  const out: Array<[string, string]> = [];
  for (let off = 0; off < total; off += passo) {
    out.push([iso(hoje - (Math.min(off + passo, total) - 1) * dia), iso(hoje - off * dia)]);
  }
  return out;
}
