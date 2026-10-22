import { Escopo, exigirVendedor } from './escopo';
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod } from '../auth/vendedores.service';
import { avaliarCombosSrv, type ComboRow } from '../pedidos/pedido.combo';
import { descontoLiberadoPeloIncentivo, incentivoAplicavel, type IncentivoRow } from '../pedidos/pedido.incentivo';
import { combosParaFechar, pedidoTipicoSrv, reposicaoSrv, type CompraSrv } from '../pedidos/pedido.reposicao';
import { fatorBase, tabelaDoItem, type DadosProdutoSrv, type LinhaPrecoSrv } from '../pedidos/pedido.preco';
import { SUPABASE } from '../supabase/supabase.module';

type Linha = Record<string, any>;
type Dados = DadosProdutoSrv & { unidade_venda?: string | null; unidade_venda_texto?: string | null };
interface Area {
  tipo_material?: string;
  centro?: string;
  lista_preco?: { codigo?: string } | null;
  rede?: { codigo?: string } | null;
  canal?: { codigo?: string } | null;
  escritorio?: { codigo?: string } | null;
  tipo_estabelecimento?: { codigo?: string } | null;
}
type PrecoBase = LinhaPrecoSrv & { pltyp: string; cod_produto: string; kdgrp?: string };

const UNIDADE_PADRAO = 'KI';
const arred2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
const hojeSp = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

const tipoDoMaterial = (m: string | null | undefined) => (m === 'FERT' ? 'FERT' : m === 'HAWA' || m === 'ZVAR' ? 'HAWA' : null);

/**
 * Catalogo e cotacao do "Novo pedido" do painel: o mesmo que o vendedor ve no app (preco de tabela do cliente,
 * estoque em caixas e desconto por incentivo), calculado aqui com as regras do servidor.
 */
@Injectable()
export class CatalogoPainelService {
  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {}

  /**
   * Produtos para escolher. Com busca (2+ letras): por nome ou codigo. Sem busca: destaques e lancamentos
   * do painel, depois o que o cliente comprou nos ultimos 90 dias.
   */
  async produtos(codCliente: string, q = '') {
    const ctx = await this.contextoCliente(codCliente);
    const t = q.trim().replace(/[%_,()]/g, ' ').trim();

    const origens = new Map<string, string>(); // cod_produto -> origem (ordem de insercao = ordem de exibicao)
    if (t.length >= 2) {
      const like = `%${t}%`;
      const [d, c] = await Promise.all([
        this.sb.from('produtos').select('cod_produto').ilike('descricao', like).limit(30),
        this.sb.from('produtos').select('cod_produto').ilike('cod_produto', like).limit(30),
      ]);
      if (d.error) throw d.error;
      if (c.error) throw c.error;
      for (const p of [...(c.data ?? []), ...(d.data ?? [])] as Linha[]) if (!origens.has(p.cod_produto)) origens.set(p.cod_produto, 'busca');
    } else {
      const { data: dest, error } = await this.sb.from('produto_destaques').select('cod_produto, destaque, lancamento, ordem').eq('ativo', true).order('ordem').limit(30);
      if (error) throw error;
      for (const d of (dest ?? []) as Linha[]) origens.set(d.cod_produto, d.lancamento ? 'lancamento' : 'destaque');

      const desde = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      const { data: peds, error: eP } = await this.sb.from('pedidos_sap').select('ordem').eq('cod_cliente', ctx.codCliente).gte('dt_criacao', desde).limit(80);
      if (eP) throw eP;
      const ordens = ((peds ?? []) as Linha[]).map((p) => p.ordem as string);
      if (ordens.length) {
        const { data: its, error: eI } = await this.sb.from('pedido_itens_sap').select('cod_produto, recusa').in('ordem', ordens).limit(2000);
        if (eI) throw eI;
        const freq = new Map<string, number>();
        for (const i of (its ?? []) as Linha[]) if (!i.recusa) freq.set(i.cod_produto, (freq.get(i.cod_produto) ?? 0) + 1);
        for (const [cod] of [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) if (!origens.has(cod)) origens.set(cod, 'comprou');
      }
    }
    if (!origens.size) return [];
    return this.montar(ctx, [...origens.keys()], origens);
  }

  /**
   * Sugestoes do cliente para quem monta o pedido: "hora de repor" (produtos que passaram do ritmo de compra dele, com a
   * quantidade que ele costuma levar) e combos que ele quase fecha com o que costuma comprar.
   * O ritmo vem das datas reais dos pedidos dos ultimos 12 meses (ver pedidos/pedido.reposicao.ts).
   */
  async sugestoes(codVendedor: string, codCliente: string, escopo: Escopo | null = null) {
    exigirVendedor(escopo, codVendedor);
    const ctx = await this.contextoCliente(codCliente, normCod(codVendedor));
    const compras = await this.historicoDoCliente(ctx.codCliente);
    const repor = reposicaoSrv(compras, hojeSp(), 10);

    const prods = await this.produtosPorCodigo([...new Set(compras.map((c) => c.cod_produto))]);
    const cls = Object.fromEntries([...prods].map(([k, p]) => [k, (p.dados as Dados | null)?.classificacao]));
    const oport = combosParaFechar(ctx.combos, pedidoTipicoSrv(compras), ctx.ctxInc, cls, 3);

    // linhas do catalogo (preco de tabela, unidade, estoque) para a tela poder adicionar o produto como se tivesse clicado nele
    const linhas = new Map(
      (await this.montar(ctx, repor.map((r) => r.cod_produto), new Map(repor.map((r) => [r.cod_produto, 'reposicao'])))).map((l) => [l.cod_produto as string, l]),
    );
    const brindes = await this.produtosPorCodigo([...new Set(oport.map((o) => o.combo.brinde_cod_produto).filter((x): x is string => !!x))]);

    return {
      reposicao: repor.filter((r) => linhas.get(r.cod_produto)?.disponivel).map((r) => ({ ...r, produto: linhas.get(r.cod_produto) })),
      combos: oport.map((o) => ({
        id: o.combo.id,
        nome: o.combo.nome,
        beneficio: o.combo.beneficio,
        brinde: o.combo.beneficio === 'produto_gratis' && o.combo.brinde_cod_produto
          ? { cod_produto: o.combo.brinde_cod_produto, descricao: brindes.get(o.combo.brinde_cod_produto)?.descricao ?? o.combo.brinde_cod_produto, quantidade: Number(o.combo.brinde_qtd) }
          : null,
        desconto_pct: o.combo.beneficio === 'desconto_pct' ? Number(o.combo.desconto_pct) : null,
        faltas: o.faltas.map((f) => ({ alvo_tipo: f.item.alvo_tipo, alvo_valor: f.item.alvo_valor, falta: f.falta })),
      })),
    };
  }

  /** O que o cliente comprou nos ultimos 12 meses (itens nao recusados, pedidos nao recusados), por produto, com as datas reais. */
  private async historicoDoCliente(codCliente: string): Promise<CompraSrv[]> {
    const desde = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const { data: peds, error } = await this.sb.from('pedidos_sap').select('ordem, dt_criacao, status').eq('cod_cliente', codCliente).gte('dt_criacao', desde).limit(1000);
    if (error) throw error;
    const dataDe = new Map<string, string>();
    for (const p of (peds ?? []) as Linha[]) if (p.dt_criacao && (p.status ?? '') !== 'Recusado') dataDe.set(String(p.ordem), String(p.dt_criacao).slice(0, 10));
    const ordens = [...dataDe.keys()];
    if (!ordens.length) return [];

    const porProduto = new Map<string, { descricao: string | null; ordens: Set<string>; quantidade: number; unidade: string | null }>();
    for (let i = 0; i < ordens.length; i += 30) {
      const { data: its, error: eI } = await this.sb
        .from('pedido_itens_sap')
        .select('ordem, cod_produto, denominacao, quantidade, unidade_venda, recusa')
        .in('ordem', ordens.slice(i, i + 30))
        .limit(1000);
      if (eI) throw eI;
      for (const it of (its ?? []) as Linha[]) {
        if (!it.cod_produto || it.recusa) continue;
        const g = porProduto.get(it.cod_produto) ?? { descricao: it.denominacao ?? null, ordens: new Set<string>(), quantidade: 0, unidade: it.unidade_venda ?? null };
        g.ordens.add(String(it.ordem));
        g.quantidade += Number(it.quantidade ?? 0);
        porProduto.set(it.cod_produto, g);
      }
    }
    return [...porProduto.entries()].map(([cod, g]) => {
      const datas = [...g.ordens].map((o) => dataDe.get(o)!).sort();
      return { cod_produto: cod, descricao: g.descricao, primeira_compra: datas[0], ultima_compra: datas[datas.length - 1], pedidos: g.ordens.size, quantidade: g.quantidade, unidade: g.unidade };
    });
  }

  /**
   * Preco e desconto de cada item para a quantidade informada: tabela do cliente, desconto automatico do incentivo
   * (quando atinge a faixa), o que o vendedor pode acrescentar e o preco final. `desconto_manual` e limitado ao permitido.
   */
  async cotar(codVendedor: string, codCliente: string, itens: unknown, escopo: Escopo | null = null, tipo: 'venda' | 'bonificacao' = 'venda') {
    exigirVendedor(escopo, codVendedor);
    const lista = (Array.isArray(itens) ? itens : []).slice(0, 200) as Linha[];
    if (!lista.length) return { itens: [], total: 0, pedido_minimo: null, brindes: [] };
    const ctx = await this.contextoCliente(codCliente, normCod(codVendedor));
    const codigos = [...new Set(lista.map((i) => String(i?.produto ?? '').trim()).filter(Boolean))];
    const linhas = new Map((await this.montar(ctx, codigos, new Map())).map((l) => [l.cod_produto as string, l]));
    const prods = await this.produtosPorCodigo(codigos);

    const hoje = hojeSp();

    // combos do painel (tela Desconto): o brinde e o desconto que o pedido ja garante; bonificacao nao tem combo
    const comboRes = tipo === 'venda'
      ? avaliarCombosSrv(
          ctx.combos,
          lista.map((i) => ({ produto: String(i?.produto ?? '').trim(), quantidade: Number(String(i?.quantidade ?? '').replace(',', '.')) || 0 })),
          { ...ctx.ctxInc, hoje },
          Object.fromEntries([...prods].map(([k, x]) => [k, (x.dados as Dados | null)?.classificacao])),
        )
      : { brindes: {}, brindesPorCombo: [], descontoPorProduto: {} };

    let total = 0;
    const saida = lista.map((i) => {
      const produto = String(i?.produto ?? '').trim();
      const l = linhas.get(produto);
      const p = prods.get(produto);
      const qtd = Number(String(i?.quantidade ?? '').replace(',', '.'));
      if (!l || !p) return { produto, erro: 'Produto nao encontrado' };
      const q = Number.isFinite(qtd) && qtd > 0 ? qtd : 0;
      if (!l.preco_tabela) return { produto, unidade: l.unidade, quantidade: q, preco_tabela: null, aviso: 'Sem preco de tabela para este cliente: o SAP aplica a lista.' };

      const inc = incentivoAplicavel(ctx.incentivos, produto, q, { ...ctx.ctxInc, hoje }, (p.dados as Dados | null)?.classificacao);
      // incentivo e combo no mesmo produto: vale o maior desconto (e o extra do vendedor acompanha o que venceu)
      const dc = comboRes.descontoPorProduto[produto];
      const incPct = inc ? Number(inc.desconto_pct) : 0;
      const incExtra = inc ? Number(inc.desconto_extra_max_pct) : 0;
      const doCombo = !!dc && (dc.pct > incPct || (dc.pct === incPct && dc.extra > incExtra));
      const auto = doCombo ? dc.pct : incPct;
      const extraLiberado = doCombo ? dc.extra : incExtra;
      const manualMax = arred2(l.desconto_max + extraLiberado);
      const manualPedido = Number(String(i?.desconto_manual ?? '').replace(',', '.'));
      const manual = Math.min(Math.max(Number.isFinite(manualPedido) ? manualPedido : 0, 0), manualMax);
      const descTotal = arred2(auto + manual);
      const precoFinal = arred2(l.preco_tabela * (1 - descTotal / 100));
      const subtotal = arred2(precoFinal * q);
      total += subtotal;
      return {
        produto,
        unidade: l.unidade,
        quantidade: q,
        preco_tabela: l.preco_tabela,
        desconto_auto: auto,
        desconto_manual: manual,
        desconto_manual_max: manualMax,
        desconto_total: descTotal,
        desconto_teto: arred2(l.desconto_max + auto + extraLiberado),
        origem_desconto: auto > 0 ? (doCombo ? 'combo' : 'incentivo') : null,
        preco_final: precoFinal,
        subtotal,
        incentivo: inc ? { qtd_minima: Number(inc.qtd_minima), desconto_pct: Number(inc.desconto_pct), extra_max_pct: Number(inc.desconto_extra_max_pct) } : null,
        estoque_cx: l.estoque_cx,
      };
    });

    const { data: cli } = await this.sb.from('clientes').select('pedido_minimo').eq('cod_cliente', ctx.codCliente).maybeSingle();
    // brindes dos combos: uma linha por produto, na unidade de venda (o mesmo que o app manda)
    const brindeProds = await this.produtosPorCodigo(Object.keys(comboRes.brindes));
    const brindes = Object.entries(comboRes.brindes).map(([produto, quantidade]) => {
      const d = (brindeProds.get(produto)?.dados ?? {}) as Dados;
      const deCombos = comboRes.brindesPorCombo.filter((b) => b.produto === produto);
      return {
        produto,
        descricao: (brindeProds.get(produto)?.descricao as string | undefined) ?? produto,
        unidade: d.unidade_venda || UNIDADE_PADRAO,
        unidade_texto: d.unidade_venda_texto || 'CX',
        quantidade,
        combo_id: deCombos[0]?.comboId ?? null,
        combos: [...new Set(deCombos.map((b) => b.comboNome))],
      };
    });

    return { itens: saida, total: arred2(total), pedido_minimo: (cli as Linha | null)?.pedido_minimo == null ? null : Number((cli as Linha).pedido_minimo), brindes };
  }

  // ---------------- apoio ----------------

  private async contextoCliente(codClienteRaw: string, codVendedor = '') {
    const codCliente = normCod(String(codClienteRaw ?? ''));
    if (!codCliente || codCliente === '0') throw new UnprocessableEntityException('Escolha o cliente');
    const { data: cli, error } = await this.sb.from('clientes').select('areas').eq('cod_cliente', codCliente).maybeSingle();
    if (error) throw error;
    if (!cli) throw new NotFoundException('Cliente ainda sem cadastro baixado do SAP: sincronize o vendedor');
    const areas = ((cli as Linha).areas ?? []) as Area[];

    const { data: inc, error: eInc } = await this.sb
      .from('incentivos_desconto')
      .select('id,cod_produto,escopo,escopo_valor,linha_id,grupo_id,categoria_id,marca,qtd_minima,desconto_pct,desconto_extra_max_pct,vigencia_ini,vigencia_fim,ativo')
      .eq('ativo', true);
    if (eInc) throw eInc;
    const { data: vend } = await this.sb.from('vendedores').select('equipe').eq('cod_vendedor', codVendedor).maybeSingle();
    const equipe = ((vend as { equipe?: string | null } | null)?.equipe ?? '').trim();
    const [{ data: cmb, error: eCmb }, { data: cmbItens, error: eCmbI }] = await Promise.all([
      this.sb
        .from('combos')
        .select('id,nome,escopo,escopo_valor,beneficio,brinde_cod_produto,brinde_qtd,tipo_bonificacao,centro_custo,desconto_pct,desconto_extra_max_pct,repete,max_repeticoes,faixas,vigencia_ini,vigencia_fim,ativo')
        .eq('ativo', true),
      this.sb.from('combo_itens').select('combo_id,alvo_tipo,alvo_valor,qtd_minima'),
    ]);
    if (eCmb) throw eCmb;
    if (eCmbI) throw eCmbI;
    const combos = ((cmb ?? []) as Array<Omit<ComboRow, 'itens'>>).map((c) => ({
      ...c,
      itens: ((cmbItens ?? []) as Array<{ combo_id: string; alvo_tipo: string; alvo_valor: string; qtd_minima: number }>).filter((x) => x.combo_id === c.id),
    }));
    return {
      codCliente,
      areas,
      combos,
      incentivos: (inc ?? []) as IncentivoRow[],
      ctxInc: {
        codCliente,
        codVendedor,
        canais: [...new Set(areas.map((a) => a.canal?.codigo).filter((x): x is string => !!x))],
        escritorios: [...new Set(areas.map((a) => a.escritorio?.codigo).filter((x): x is string => !!x))],
        listasPreco: [...new Set(areas.flatMap((a) => (a.lista_preco?.codigo ? [a.lista_preco.codigo, ...(a.rede?.codigo ? [a.lista_preco.codigo + "." + a.rede.codigo] : [])] : [])))],
        tiposEstabelecimento: [...new Set(areas.map((a) => a.tipo_estabelecimento?.codigo).filter((x): x is string => !!x))],
        equipes: equipe ? [equipe] : [],
        hoje: hojeSp(),
      },
    };
  }

  private async produtosPorCodigo(codigos: string[]) {
    if (!codigos.length) return new Map<string, Linha>();
    const { data, error } = await this.sb.from('produtos').select('cod_produto, descricao, tipo_material, dados').in('cod_produto', codigos);
    if (error) throw error;
    return new Map(((data ?? []) as Linha[]).map((p) => [p.cod_produto as string, p]));
  }

  /** Linhas do catalogo (preco de tabela, estoque em caixas, unidade) para os codigos, na ordem recebida. */
  private async montar(ctx: Awaited<ReturnType<CatalogoPainelService['contextoCliente']>>, codigos: string[], origens: Map<string, string>) {
    const prods = await this.produtosPorCodigo(codigos);
    const pltyps = [...new Set(ctx.areas.map((a) => a.lista_preco?.codigo).filter((x): x is string => !!x))];
    const centros = [...new Set(ctx.areas.map((a) => a.centro).filter((x): x is string => !!x))];

    const [g, l, e] = await Promise.all([
      pltyps.length ? this.sb.from('precos_grupo').select('pltyp,kdgrp,cod_produto,kbetr,kpein,kmein,datab,datbi,desconto_max').in('cod_produto', codigos).in('pltyp', pltyps) : Promise.resolve({ data: [], error: null }),
      pltyps.length ? this.sb.from('precos_lista').select('pltyp,cod_produto,kbetr,kpein,kmein,datab,datbi,desconto_max').in('cod_produto', codigos).in('pltyp', pltyps) : Promise.resolve({ data: [], error: null }),
      centros.length ? this.sb.from('estoque').select('centro,cod_produto,quantidade').in('cod_produto', codigos).in('centro', centros) : Promise.resolve({ data: [], error: null }),
    ]);
    for (const r of [g, l, e]) if (r.error) throw r.error;
    const grupos = (g.data ?? []) as PrecoBase[];
    const listas = (l.data ?? []) as PrecoBase[];
    const estoque = new Map(((e.data ?? []) as Linha[]).map((x) => [`${x.centro}|${x.cod_produto}`, Number(x.quantidade)]));
    const hoje = hojeSp();

    const saida: Linha[] = [];
    for (const cod of codigos) {
      const p = prods.get(cod);
      if (!p) continue;
      const dados = (p.dados ?? {}) as Dados;
      const unidade = dados.unidade_venda || UNIDADE_PADRAO;
      const area = ctx.areas.find((a) => a.tipo_material === tipoDoMaterial(p.tipo_material));
      const pltyp = area?.lista_preco?.codigo;
      const kdgrp = area?.rede?.codigo ?? '';
      const tabela = pltyp
        ? tabelaDoItem(
            grupos.filter((x) => x.cod_produto === cod && x.pltyp === pltyp && (x.kdgrp ?? '') === kdgrp),
            listas.filter((x) => x.cod_produto === cod && x.pltyp === pltyp),
            hoje,
            unidade,
            dados,
          )
        : null;
      const base = area?.centro ? estoque.get(`${area.centro}|${cod}`) : undefined;
      const fator = fatorBase(unidade, dados);
      saida.push({
        cod_produto: cod,
        descricao: p.descricao,
        unidade,
        unidade_texto: dados.unidade_venda_texto || 'CX',
        preco_tabela: tabela ? arred2(tabela.valor) : null,
        desconto_max: tabela ? tabela.descontoMax : 0,
        estoque_cx: base === undefined ? null : arred2(fator ? base / fator : base),
        disponivel: !!area,
        origem: origens.get(cod) ?? null,
      });
    }
    return saida;
  }
}
