import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
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

const num = (s: string | undefined | null): number | null => {
  if (s === undefined || s === null || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
/** '' vira null (colunas de texto opcionais). */
const txt = (s: string | undefined | null): string | null => (s ?? '').trim() || null;
/** So aceita AAAA-MM-DD (o ABAP ja entrega em ISO); senao null. */
const dt = (s: string | undefined | null): string | null => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
/** Data de hoje (+n dias) no fuso de Sao Paulo, AAAA-MM-DD. */
const hojeSP = (somarDias = 0): string =>
  new Date(Date.now() + somarDias * 86_400_000).toLocaleDateString('sv-SE', {
    timeZone: 'America/Sao_Paulo',
  });

const LOTE_DB = 200;
const LOTE_ORDENS = 150; // ordens por chamada de itens (o ABAP aceita ate 300)
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
      [{ cod_vendedor: v.codvendedor, nome: v.nome, documento: v.documento, rota: v.rota, synced_at: inicio }],
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
      synced_at: inicio,
    }));
    await this.upsert('clientes', rows, 'cod_cliente');

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
  async sincronizarPedidos(codVendedor: string, rota: string): Promise<number> {
    const inicio = new Date().toISOString();
    // 90 dias em janelas de 15 (criacao): cada chamada fica bem abaixo do timeout de ~60 s do gateway do SAP
    const todos: NonNullable<SapPedidosResp['pedidos']> = [];
    for (const [datain, datafim] of janelasDeDias(90, 15)) {
      const r = await this.comTentativas(() => this.sap.get<SapPedidosResp>('pedidos', { codvendedor: codVendedor, datain, datafim }));
      todos.push(...(r.pedidos ?? []));
    }

    const pedidos = todos.map((p) => ({
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
    }));
    await this.upsert('pedidos_sap', pedidos, 'ordem');

    // itens: so das ordens novas ou que ainda mudam (a funcao SQL decide)
    const { data, error } = await this.sb.rpc('fn_ordens_para_itens', { p_rota: rota });
    if (error) throw error;
    const ordens = ((data ?? []) as Array<{ ordem: string }>).map((o) => o.ordem);

    let totalItens = 0;
    for (let i = 0; i < ordens.length; i += LOTE_ORDENS) {
      const lote = ordens.slice(i, i + LOTE_ORDENS);
      const it = await this.sap.get<SapItensResp>('itens', {
        codvendedor: codVendedor,
        ordens: lote.join(','),
      });
      const linhas = (it.ordens ?? []).flatMap((o) =>
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
          synced_at: inicio,
        })),
      );
      await this.upsert('pedido_itens_sap', linhas, 'ordem,item');
      totalItens += linhas.length;
    }

    this.logger.log(`Rota ${rota}: ${pedidos.length} pedidos, ${totalItens} itens`);
    return pedidos.length;
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

    for (let i = 0; i < lista.length; i += LOTE_DB) {
      const { error } = await this.sb.from(table).upsert(lista.slice(i, i + LOTE_DB), { onConflict });
      if (error) throw new Error(`upsert ${table}: ${error.message}`);
    }
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
