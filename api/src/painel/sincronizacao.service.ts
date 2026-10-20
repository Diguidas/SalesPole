import { Inject, Injectable, Logger, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod } from '../auth/vendedores.service';
import { SUPABASE } from '../supabase/supabase.module';
import { ResultadoSync, SyncService } from '../sync/sync.service';

export type RecursoManual = 'carteira' | 'pedidos' | 'historico' | 'precos' | 'produtos';
const RECURSOS: RecursoManual[] = ['carteira', 'pedidos', 'historico', 'precos', 'produtos'];
const DIAS_HISTORICO = 365;
const MAX_CARTEIRAS = 200;
const HISTORICO = 100;

export interface JobSincronizacao {
  id: number;
  rota: string;
  cod_vendedor: string;
  nome: string | null;
  recursos: RecursoManual[];
  status: 'fila' | 'rodando' | 'ok' | 'erro';
  etapa: string | null;
  etapas: Array<{ recurso: string; ok: boolean; ms: number; linhas?: number; erro?: string }>;
  erro: string | null;
  pedido_por: string | null;
  criado_em: string;
  iniciado_em: string | null;
  terminou_em: string | null;
}

/**
 * Sincronizacao manual pedida pelo painel (Monitor): o administrador escolhe as carteiras (rotas) e o que atualizar.
 * Cada carteira e uma linha em `sincronizacoes_painel` (andamento + historico); rodam uma de cada vez, para nao
 * sobrecarregar o SAP. Se a API reiniciar, o que estava rodando fica como interrompido e a fila continua.
 */
@Injectable()
export class SincronizacaoService implements OnModuleInit {
  private readonly logger = new Logger(SincronizacaoService.name);
  private processando = false;
  /** job rodando agora e o que o usuario mandou cancelar (a carga para na proxima janela de 15 dias) */
  private rodandoId: number | null = null;
  private cancelarId: number | null = null;

  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly sync: SyncService,
  ) {}

  async onModuleInit() {
    try {
      await this.sb
        .from('sincronizacoes_painel')
        .update({ status: 'erro', etapa: null, erro: 'Interrompida: a API reiniciou. Peça de novo se precisar.', terminou_em: new Date().toISOString() })
        .in('status', ['fila', 'rodando']);
    } catch (e) {
      this.logger.warn(`Nao limpou a fila de sincronizacao: ${msg(e)}`);
    }
  }

  /** Carteiras que se pode escolher: uma por rota, com os vendedores dela. */
  async carteiras() {
    const { data, error } = await this.sb.from('vendedores').select('cod_vendedor, nome, rota').not('rota', 'is', null).order('nome').limit(5000);
    if (error) throw error;
    const porRota = new Map<string, { rota: string; cod_vendedor: string; nome: string | null; vendedores: string[] }>();
    for (const v of (data ?? []) as Array<{ cod_vendedor: string; nome: string | null; rota: string }>) {
      const atual = porRota.get(v.rota);
      if (atual) atual.vendedores.push(v.nome ?? v.cod_vendedor);
      else porRota.set(v.rota, { rota: v.rota, cod_vendedor: v.cod_vendedor, nome: v.nome, vendedores: [v.nome ?? v.cod_vendedor] });
    }
    return [...porRota.values()];
  }

  /** Enfileira uma carteira por rota escolhida. Rota que ja esta na fila ou rodando nao entra de novo. */
  async iniciar(email: string, rotas: unknown, recursos: unknown) {
    if (!Array.isArray(rotas) || rotas.length === 0) throw new UnprocessableEntityException('Escolha ao menos uma carteira');
    if (rotas.length > MAX_CARTEIRAS) throw new UnprocessableEntityException('Carteiras demais de uma vez');
    const rec = [...new Set((Array.isArray(recursos) ? recursos : []).filter((r): r is RecursoManual => RECURSOS.includes(r as RecursoManual)))];
    if (!rec.length) throw new UnprocessableEntityException('Escolha o que atualizar');

    const escolhidas = new Set(rotas.map(String));
    const carteiras = (await this.carteiras()).filter((c) => escolhidas.has(c.rota));
    if (!carteiras.length) throw new UnprocessableEntityException('Carteira nao encontrada');

    const { data: ativas, error: eAtivas } = await this.sb.from('sincronizacoes_painel').select('rota').in('status', ['fila', 'rodando']);
    if (eAtivas) throw eAtivas;
    const jaTem = new Set((ativas ?? []).map((a: { rota: string }) => a.rota));
    const novas = carteiras.filter((c) => !jaTem.has(c.rota));

    if (novas.length) {
      const { error } = await this.sb.from('sincronizacoes_painel').insert(
        // o catalogo de produtos e igual para todos: so a primeira carteira do pedido o baixa
        novas.map((c, i) => ({ rota: c.rota, cod_vendedor: normCod(c.cod_vendedor), nome: c.nome, recursos: i === 0 ? rec : rec.filter((r) => r !== 'produtos'), pedido_por: email })),
      );
      if (error) throw error;
      void this.processar();
    }
    return { enfileiradas: novas.length, ja_na_fila: carteiras.length - novas.length };
  }

  /** Cancela tudo: o que esta na fila sai na hora; o que esta rodando para na proxima janela (cerca de 1 min). */
  async cancelar() {
    const { data, error } = await this.sb
      .from('sincronizacoes_painel')
      .update({ status: 'erro', etapa: null, erro: 'Cancelada pelo usuario', terminou_em: new Date().toISOString() })
      .eq('status', 'fila')
      .select('id');
    if (error) throw error;
    if (this.rodandoId !== null) this.cancelarId = this.rodandoId;
    return { canceladas_na_fila: (data ?? []).length, parando_a_que_roda: this.rodandoId !== null };
  }

  /** Em andamento (rodando e na fila) e historico (ultimos terminados), mais a hora do servidor para o relogio do painel. */
  async lista() {
    const [ativas, hist] = await Promise.all([
      this.sb.from('sincronizacoes_painel').select('*').in('status', ['fila', 'rodando']).order('id', { ascending: true }).limit(500),
      this.sb.from('sincronizacoes_painel').select('*').in('status', ['ok', 'erro']).order('id', { ascending: false }).limit(HISTORICO),
    ]);
    if (ativas.error) throw ativas.error;
    if (hist.error) throw hist.error;
    return {
      agora: new Date().toISOString(),
      ativas: (ativas.data ?? []) as JobSincronizacao[],
      historico: (hist.data ?? []) as JobSincronizacao[],
    };
  }

  private async processar() {
    if (this.processando) return;
    this.processando = true;
    try {
      for (;;) {
        const { data, error } = await this.sb.from('sincronizacoes_painel').select('*').eq('status', 'fila').order('id', { ascending: true }).limit(1);
        if (error) throw error;
        const job = (data ?? [])[0] as JobSincronizacao | undefined;
        if (!job) break;
        await this.executar(job);
      }
    } catch (e) {
      this.logger.error(`Fila de sincronizacao parou: ${msg(e)}`);
    } finally {
      this.processando = false;
    }
  }

  private async gravar(id: number, campos: Partial<JobSincronizacao>) {
    const { error } = await this.sb.from('sincronizacoes_painel').update(campos).eq('id', id);
    if (error) this.logger.warn(`Nao gravou o andamento da sincronizacao ${id}: ${error.message}`);
  }

  private async executar(job: JobSincronizacao) {
    this.rodandoId = job.id;
    const deveParar = () => this.cancelarId === job.id;
    const etapas: JobSincronizacao['etapas'] = [];
    let erro: string | null = null;
    const registrar = async (r: ResultadoSync) => {
      etapas.push({ recurso: r.recurso, ok: r.ok, ms: r.ms, linhas: r.linhas, erro: r.erro });
      await this.gravar(job.id, { etapas: [...etapas] });
      return r;
    };
    await this.gravar(job.id, { status: 'rodando', iniciado_em: new Date().toISOString() });
    try {
      let rota = job.rota;
      if (job.recursos.includes('carteira')) {
        await this.gravar(job.id, { etapa: 'Carteira e clientes' });
        const t0 = Date.now();
        try {
          rota = await this.sync.sincronizarVendedor(job.cod_vendedor);
          const { count } = await this.sb.from('rota_clientes').select('cod_cliente', { count: 'exact', head: true }).eq('rota', rota);
          await registrar({ recurso: 'carteira', ok: true, ms: Date.now() - t0, linhas: count ?? 0 });
        } catch (e) {
          await this.sync.registrarErro('vendedor', job.cod_vendedor, e).catch(() => undefined);
          await registrar({ recurso: 'carteira', ok: false, ms: Date.now() - t0, erro: msg(e) });
          throw e;
        }
        const r = await registrar(await this.sync.rodar('clientes', rota, () => this.sync.sincronizarClientes(job.cod_vendedor, rota)));
        if (!r.ok) erro = `Clientes: ${r.erro}`;
      }
      if (job.recursos.includes('produtos')) {
        await this.gravar(job.id, { etapa: 'Catálogo de produtos' });
        const r = await registrar(await this.sync.rodar('produtos', '*', () => this.sync.sincronizarProdutos()));
        if (!r.ok) erro = erro ? `${erro}; Produtos: ${r.erro}` : `Produtos: ${r.erro}`;
      }
      if (job.recursos.includes('precos')) {
        await this.gravar(job.id, { etapa: 'Tabelas de preço' });
        const r = await registrar(await this.sync.rodar('precos', rota, () => this.sync.sincronizarPrecos(job.cod_vendedor, rota)));
        if (!r.ok) erro = erro ? `${erro}; Preços: ${r.erro}` : `Preços: ${r.erro}`;
      }
      if (job.recursos.includes('pedidos')) {
        await this.gravar(job.id, { etapa: 'Pedidos' });
        const r = await registrar(await this.sync.rodar('pedidos', rota, () => this.sync.sincronizarPedidos(job.cod_vendedor, rota, 90, true, deveParar)));
        if (!r.ok) erro = erro ? `${erro}; Pedidos: ${r.erro}` : `Pedidos: ${r.erro}`;
      }
      if (job.recursos.includes('historico')) {
        // carga de 12 meses (so cabecalho dos pedidos: o que os indicadores usam). Nao entra em sync_estado, para nao aparecer como "atrasada" no Monitor.
        await this.gravar(job.id, { etapa: `Historico (${DIAS_HISTORICO} dias)` });
        const t0 = Date.now();
        try {
          const linhas = await this.sync.sincronizarPedidos(job.cod_vendedor, rota, DIAS_HISTORICO, false, deveParar);
          await registrar({ recurso: 'historico', ok: true, ms: Date.now() - t0, linhas });
        } catch (e) {
          await registrar({ recurso: 'historico', ok: false, ms: Date.now() - t0, erro: msg(e) });
          erro = erro ? `${erro}; Historico: ${msg(e)}` : `Historico: ${msg(e)}`;
        }
      }
    } catch (e) {
      erro = `Carteira: ${msg(e)}`;
    }
    if (deveParar() && !erro) erro = 'Cancelada pelo usuario';
    this.rodandoId = null;
    this.cancelarId = null;
    await this.gravar(job.id, { status: erro ? 'erro' : 'ok', etapa: null, erro, terminou_em: new Date().toISOString() });
    this.logger.log(`Sincronizacao manual da rota ${job.rota}: ${erro ? `erro (${erro})` : 'ok'}`);
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
