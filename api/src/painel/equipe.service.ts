import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod, VendedoresService } from '../auth/vendedores.service';
import { SUPABASE } from '../supabase/supabase.module';
import { ConsultaPainelService } from './consulta-painel.service';
import { UsuarioPainel } from './painel.guard';

type Linha = Record<string, any>;

/** Quem pode usar o app "como" um vendedor da equipe. */
export const PAPEIS_EQUIPE = ['admin', 'supervisor', 'gerente', 'gerente_geral'];

const hojeSp = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
/** 1 = segunda ... 7 = domingo, no fuso de Sao Paulo. */
const diaSemanaSp = () => {
  const d = new Date(`${hojeSp()}T12:00:00-03:00`).getUTCDay();
  return d === 0 ? 7 : d;
};

/** Modo equipe do app: supervisor/gerente enxergam os vendedores deles e abrem o app como um deles. */
@Injectable()
export class EquipeService {
  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly vendedores: VendedoresService,
    private readonly consulta: ConsultaPainelService,
  ) {}

  /** O app pergunta no login: este usuario usa o app como vendedor, como equipe, ou os dois? */
  async eu(u: UsuarioPainel) {
    const proprio = await this.vendedores.porEmail(u.email);
    return {
      equipe: PAPEIS_EQUIPE.includes(u.papel),
      papel: u.papel,
      nome: u.nome,
      permissoes: u.permissoes,
      vendedor_proprio: proprio?.codVendedor ?? null,
    };
  }

  private exigirEquipe(u: UsuarioPainel) {
    if (!PAPEIS_EQUIPE.includes(u.papel)) throw new ForbiddenException('Seu perfil nao tem modo equipe');
  }

  /** Vendedores da equipe (todos, para admin e gerente geral). */
  async listarVendedores(u: UsuarioPainel) {
    this.exigirEquipe(u);
    let q = this.sb.from('vendedores').select('cod_vendedor, nome, rota, escritorio, equipe').not('rota', 'is', null);
    if (u.escopo) q = q.in('cod_vendedor', u.escopo.vendedores);
    const { data, error } = await q.order('nome').limit(5000);
    if (error) throw error;
    return (data ?? []) as Linha[];
  }

  /** Vendas dos ultimos 3 meses da equipe (total por mes) e, no mes atual, por vendedor. */
  async vendas(u: UsuarioPainel) {
    this.exigirEquipe(u);
    const hoje = hojeSp();
    const [ano, mes] = hoje.split('-').map(Number);
    const base = ano * 12 + (mes - 1) - 2; // 3 meses: o atual e os 2 anteriores
    const meses = Array.from({ length: 3 }, (_, i) => `${Math.floor((base + i) / 12)}-${String(((base + i) % 12) + 1).padStart(2, '0')}`);
    const vazio = { meses: meses.map((m) => ({ mes: m, valor: 0, pedidos: 0 })), mes_atual: meses[2], por_vendedor: [] as Linha[] };
    if (u.escopo && !u.escopo.rotas.length) return vazio;

    const [vendas, ven] = await Promise.all([
      this.sb.rpc('fn_equipe_vendas', { p_ini: `${meses[0]}-01`, p_rotas: u.escopo?.rotas ?? null }),
      (() => {
        let q = this.sb.from('vendedores').select('cod_vendedor, nome, rota').not('rota', 'is', null);
        if (u.escopo) q = q.in('cod_vendedor', u.escopo.vendedores);
        return q.limit(5000);
      })(),
    ]);
    if (vendas.error) throw new Error(`fn_equipe_vendas: ${vendas.error.message}`);
    if (ven.error) throw ven.error;

    const linhas = (vendas.data ?? []) as Linha[];
    const porMes = new Map(meses.map((m) => [m, { mes: m, valor: 0, pedidos: 0 }]));
    for (const l of linhas) {
      const x = porMes.get(l.mes as string);
      if (x) {
        x.valor += Number(l.valor);
        x.pedidos += Number(l.pedidos);
      }
    }
    // por vendedor (mes atual): a venda e da rota; vendedores da mesma rota dividem o mesmo numero
    const rotaDe = new Map<string, Linha>(linhas.filter((l) => l.mes === meses[2]).map((l) => [l.rota as string, l]));
    const porVendedor = ((ven.data ?? []) as Linha[])
      .map((v) => {
        const r = rotaDe.get(v.rota as string);
        return { cod_vendedor: v.cod_vendedor as string, nome: v.nome as string | null, valor: r ? Number(r.valor) : 0, pedidos: r ? Number(r.pedidos) : 0, clientes: r ? Number(r.clientes) : 0 };
      })
      .sort((a, b) => b.valor - a.valor);
    return { meses: [...porMes.values()], mes_atual: meses[2], por_vendedor: porVendedor };
  }

  /** Pedido do SAP (itens, notas, DANFE/boleto) para a tela do app; so pedidos de clientes da equipe. */
  pedido(u: UsuarioPainel, ordem: string) {
    this.exigirEquipe(u);
    return this.consulta.pedido(ordem, u.escopo);
  }

  /** Dados de um cliente (cadastro, compras, financeiro, visitas) para a tela do app; so clientes da equipe. */
  cliente(u: UsuarioPainel, cod: string) {
    this.exigirEquipe(u);
    return this.consulta.cliente(cod, u.escopo);
  }

  /** Vendedores da equipe com o tamanho da carteira (a tela de clientes comeca por aqui). */
  async carteiras(u: UsuarioPainel) {
    this.exigirEquipe(u);
    if (u.escopo && !u.escopo.vendedores.length) return [] as Linha[];
    const { data, error } = await this.sb.rpc('fn_equipe_carteiras', { p_vendedores: u.escopo?.vendedores ?? null });
    if (error) throw new Error(`fn_equipe_carteiras: ${error.message}`);
    return ((data ?? []) as Linha[]).map((x) => ({ cod_vendedor: x.cod_vendedor as string, nome: x.nome as string | null, clientes: Number(x.clientes) }));
  }

  /** Clientes das carteiras da equipe (busca no servidor; 30 por pagina), de um vendedor (`vendedor`) ou de todos. */
  async clientes(u: UsuarioPainel, busca?: string, paginaRaw?: string, vendedorRaw?: string) {
    this.exigirEquipe(u);
    const vendedor = normCod(String(vendedorRaw ?? '').trim() || '0') === '0' ? '' : normCod(String(vendedorRaw));
    if (vendedor && u.escopo && !u.escopo.vendedores.includes(vendedor)) throw new ForbiddenException('Este vendedor nao e da sua equipe');
    const POR_PAGINA = 30;
    const pg = Math.max(1, Math.trunc(Number(paginaRaw)) || 1);
    if (u.escopo && !u.escopo.rotas.length) return { pagina: pg, por_pagina: POR_PAGINA, total: 0, itens: [] as Linha[] };
    const { data, error } = await this.sb.rpc('fn_clientes_painel', {
      p_vendedor: vendedor, p_busca: String(busca ?? '').trim().replace(/[%_]/g, ' ').slice(0, 80), p_escritorio: '', p_canal: '', p_situacao: '',
      p_limite: POR_PAGINA, p_offset: (pg - 1) * POR_PAGINA, p_rotas: u.escopo?.rotas ?? null,
    });
    if (error) throw new Error(`fn_clientes_painel: ${error.message}`);
    const l = (data ?? []) as Linha[];
    return {
      pagina: pg,
      por_pagina: POR_PAGINA,
      total: l.length ? Number(l[0].total) : 0,
      itens: l.map((x) => ({
        cod_cliente: x.cod_cliente as string, nome: x.nome as string | null, cidade: x.cidade as string | null, uf: x.uf as string | null,
        rota: x.rota as string | null, vendedor: x.vendedor as string | null, ultima_compra: x.ultima_compra as string | null,
        valor_12m: Number(x.valor_12m), vencido: Number(x.vencido), pagamento_antecipado: x.pagamento_antecipado === true,
      })),
    };
  }

  /** Resumo de hoje por vendedor: visitas do roteiro, feitas, em andamento e com venda (sem listar cliente a cliente). */
  async hoje(u: UsuarioPainel) {
    this.exigirEquipe(u);
    if (u.escopo && !u.escopo.vendedores.length) return { data: hojeSp(), vendedores: [], total: { planejadas: 0, realizadas: 0, em_andamento: 0, com_venda: 0 } };
    const { data, error } = await this.sb.rpc('fn_equipe_hoje', { p_dia: diaSemanaSp(), p_data: hojeSp(), p_vendedores: u.escopo?.vendedores ?? null });
    if (error) throw new Error(`fn_equipe_hoje: ${error.message}`);
    const vendedores = ((data ?? []) as Linha[]).map((x) => ({
      cod_vendedor: x.cod_vendedor as string, nome: x.nome as string | null, escritorio: x.escritorio as string | null, equipe: x.equipe as string | null,
      planejadas: Number(x.planejadas), realizadas: Number(x.realizadas), em_andamento: Number(x.em_andamento), com_venda: Number(x.com_venda),
    }));
    const soma = (k: 'planejadas' | 'realizadas' | 'em_andamento' | 'com_venda') => vendedores.reduce((a, v) => a + v[k], 0);
    return { data: hojeSp(), vendedores, total: { planejadas: soma('planejadas'), realizadas: soma('realizadas'), em_andamento: soma('em_andamento'), com_venda: soma('com_venda') } };
  }
}
