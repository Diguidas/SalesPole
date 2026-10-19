import { randomUUID } from 'node:crypto';
import { BadGatewayException, Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod } from '../auth/vendedores.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { SUPABASE } from '../supabase/supabase.module';
import { SyncService } from '../sync/sync.service';
import { UsuarioPainel } from './painel.guard';

type Linha = Record<string, any>;

/** Unidade em que o pedido e feito quando o produto nao informa (a caixa). Igual ao app. */
const UNIDADE_PEDIDO_PADRAO = 'KI';
const PRAZO_SAP_MS = 25_000;

/** Pedido criado pelo painel em nome de um vendedor: passa pelas MESMAS regras do pedido do app. */
@Injectable()
export class PedidoPainelService {
  private readonly logger = new Logger(PedidoPainelService.name);

  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly pedidos: PedidosService,
    private readonly sync: SyncService,
  ) {}

  /** Vendedores com rota (so esses tem carteira para vender): para o seletor do formulario. */
  async vendedores() {
    const { data, error } = await this.sb.from('vendedores').select('cod_vendedor, nome, rota').not('rota', 'is', null).order('nome').limit(5000);
    if (error) throw error;
    return (data ?? []) as Linha[];
  }

  /**
   * Clientes da carteira do vendedor (busca por nome ou codigo; sem busca, os primeiros da rota).
   * `carteira_carregada = false`: o vendedor existe mas a carteira dele ainda nao veio do SAP (ver `carregarCarteira`).
   */
  async clientes(codVendedor: string, q = ''): Promise<{ carteira_carregada: boolean; clientes: Linha[] }> {
    const rota = await this.rotaDe(codVendedor);
    const { data: algum, error: eAlgum } = await this.sb.from('rota_clientes').select('cod_cliente').eq('rota', rota).limit(1);
    if (eAlgum) throw eAlgum;
    if (!algum?.length) return { carteira_carregada: false, clientes: [] };
    return { carteira_carregada: true, clientes: await this.buscarClientes(rota, q) };
  }

  /** Traz do SAP a carteira (clientes e rota) de UM vendedor, sem esperar a sincronizacao das 7h/14h. */
  async carregarCarteira(codVendedor: string) {
    const cod = normCod(codVendedor);
    if (!/^\d+$/.test(cod) || cod === '0') throw new UnprocessableEntityException('Escolha o vendedor');
    try {
      const rota = await this.sync.sincronizarVendedor(cod);
      const r = await this.sync.rodar('clientes', rota, () => this.sync.sincronizarClientes(cod, rota));
      if (!r.ok) throw new Error(r.erro ?? 'falha ao buscar os clientes');
      return { rota, clientes: r.linhas ?? 0 };
    } catch (e) {
      if (e instanceof UnprocessableEntityException) throw e;
      throw new BadGatewayException(`SAP nao respondeu: ${(e as Error).message}`);
    }
  }

  private async buscarClientes(rota: string, q: string): Promise<Linha[]> {
    const t = q.trim().replace(/[%_,()]/g, ' ').trim();

    let codigos: string[];
    if (t.length >= 2) {
      const like = `%${t}%`;
      const [porNome, porRazao, porCod] = await Promise.all([
        this.sb.from('clientes').select('cod_cliente').ilike('nome_fantasia', like).limit(60),
        this.sb.from('clientes').select('cod_cliente').ilike('razao_social', like).limit(60),
        this.sb.from('clientes').select('cod_cliente').ilike('cod_cliente', like).limit(60),
      ]);
      for (const r of [porNome, porRazao, porCod]) if (r.error) throw r.error;
      const achados = [...new Set([...(porCod.data ?? []), ...(porNome.data ?? []), ...(porRazao.data ?? [])].map((c: Linha) => c.cod_cliente as string))];
      if (!achados.length) return [];
      const { data, error } = await this.sb.from('rota_clientes').select('cod_cliente').eq('rota', rota).in('cod_cliente', achados);
      if (error) throw error;
      codigos = [...new Set((data ?? []).map((c: Linha) => c.cod_cliente as string))].slice(0, 40);
    } else {
      const { data, error } = await this.sb.from('rota_clientes').select('cod_cliente').eq('rota', rota).order('sequencia').limit(80);
      if (error) throw error;
      codigos = [...new Set((data ?? []).map((c: Linha) => c.cod_cliente as string))].slice(0, 40);
    }
    if (!codigos.length) return [];

    const { data: cli, error: e2 } = await this.sb.from('clientes').select('cod_cliente, nome_fantasia, razao_social, bloqueado, pedido_minimo, pagamento_antecipado').in('cod_cliente', codigos);
    if (e2) throw e2;
    const porCod = new Map(((cli ?? []) as Linha[]).map((c) => [c.cod_cliente as string, c]));
    // cliente da carteira sem cadastro baixado ainda aparece (so com o codigo), em vez de sumir
    return codigos
      .map((cod) => {
        const c = porCod.get(cod);
        return { cod_cliente: cod, nome: c ? c.nome_fantasia || c.razao_social : null, bloqueado: c?.bloqueado === true, pedido_minimo: c?.pedido_minimo == null ? null : Number(c.pedido_minimo), pagamento_antecipado: c?.pagamento_antecipado === true };
      })
      .sort((a, b) => String(a.nome ?? '￿').localeCompare(String(b.nome ?? '￿'), 'pt-BR'));
  }

  /**
   * Cria o pedido em nome do vendedor e ja tenta enviar ao SAP. O vendedor ve o pedido no app na proxima sincronizacao.
   * Valida cliente da carteira, descontos e unidade como o pedido normal; o SAP continua sendo quem decide.
   */
  async criar(u: UsuarioPainel, corpo: Record<string, any>) {
    const cod = normCod(String(corpo?.cod_vendedor ?? ''));
    if (!/^\d+$/.test(cod) || cod === '0') throw new UnprocessableEntityException('Escolha o vendedor');
    const rota = await this.rotaDe(cod);

    const itensIn = Array.isArray(corpo.itens) ? corpo.itens : [];
    if (itensIn.length === 0) throw new UnprocessableEntityException('Inclua ao menos um produto');
    if (itensIn.length > 200) throw new UnprocessableEntityException('Produtos demais no pedido');

    // unidade padrao de cada produto (o formulario ja manda; aqui so completa o que faltar)
    const faltam = [...new Set(itensIn.filter((i: Linha) => !String(i?.unidade ?? '').trim()).map((i: Linha) => String(i?.produto ?? '').trim()))].filter(Boolean);
    const unidades = new Map<string, string>();
    if (faltam.length) {
      const { data, error } = await this.sb.from('produtos').select('cod_produto, dados').in('cod_produto', faltam);
      if (error) throw error;
      for (const p of (data ?? []) as Linha[]) unidades.set(p.cod_produto, String(p.dados?.unidade_venda || UNIDADE_PEDIDO_PADRAO));
    }

    const id = randomUUID();
    const raw = {
      id,
      criado_no_app_em: new Date().toISOString(),
      cod_cliente: String(corpo.cod_cliente ?? ''),
      dt_entrega: corpo.dt_entrega || null,
      ordem_compra_cliente: corpo.ordem_compra_cliente || null,
      observacao: corpo.observacao || null,
      tipo: corpo.tipo === 'bonificacao' ? 'bonificacao' : 'venda',
      tipo_bonificacao: corpo.tipo === 'bonificacao' ? corpo.tipo_bonificacao ?? null : null,
      centro_custo: corpo.tipo === 'bonificacao' ? corpo.centro_custo ?? null : null,
      justificativa: corpo.tipo === 'bonificacao' ? corpo.justificativa ?? null : null,
      itens: itensIn.map((i: Linha) => ({
        produto: String(i?.produto ?? '').trim(),
        unidade: String(i?.unidade ?? '').trim() || unidades.get(String(i?.produto ?? '').trim()) || UNIDADE_PEDIDO_PADRAO,
        quantidade: i?.quantidade,
        preco: i?.preco === '' ? null : i?.preco ?? null,
      })),
    };

    const r = await this.pedidos.receber({ email: u.email, codVendedor: cod, rota }, raw, Date.now() + PRAZO_SAP_MS);

    if (r.status !== 'invalido' && r.status !== 'conflito') {
      const { error } = await this.sb.from('pedidos_app').update({ criado_por_painel: u.email }).eq('id', id);
      if (error) this.logger.warn(`Nao gravou criado_por_painel de ${id}: ${error.message}`);
      await this.sb.from('pedido_eventos').insert({ pedido_id: id, tipo: 'criado_pelo_painel', detalhe: { por: u.email, vendedor: cod } });
      this.logger.log(`Pedido ${id} criado no painel por ${u.email} em nome do vendedor ${cod}`);
    }
    return r;
  }

  private async rotaDe(codVendedor: string): Promise<string> {
    const cod = normCod(codVendedor);
    const { data, error } = await this.sb.from('vendedores').select('rota').eq('cod_vendedor', cod).maybeSingle();
    if (error) throw error;
    if (!data?.rota) throw new UnprocessableEntityException('Vendedor sem carteira sincronizada: marque-o em Vendedores e sincronize');
    return data.rota as string;
  }
}
