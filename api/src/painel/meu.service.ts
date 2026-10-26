import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod } from '../auth/vendedores.service';
import { SUPABASE } from '../supabase/supabase.module';
import { validarRespostas } from '../visitas/visita.validacao';
import { exigirVendedor } from './escopo';
import { UsuarioPainel } from './painel.guard';

type Linha = Record<string, any>;

const FAIXAS_PARADO = [15, 30, 60, 90, 180];
const FILTROS_TITULO = ['abertos', 'atrasados', 'todos'];

const hojeSp = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
/** 1 = segunda ... 7 = domingo, no fuso de Sao Paulo. */
const diaSemanaSp = () => {
  const d = new Date(`${hojeSp()}T12:00:00-03:00`).getUTCDay();
  return d === 0 ? 7 : d;
};
const num = (v: unknown) => (v == null ? null : Number(v));
const soma = (l: Linha[], k: string) => Math.round(l.reduce((a, x) => a + Number(x[k] ?? 0), 0) * 100) / 100;

interface Alvo {
  cod: string;
  nome: string | null;
  rota: string;
}

/**
 * O painel como ferramenta de quem vende: "Hoje", carteira parada, titulos, visita e avisos da carteira de UM vendedor.
 * O vendedor so enxerga a propria; admin e a hierarquia escolhem um vendedor do escopo (`vendedor`) para ver como ele ve.
 */
@Injectable()
export class MeuService {
  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {}

  /** Quem e o vendedor desta chamada: o proprio (papel vendedor) ou, para quem supervisiona, o escolhido dentro do escopo. */
  async alvo(u: UsuarioPainel, vendedorRaw?: string): Promise<Alvo> {
    const bruto = u.papel === 'vendedor' ? u.cod_sap : vendedorRaw;
    const cod = normCod(String(bruto ?? ''));
    if (!/^\d{1,10}$/.test(cod) || cod === '0') {
      throw new UnprocessableEntityException(u.papel === 'vendedor' ? 'Seu usuario nao tem o codigo SAP de vendedor. Peca a um administrador.' : 'Escolha o vendedor');
    }
    exigirVendedor(u.escopo, cod);
    const { data, error } = await this.sb.from('vendedores').select('cod_vendedor, nome, rota').eq('cod_vendedor', cod).maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Vendedor nao encontrado');
    const v = data as { cod_vendedor: string; nome: string | null; rota: string | null };
    if (!v.rota) throw new ConflictException('A carteira deste vendedor ainda nao foi sincronizada com o SAP');
    return { cod, nome: v.nome, rota: v.rota };
  }

  /** O vendedor que a tela de listas ja pode usar quando o usuario e supervisor (select) ou o proprio vendedor. */
  async eu(u: UsuarioPainel, vendedor?: string) {
    const a = await this.alvo(u, vendedor);
    return { cod_vendedor: a.cod, nome: a.nome, rota: a.rota };
  }

  /** Roteiro do dia (ou de outro dia da semana), entregas, vendas do mes e quanto da visita ja foi feito. */
  async hoje(u: UsuarioPainel, vendedor?: string, diaRaw?: string) {
    const a = await this.alvo(u, vendedor);
    const data = hojeSp();
    const dia = diaRaw ? Math.trunc(Number(diaRaw)) : diaSemanaSp();
    if (!(dia >= 1 && dia <= 7)) throw new UnprocessableEntityException('Dia da semana invalido (1 a 7)');

    const [ano, mes] = data.split('-').map(Number);
    const mesAnt = mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`;
    const mesAtual = data.slice(0, 7);

    const [rot, ent, vendas] = await Promise.all([
      this.sb.rpc('fn_meu_roteiro', { p_rota: a.rota, p_dia: dia, p_data: data }),
      this.sb.rpc('fn_entregas_dia', { p_rota: a.rota, p_data: data }),
      this.sb.rpc('fn_equipe_vendas', { p_ini: `${mesAnt}-01`, p_rotas: [a.rota] }),
    ]);
    if (rot.error) throw new Error(`fn_meu_roteiro: ${rot.error.message}`);
    if (ent.error) throw new Error(`fn_entregas_dia: ${ent.error.message}`);
    if (vendas.error) throw new Error(`fn_equipe_vendas: ${vendas.error.message}`);

    const roteiro = ((rot.data ?? []) as Linha[]).map((x) => ({
      cod_cliente: x.cod_cliente as string,
      nome: x.nome as string | null,
      cidade: x.cidade as string | null,
      uf: x.uf as string | null,
      sequencia: Number(x.sequencia),
      bloqueado: x.bloqueado === true,
      pagamento_antecipado: x.pagamento_antecipado === true,
      limite_disponivel: num(x.limite_disponivel),
      ultima_compra: x.ultima_compra as string | null,
      dias_sem_comprar: num(x.dias_sem_comprar),
      vencido: Number(x.vencido ?? 0),
      visita_id: x.visita_id as string | null,
      visita_status: x.visita_status as string | null,
      visita_resultado: x.visita_resultado as string | null,
      comprou_hoje: x.comprou_hoje === true,
    }));
    const doMes = (m: string) => ((vendas.data ?? []) as Linha[]).find((l) => l.mes === m);
    const v = (m: string) => ({ valor: Number(doMes(m)?.valor ?? 0), pedidos: Number(doMes(m)?.pedidos ?? 0), clientes: Number(doMes(m)?.clientes ?? 0) });

    return {
      vendedor: { cod_vendedor: a.cod, nome: a.nome, rota: a.rota },
      data,
      dia_semana: dia,
      eh_hoje: dia === diaSemanaSp(),
      vendas_mes: { mes: mesAtual, ...v(mesAtual), anterior: { mes: mesAnt, ...v(mesAnt) } },
      resumo: {
        planejadas: roteiro.length,
        visitadas: roteiro.filter((c) => c.visita_status === 'concluida').length,
        em_andamento: roteiro.filter((c) => c.visita_status === 'em_andamento').length,
        com_venda: roteiro.filter((c) => c.comprou_hoje || c.visita_resultado === 'vendeu').length,
        bloqueados: roteiro.filter((c) => c.bloqueado).length,
        com_vencido: roteiro.filter((c) => c.vencido > 0).length,
      },
      roteiro,
      entregas: ((ent.data ?? []) as Linha[]).map((x) => ({ cod_cliente: x.cod_cliente as string, nome: x.nome as string | null, ordens: Number(x.ordens), itens: Number(x.itens), com_corte: x.com_corte === true })),
    };
  }

  /**
   * Pedidos com problema nos clientes da carteira: o que o SAP vai entregar a menos (corte, nas remessas de hoje em diante),
   * o que recusou e o que faturou a menos (pedidos dos ultimos `dias` dias). O vendedor avisa o cliente antes de ele reclamar.
   */
  async alertas(u: UsuarioPainel, vendedor?: string, diasRaw?: string) {
    const a = await this.alvo(u, vendedor);
    const dias = Math.min(30, Math.max(1, Math.trunc(Number(diasRaw)) || 7));
    const { data, error } = await this.sb.rpc('fn_meu_alertas', { p_rota: a.rota, p_dias: dias });
    if (error) throw new Error(`fn_meu_alertas: ${error.message}`);
    const itens = ((data ?? []) as Linha[]).map((x) => ({
      tipo: x.tipo as 'corte' | 'recusa' | 'faturado_menos',
      cod_cliente: x.cod_cliente as string,
      cliente: x.nome as string | null,
      telefone: x.telefone as string | null,
      ordem: x.ordem as string,
      item: x.item as string,
      cod_produto: x.cod_produto as string | null,
      produto: x.denominacao as string | null,
      unidade: x.unidade as string | null,
      pedido: num(x.quantidade_pedida),
      confirmado: num(x.quantidade_confirmada),
      data: x.data_ref as string | null,
      motivo: x.motivo as string | null,
      cod_motivo: x.cod_motivo as string | null,
    }));
    const conta = (t: string) => itens.filter((i) => i.tipo === t).length;
    return {
      dias,
      total: itens.length,
      clientes: new Set(itens.map((i) => i.cod_cliente)).size,
      por_tipo: { corte: conta('corte'), recusa: conta('recusa'), faturado_menos: conta('faturado_menos') },
      itens,
    };
  }

  /** Clientes da carteira sem compra ha mais de `dias` dias (15, 30, 60, 90 ou 180). */
  async carteiraParada(u: UsuarioPainel, vendedor?: string, diasRaw?: string) {
    const a = await this.alvo(u, vendedor);
    const dias = Math.trunc(Number(diasRaw)) || 30;
    if (!FAIXAS_PARADO.includes(dias)) throw new UnprocessableEntityException(`dias deve ser um de ${FAIXAS_PARADO.join(', ')}`);
    const { data, error } = await this.sb.rpc('fn_carteira_parada', { p_rota: a.rota, p_dias: dias });
    if (error) throw new Error(`fn_carteira_parada: ${error.message}`);
    const itens = ((data ?? []) as Linha[]).map((x) => ({
      cod_cliente: x.cod_cliente as string,
      nome: x.nome as string | null,
      cidade: x.cidade as string | null,
      uf: x.uf as string | null,
      bloqueado: x.bloqueado === true,
      ultima_compra: x.ultima_compra as string | null,
      dias: num(x.dias),
      vencido: Number(x.vencido ?? 0),
      dias_visita: (x.dias_visita ?? []) as number[],
    }));
    return { dias, faixas: FAIXAS_PARADO, total: itens.length, nunca_compraram: itens.filter((i) => i.ultima_compra == null).length, itens };
  }

  /** Titulos de todos os clientes da carteira: em aberto, atrasados ou todos (90 dias). */
  async titulos(u: UsuarioPainel, vendedor?: string, filtroRaw?: string) {
    const a = await this.alvo(u, vendedor);
    const filtro = FILTROS_TITULO.includes(String(filtroRaw)) ? String(filtroRaw) : 'abertos';
    const { data, error } = await this.sb.rpc('fn_titulos_carteira', { p_rota: a.rota, p_filtro: filtro, p_limite: 1000 });
    if (error) throw new Error(`fn_titulos_carteira: ${error.message}`);
    const itens = ((data ?? []) as Linha[]).map((x) => ({
      cod_cliente: x.cod_cliente as string,
      nome: x.nome as string | null,
      nfe: x.nfe as string,
      parcela: x.parcela as string,
      status: x.status as string | null,
      valor: Number(x.valor ?? 0),
      vencimento: x.vencimento as string | null,
      dt_compensacao: x.dt_compensacao as string | null,
      danfe_url: x.danfe_url as string | null,
      boleto_url: x.boleto_url as string | null,
      dias_atraso: Number(x.dias_atraso ?? 0),
    }));
    const atrasados = itens.filter((t) => t.status === 'Atrasado');
    return {
      filtro,
      total: itens.length,
      valor_atrasado: soma(atrasados, 'valor'),
      valor_em_aberto: soma(itens.filter((t) => t.status === 'Em aberto'), 'valor'),
      clientes_atrasados: new Set(atrasados.map((t) => t.cod_cliente)).size,
      itens,
    };
  }

  /** Avisos do painel vigentes para este vendedor (geral, dele, e os de escritorio/canal onde ele tem cliente). */
  async avisos(u: UsuarioPainel, vendedor?: string) {
    const a = await this.alvo(u, vendedor);
    const hoje = hojeSp();
    const [av, ar] = await Promise.all([
      this.sb.from('avisos').select('id, titulo, mensagem, nivel, escopo, escopo_valor, vigencia_ini, vigencia_fim, updated_at').eq('ativo', true).order('updated_at', { ascending: false }).limit(50),
      this.sb.rpc('fn_carteira_areas', { p_rota: a.rota }),
    ]);
    if (av.error) throw av.error;
    if (ar.error) throw new Error(`fn_carteira_areas: ${ar.error.message}`);
    const areas = (ar.data ?? []) as Array<{ tipo: string; codigo: string }>;
    const escritorios = new Set(areas.filter((x) => x.tipo === 'e').map((x) => x.codigo));
    const canais = new Set(areas.filter((x) => x.tipo === 'c').map((x) => x.codigo));
    const valores = (s: string | null) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const ordem: Record<string, number> = { urgente: 0, importante: 1, info: 2 };

    return ((av.data ?? []) as Linha[])
      .filter((x) => (!x.vigencia_ini || x.vigencia_ini <= hoje) && (!x.vigencia_fim || x.vigencia_fim >= hoje))
      .filter((x) => {
        if (x.escopo === 'geral') return true;
        if (x.escopo === 'vendedor') return valores(x.escopo_valor).includes(a.cod);
        if (x.escopo === 'escritorio') return valores(x.escopo_valor).some((v) => escritorios.has(v));
        if (x.escopo === 'canal') return valores(x.escopo_valor).some((v) => canais.has(v));
        return false;
      })
      .sort((x, y) => (ordem[x.nivel] ?? 2) - (ordem[y.nivel] ?? 2) || String(y.updated_at).localeCompare(String(x.updated_at)))
      .map((x) => ({ id: x.id as string, titulo: x.titulo as string, mensagem: x.mensagem as string, nivel: x.nivel as string, atualizado_em: x.updated_at as string }));
  }

  /** Paineis de BI liberados para o painel (Cadastros -> Paineis de BI: "Painel" ou "Painel e app"). */
  async bi() {
    const { data, error } = await this.sb.from('bi_paineis').select('id, nome, url').eq('ativo', true).in('onde', ['painel', 'ambos']).order('ordem').order('nome');
    if (error) throw error;
    return data ?? [];
  }

  // ---------------- visita pelo computador (sem GPS e sem foto) ----------------

  /** Perguntas da visita que valem para este cliente (as gerais, as do vendedor e as do escritorio, canal ou cliente dele). */
  async perguntas(u: UsuarioPainel, codCliente: string, vendedor?: string) {
    const a = await this.alvo(u, vendedor);
    const cli = await this.clienteDaCarteira(a, codCliente);
    const esc = new Set<string>();
    const can = new Set<string>();
    for (const ar of (Array.isArray(cli.areas) ? cli.areas : []) as Linha[]) {
      if (ar?.escritorio?.codigo) esc.add(String(ar.escritorio.codigo));
      if (ar?.canal?.codigo) can.add(String(ar.canal.codigo));
    }
    const { data, error } = await this.sb.from('visita_perguntas').select('id, texto, tipo, opcoes, obrigatoria, escopo, escopo_valor, ordem').eq('ativo', true).order('ordem');
    if (error) throw error;
    const valores = (s: string | null) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return ((data ?? []) as Linha[])
      .filter((p) => {
        if (p.escopo === 'geral') return true;
        if (p.escopo === 'vendedor') return valores(p.escopo_valor).includes(a.cod);
        if (p.escopo === 'escritorio') return valores(p.escopo_valor).some((v) => esc.has(v));
        if (p.escopo === 'canal') return valores(p.escopo_valor).some((v) => can.has(v));
        if (p.escopo === 'cliente') return valores(p.escopo_valor).map(normCod).includes(normCod(codCliente));
        return false;
      })
      .map((p) => ({ id: p.id as string, texto: p.texto as string, tipo: p.tipo as string, opcoes: p.opcoes as string | null, obrigatoria: p.obrigatoria === true }));
  }

  /** Inicia a visita: um clique, sem GPS nem foto. Se ja ha uma em andamento hoje para o cliente, devolve a mesma. */
  async iniciarVisita(u: UsuarioPainel, corpo: Linha) {
    const a = await this.alvo(u, String(corpo?.vendedor ?? ''));
    const cod = normCod(String(corpo?.cod_cliente ?? ''));
    await this.clienteDaCarteira(a, cod);
    const data = hojeSp();

    const { data: aberta, error: eA } = await this.sb
      .from('visitas').select('id, status').eq('cod_vendedor', a.cod).eq('cod_cliente', cod).eq('data_visita', data).eq('status', 'em_andamento').limit(1);
    if (eA) throw eA;
    if (aberta?.length) return { id: (aberta[0] as Linha).id as string, status: 'em_andamento', ja_existia: true };

    const id = randomUUID();
    const agora = new Date().toISOString();
    const { error } = await this.sb.from('visitas').insert({
      id, cod_vendedor: a.cod, cod_cliente: cod, data_visita: data, status: 'em_andamento', checkin_em: agora,
      origem: 'painel', sem_referencia: false, fora_do_raio: false,
      // sem GPS nem foto nao ha o que validar
      validacao: 'validada', validada_por: u.email, validada_em: agora, validacao_obs: 'Registrada pelo painel (sem GPS e sem foto)',
    });
    if (error) throw new Error(`iniciar visita: ${error.message}`);
    return { id, status: 'em_andamento', ja_existia: false };
  }

  /** Conclui a visita: vendeu (com o pedido, se ja feito) ou nao vendeu (com o motivo), e as respostas das perguntas. */
  async concluirVisita(u: UsuarioPainel, idRaw: string, corpo: Linha) {
    const id = String(idRaw ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new UnprocessableEntityException('id invalido');
    const { data: v, error } = await this.sb.from('visitas').select('id, cod_vendedor, cod_cliente, status, origem').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!v) throw new NotFoundException('Visita nao encontrada');
    const vis = v as Linha;
    exigirVendedor(u.escopo, vis.cod_vendedor);
    if (vis.origem !== 'painel') throw new ForbiddenException('Esta visita foi feita no app e conclui la');
    if (vis.status === 'concluida') throw new ConflictException('Esta visita ja foi concluida');

    const resultado = corpo?.resultado === 'vendeu' || corpo?.resultado === 'nao_vendeu' ? corpo.resultado : null;
    if (!resultado) throw new UnprocessableEntityException("resultado deve ser 'vendeu' ou 'nao_vendeu'");
    const motivo = String(corpo?.motivo_nao_venda ?? '').trim().slice(0, 500) || null;
    if (resultado === 'nao_vendeu' && (!motivo || motivo.length < 3)) throw new UnprocessableEntityException('Informe o motivo de nao ter vendido (minimo 3 caracteres)');
    const pedidoId = String(corpo?.pedido_id ?? '').trim().toLowerCase() || null;
    if (pedidoId && !/^[0-9a-f-]{36}$/.test(pedidoId)) throw new UnprocessableEntityException('pedido_id invalido');

    const respostas = validarRespostas(corpo?.respostas);
    const a = await this.alvo(u, String(vis.cod_vendedor));
    const obrigatorias = (await this.perguntas(u, String(vis.cod_cliente), a.cod)).filter((p) => p.obrigatoria);
    const respondidas = new Set(respostas.map((r) => r.pergunta_id));
    const faltam = obrigatorias.filter((p) => !respondidas.has(p.id));
    if (faltam.length) throw new UnprocessableEntityException(`Responda as perguntas obrigatorias: ${faltam.map((p) => p.texto).join('; ')}`);

    const { error: eU } = await this.sb.from('visitas').update({
      status: 'concluida', checkout_em: new Date().toISOString(), resultado,
      motivo_nao_venda: resultado === 'nao_vendeu' ? motivo : null, pedido_id: resultado === 'vendeu' ? pedidoId : null,
      observacao: String(corpo?.observacao ?? '').trim().slice(0, 500) || null, respostas,
    }).eq('id', id);
    if (eU) throw new Error(`concluir visita: ${eU.message}`);
    return { id, status: 'concluida', resultado };
  }

  private async clienteDaCarteira(a: Alvo, codRaw: string): Promise<Linha> {
    const cod = normCod(String(codRaw ?? ''));
    if (!/^\d{1,10}$/.test(cod)) throw new UnprocessableEntityException('Codigo de cliente invalido');
    const [rc, cli] = await Promise.all([
      this.sb.from('rota_clientes').select('cod_cliente').eq('rota', a.rota).eq('cod_cliente', cod).limit(1),
      this.sb.from('clientes').select('cod_cliente, areas, bloqueado').eq('cod_cliente', cod).maybeSingle(),
    ]);
    if (rc.error) throw rc.error;
    if (cli.error) throw cli.error;
    if (!rc.data?.length || !cli.data) throw new ForbiddenException('Cliente fora da carteira deste vendedor');
    return cli.data as Linha;
  }
}
