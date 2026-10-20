import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase/supabase.module';
import { CADASTROS, PARAMETROS, STATUS_SAP_CONHECIDOS } from './cadastros';
import { BUCKET_FOTOS } from '../visitas/visita.validacao';
import { UsuarioPainel } from './painel.guard';
import { Escopo, vendedorNoEscopo } from './escopo';
import { normCod } from '../auth/vendedores.service';

const STATUS_BONIFICACAO = ['aguardando_aprovacao', 'aprovado', 'rejeitado'];

@Injectable()
export class PainelService {
  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {}

  /** Bonificacoes (padrao: aguardando aprovacao) com nome do cliente/vendedor, descricao dos produtos e tipo/centro. */
  async bonificacoes(escopo: Escopo | null, status = 'aguardando_aprovacao') {
    if (!STATUS_BONIFICACAO.includes(status)) throw new UnprocessableEntityException('status invalido');
    let consulta = this.sb
      .from('pedidos_app')
      .select('id, codigo, cod_vendedor, cod_cliente, tipo_bonificacao, centro_custo, justificativa, motivo_rejeicao, itens, recebido_em, decidido_por, decidido_em, status')
      .eq('tipo', 'bonificacao')
      .eq('status', status);
    if (escopo) consulta = consulta.in('cod_vendedor', escopo.vendedores);
    const { data, error } = await consulta.order('recebido_em', { ascending: status === 'aguardando_aprovacao' }).limit(200);
    if (error) throw error;
    const linhas = data ?? [];
    if (!linhas.length) return [];

    const dist = (f: (l: any) => string) => [...new Set(linhas.map(f))];
    const prods = [...new Set(linhas.flatMap((l: any) => (l.itens ?? []).map((i: any) => String(i.produto))))];
    const [cli, ven, pro, tip, cc] = await Promise.all([
      this.sb.from('clientes').select('cod_cliente, nome_fantasia, razao_social').in('cod_cliente', dist((l) => l.cod_cliente)),
      this.sb.from('vendedores').select('cod_vendedor, nome').in('cod_vendedor', dist((l) => l.cod_vendedor)),
      this.sb.from('produtos').select('cod_produto, descricao, dados').in('cod_produto', prods),
      this.sb.from('bonificacao_tipos').select('codigo, descricao'),
      this.sb.from('centros_custo').select('codigo, descricao'),
    ]);
    for (const r of [cli, ven, pro, tip, cc]) if (r.error) throw r.error;
    const mapa = <T extends Record<string, any>>(rows: T[] | null, k: keyof T, v: keyof T) => new Map((rows ?? []).map((x) => [String(x[k]), x[v] as string]));
    const nCli = new Map((cli.data ?? []).map((c: any) => [c.cod_cliente, c.nome_fantasia || c.razao_social]));
    const nVen = mapa(ven.data, 'cod_vendedor', 'nome');
    const nPro = mapa(pro.data, 'cod_produto', 'descricao');
    const dadosPro = new Map((pro.data ?? []).map((p: any) => [String(p.cod_produto), p.dados ?? {}]));
    /** Texto que o vendedor le para a unidade do SAP (KI = CX). */
    const textoUnidade = (produto: string, unidade: string) => {
      const d: any = dadosPro.get(produto) ?? {};
      return d.conversoes?.find((c: any) => c.unidade === unidade)?.texto || (unidade === d.unidade_venda ? d.unidade_venda_texto : null) || unidade;
    };
    const nTip = mapa(tip.data, 'codigo', 'descricao');
    const nCc = mapa(cc.data, 'codigo', 'descricao');

    return linhas.map((l: any) => ({
      ...l,
      cliente: nCli.get(l.cod_cliente) ?? null,
      vendedor: nVen.get(l.cod_vendedor) ?? null,
      tipo_descricao: nTip.get(l.tipo_bonificacao) ?? null,
      centro_descricao: nCc.get(l.centro_custo) ?? null,
      itens: (l.itens ?? []).map((i: any) => ({ ...i, descricao: nPro.get(String(i.produto)) ?? null, unidade_texto: textoUnidade(String(i.produto), String(i.unidade)) })),
    }));
  }

  /** Aprova (o servidor envia ao SAP no proximo ciclo) ou rejeita com motivo. So age em quem ainda aguarda. */
  async decidirBonificacao(u: UsuarioPainel, id: string, aprovar: boolean, motivo?: string) {
    const m = (motivo ?? '').trim();
    if (!aprovar && (m.length < 3 || m.length > 200)) throw new UnprocessableEntityException('Informe o motivo da rejeicao (3 a 200 caracteres)');

    let decisao = this.sb
      .from('pedidos_app')
      .update({
        status: aprovar ? 'aprovado' : 'rejeitado',
        motivo_rejeicao: aprovar ? null : m,
        decidido_por: u.email,
        decidido_em: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tipo', 'bonificacao')
      .eq('status', 'aguardando_aprovacao');
    // fora da equipe: age em nada (mesma resposta de "ja decidida")
    if (u.escopo) decisao = decisao.in('cod_vendedor', u.escopo.vendedores);
    const { data, error } = await decisao.select('id, codigo, status').maybeSingle();
    if (error) throw error;
    if (!data) throw new ConflictException('Esta bonificacao nao esta mais aguardando aprovacao');

    await this.sb.from('pedido_eventos').insert({
      pedido_id: id,
      tipo: aprovar ? 'bonificacao_aprovada' : 'bonificacao_rejeitada',
      detalhe: { por: u.email, motivo: aprovar ? null : m },
    });
    return data;
  }

  // ===================================================================
  // Cadastros (tipos/centros de bonificacao, destaques, incentivos, feriados)
  // ===================================================================

  private cadastro(nome: string) {
    const c = CADASTROS[nome];
    if (!c) throw new NotFoundException('Cadastro desconhecido');
    return c;
  }

  /** Todas as linhas (inclusive inativas): o painel mostra e reativa. */
  async listarCadastro(nome: string, escopo: Escopo | null = null) {
    const c = this.cadastro(nome);
    let q = this.sb.from(c.tabela).select('*');
    for (const [col, asc] of c.ordem) q = q.order(col, { ascending: asc });
    const { data, error } = await q.limit(2000);
    if (error) throw error;
    // quem so ve a propria equipe enxerga apenas os avisos dirigidos a vendedores dela
    if (nome === 'avisos' && escopo) return (data ?? []).filter((a) => this.avisoDaEquipe(a as Record<string, unknown>, escopo));
    return data ?? [];
  }

  /** Aviso para vendedor(es) todos dentro da equipe? */
  private avisoDaEquipe(a: Record<string, unknown>, escopo: Escopo): boolean {
    if (a.escopo !== 'vendedor') return false;
    const cods = String(a.escopo_valor ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return cods.length > 0 && cods.every((c) => vendedorNoEscopo(escopo, c));
  }

  /** Barra mexer num aviso que nao e da equipe (o aviso existente e consultado antes de alterar). */
  private async exigirAvisoDaEquipe(id: string, escopo: Escopo) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new UnprocessableEntityException('id invalido');
    const { data, error } = await this.sb.from('avisos').select('escopo, escopo_valor').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data || !this.avisoDaEquipe(data as Record<string, unknown>, escopo)) throw new ForbiddenException('Este aviso nao e da sua equipe');
  }

  /** Cria ou atualiza. Com chave de texto (codigo/produto) e upsert; com `id` existente atualiza, sem `id` cria. */
  async gravarCadastro(nome: string, corpo: Record<string, unknown>, escopo: Escopo | null = null) {
    const c = this.cadastro(nome);
    const linha = c.validar(corpo ?? {});
    if (nome === 'avisos' && escopo) {
      if (!this.avisoDaEquipe(linha as Record<string, unknown>, escopo)) throw new ForbiddenException('Voce so cria avisos para vendedores da sua equipe (escolha "Vendedor" e informe os codigos deles)');
      const idAtual = corpo?.id ? String(corpo.id) : null;
      if (idAtual) await this.exigirAvisoDaEquipe(idAtual, escopo);
    }
    const agora = new Date().toISOString();
    if (c.chave === 'id') {
      const id = corpo?.id ? String(corpo.id) : null;
      if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw new UnprocessableEntityException('id invalido');
      const q = id
        ? this.sb.from(c.tabela).update({ ...linha, updated_at: agora }).eq('id', id)
        : this.sb.from(c.tabela).insert({ ...linha, updated_at: agora });
      const { data, error } = await q.select('*').maybeSingle();
      if (error) throw this.erroBanco(error);
      if (!data) throw new NotFoundException('Registro nao encontrado');
      return data;
    }
    const { data, error } = await this.sb.from(c.tabela).upsert({ ...linha, updated_at: agora }, { onConflict: c.chave }).select('*').maybeSingle();
    if (error) throw this.erroBanco(error);
    return data;
  }

  async ativarCadastro(nome: string, chave: string, ativo: boolean, escopo: Escopo | null = null) {
    const c = this.cadastro(nome);
    if (nome === 'avisos' && escopo) await this.exigirAvisoDaEquipe(chave, escopo);
    const { data, error } = await this.sb
      .from(c.tabela)
      .update({ ativo, updated_at: new Date().toISOString() })
      .eq(c.chave, chave)
      .select('*')
      .maybeSingle();
    if (error) throw this.erroBanco(error);
    if (!data) throw new NotFoundException('Registro nao encontrado');
    return data;
  }

  // ===================================================================
  // Visitas: validacao da visita e da foto de fachada
  // ===================================================================

  /**
   * Visitas do periodo (padrao: ultimos 7 dias) com vendedor, cliente, alertas e foto (link assinado de 10 min,
   * o bucket e privado). Alertas: fora do raio, GPS simulado, cliente sem coordenada e relogio do aparelho divergente.
   */
  async visitas(escopo: Escopo | null, f: { validacao?: string; ini?: string; fim?: string; vendedor?: string }) {
    const validacao = f.validacao || 'pendente';
    if (!['pendente', 'validada', 'recusada', 'todas'].includes(validacao)) throw new UnprocessableEntityException('validacao invalida');
    const dia = /^\d{4}-\d{2}-\d{2}$/;
    if ((f.ini && !dia.test(f.ini)) || (f.fim && !dia.test(f.fim))) throw new UnprocessableEntityException('datas devem ser AAAA-MM-DD');
    const ini = f.ini || new Date(Date.now() - 7 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

    let q = this.sb
      .from('visitas')
      .select('id, cod_vendedor, cod_cliente, data_visita, status, checkin_em, checkin_recebido_em, checkin_lat, checkin_lng, checkin_precisao_m, checkin_gps_falso, distancia_m, fora_do_raio, sem_referencia, checkout_em, resultado, motivo_nao_venda, observacao, respostas, pedido_id, validacao, validada_por, validada_em, validacao_obs')
      .gte('data_visita', ini)
      .order('data_visita', { ascending: false });
    if (f.fim) q = q.lte('data_visita', f.fim);
    if (validacao !== 'todas') q = q.eq('validacao', validacao);
    if (escopo) q = q.in('cod_vendedor', escopo.vendedores);
    if (f.vendedor) q = q.eq('cod_vendedor', f.vendedor.replace(/^0+/, '') || '0');
    const { data, error } = await q.limit(300);
    if (error) throw error;
    const linhas = (data ?? []) as any[];
    if (!linhas.length) return [];

    const ids = linhas.map((l) => l.id);
    const [cli, ven, fot] = await Promise.all([
      this.sb.from('clientes').select('cod_cliente, nome_fantasia, razao_social').in('cod_cliente', [...new Set(linhas.map((l) => l.cod_cliente))]),
      this.sb.from('vendedores').select('cod_vendedor, nome').in('cod_vendedor', [...new Set(linhas.map((l) => l.cod_vendedor))]),
      this.sb.from('visita_fotos').select('id, visita_id, tipo, tirada_em, enviada_em, removida_em, caminho').in('visita_id', ids),
    ]);
    for (const r of [cli, ven, fot]) if (r.error) throw r.error;
    const fotos = (fot.data ?? []) as any[];

    // links assinados so das fotos que ainda existem no bucket
    const links = new Map<string, string>();
    const vivas = fotos.filter((x) => x.enviada_em && !x.removida_em);
    if (vivas.length) {
      const { data: urls, error: eU } = await this.sb.storage.from(BUCKET_FOTOS).createSignedUrls(vivas.map((x) => x.caminho), 600);
      if (eU) throw eU;
      for (const u of (urls ?? []) as Array<{ path: string | null; signedUrl: string | null }>) if (u.path && u.signedUrl) links.set(u.path, u.signedUrl);
    }

    const nCli = new Map((cli.data ?? []).map((c: any) => [c.cod_cliente, c.nome_fantasia || c.razao_social]));
    const nVen = new Map((ven.data ?? []).map((v: any) => [v.cod_vendedor, v.nome]));
    return linhas.map((l) => {
      const deriva = Math.abs(Date.parse(l.checkin_recebido_em) - Date.parse(l.checkin_em));
      return {
        ...l,
        cliente: nCli.get(l.cod_cliente) ?? null,
        vendedor: nVen.get(l.cod_vendedor) ?? null,
        relogio_divergente: Number.isFinite(deriva) && deriva > 10 * 60_000,
        fotos: fotos
          .filter((x) => x.visita_id === l.id)
          .map((x) => ({ id: x.id, tipo: x.tipo, tirada_em: x.tirada_em, enviada: !!x.enviada_em, removida: !!x.removida_em, url: links.get(x.caminho) ?? null })),
      };
    });
  }

  /** Valida ou recusa uma visita CONCLUIDA que ainda esta pendente (recusar exige o motivo). */
  async validarVisita(u: UsuarioPainel, id: string, validada: boolean, obs?: string) {
    const o = (obs ?? '').trim();
    if (!validada && (o.length < 3 || o.length > 200)) throw new UnprocessableEntityException('Informe o motivo da recusa (3 a 200 caracteres)');
    if (o.length > 200) throw new UnprocessableEntityException('Observacao com no maximo 200 caracteres');
    let validar = this.sb
      .from('visitas')
      .update({ validacao: validada ? 'validada' : 'recusada', validada_por: u.email, validada_em: new Date().toISOString(), validacao_obs: o || null })
      .eq('id', id)
      .eq('status', 'concluida')
      .eq('validacao', 'pendente');
    if (u.escopo) validar = validar.in('cod_vendedor', u.escopo.vendedores);
    const { data, error } = await validar.select('id, validacao').maybeSingle();
    if (error) throw error;
    if (!data) throw new ConflictException('Esta visita ainda nao foi concluida ou ja foi decidida');
    return data;
  }

  // ===================================================================
  // Parametros (chave -> valor json)
  // ===================================================================

  /** Parametros editaveis pelo painel + dados de apoio (status que o SAP ja devolveu nos pedidos). */
  async parametros() {
    const { data, error } = await this.sb.from('parametros').select('chave, valor, descricao, updated_at').in('chave', Object.keys(PARAMETROS));
    if (error) throw error;
    const { data: ped, error: e2 } = await this.sb.from('pedidos_sap').select('status').order('dt_criacao', { ascending: false }).limit(2000);
    if (e2) throw e2;
    const vistos = new Set<string>(STATUS_SAP_CONHECIDOS);
    for (const p of (ped ?? []) as Array<{ status: string | null }>) if (p.status?.trim()) vistos.add(p.status.trim());
    return { parametros: data ?? [], status_sap: [...vistos].sort((a, b) => a.localeCompare(b, 'pt-BR')) };
  }

  async gravarParametro(chave: string, valor: unknown) {
    const def = PARAMETROS[chave];
    if (!def) throw new NotFoundException('Parametro desconhecido');
    const { data, error } = await this.sb
      .from('parametros')
      .upsert({ chave, valor: def.validar(valor), updated_at: new Date().toISOString() }, { onConflict: 'chave' })
      .select('chave, valor, descricao, updated_at')
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Busca de produto (codigo ou descricao) para preencher cadastros. */
  async buscarProdutos(q: string) {
    const t = q.trim();
    if (t.length < 2) return [];
    const like = `%${t.replace(/[%_,()]/g, ' ')}%`;
    const [porDesc, porCod] = await Promise.all([
      this.sb.from('produtos').select('cod_produto, descricao, dados').ilike('descricao', like).limit(15),
      this.sb.from('produtos').select('cod_produto, descricao, dados').ilike('cod_produto', like).limit(15),
    ]);
    if (porDesc.error) throw porDesc.error;
    if (porCod.error) throw porCod.error;
    const unicos = new Map([...(porCod.data ?? []), ...(porDesc.data ?? [])].map((p: any) => [p.cod_produto, p]));
    // unidade em que o pedido e feito (a caixa); sem cadastro, KI como no app
    return [...unicos.values()].slice(0, 20).map((p: any) => ({ cod_produto: p.cod_produto, descricao: p.descricao, unidade: String(p.dados?.unidade_venda || 'KI') }));
  }

  private erroBanco(e: { code?: string; message: string }) {
    if (e.code === '23505') return new ConflictException('Ja existe um registro igual');
    if (e.code === '23514' || e.code === '23502') return new UnprocessableEntityException('Dados invalidos para este cadastro');
    return new Error(e.message);
  }
}
