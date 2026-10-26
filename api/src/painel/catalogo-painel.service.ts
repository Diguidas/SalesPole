import { Escopo, exigirVendedor } from './escopo';
import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod } from '../auth/vendedores.service';
import { avaliarCombosSrv, statusCombosSrv, type ComboRow } from '../pedidos/pedido.combo';
import { descontoLiberadoPeloIncentivo, faixasQueServem, incentivoAplicavel, type ClassificacaoSrv, type IncentivoRow } from '../pedidos/pedido.incentivo';
import { itemCasa } from '../pedidos/regras/combo';
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
   * Catalogo do cliente, igual ao do app: so entra o que o vendedor PODE vender (area de vendas para o tipo do produto,
   * preco de tabela vigente e pelo menos 1 caixa em estoque no centro do cliente), em ordem de nome, com busca por nome,
   * codigo ou EAN. Muitos produtos sao descartados, entao le o cadastro em paginas ate juntar `limite`.
   * `inicio` e o cursor (quantos produtos do cadastro ja foram lidos): devolve `proximo` para pedir a pagina seguinte, ou null no fim.
   * `incluirIndisponiveis` mostra tambem o que ficaria escondido (sem estoque, sem preco, sem area), marcado como tal.
   */
  async catalogo(codCliente: string, q = '', inicioRaw: unknown = 0, incluirIndisponiveis = false, escopo: Escopo | null = null, limite = 40) {
    await this.exigirClienteNoEscopo(codCliente, escopo);
    const ctx = await this.contextoCliente(codCliente);
    const t = q.trim().replace(/[%_,()]/g, ' ').trim();
    const PAGINA = 150;
    const MAX_LIDOS = 3000;
    const inicio = Math.max(0, Math.trunc(Number(inicioRaw)) || 0);

    // centros do cliente que ja tem estoque baixado: sem isso nao da para dizer "sem estoque" (igual ao app)
    const centros = [...new Set(ctx.areas.map((a) => a.centro).filter((x): x is string => !!x))];
    const comDados = await Promise.all(centros.map(async (c) => {
      const { data, error } = await this.sb.from('estoque').select('centro').eq('centro', c).limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    }));
    const centroTemEstoque = comDados.some(Boolean);

    // busca: junta os que casam por nome, codigo ou EAN (poucos) e ordena aqui; sem busca le o cadastro em paginas, em ordem de nome
    let candidatos: string[] | null = null;
    if (t) {
      const like = `%${t}%`;
      const achados = await Promise.all(['descricao', 'cod_produto', 'ean'].map((col) => this.sb.from('produtos').select('cod_produto, descricao').ilike(col, like).limit(500)));
      const unicos = new Map<string, string>();
      for (const r of achados) {
        if (r.error) throw r.error;
        for (const p of (r.data ?? []) as Linha[]) unicos.set(p.cod_produto as string, String(p.descricao ?? ''));
      }
      candidatos = [...unicos.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR') || a[0].localeCompare(b[0])).map(([cod]) => cod);
    }

    const itens: Linha[] = [];
    let offset = inicio;
    let proximo: number | null = null;
    while (itens.length < limite && offset < inicio + MAX_LIDOS) {
      let codigos: string[];
      if (candidatos) codigos = candidatos.slice(offset, offset + PAGINA);
      else {
        const { data, error } = await this.sb.from('produtos').select('cod_produto').order('descricao').order('cod_produto').range(offset, offset + PAGINA - 1);
        if (error) throw error;
        codigos = ((data ?? []) as Linha[]).map((p) => p.cod_produto as string);
      }
      if (!codigos.length) { proximo = null; break; }

      const porCodigo = new Map((await this.montar(ctx, codigos, new Map())).map((l) => [l.cod_produto as string, l]));
      let parouNoLimite = false;
      for (let i = 0; i < codigos.length; i++) {
        const l = porCodigo.get(codigos[i]);
        if (!l) continue;
        const semEstoque = l.estoque_cx != null ? Number(l.estoque_cx) < 1 : centroTemEstoque;
        const vendavel = !!l.disponivel && l.preco_tabela != null && !semEstoque;
        if (!vendavel && !incluirIndisponiveis) continue;
        itens.push({ ...l, sem_estoque: semEstoque });
        if (itens.length >= limite) { proximo = offset + i + 1; parouNoLimite = true; break; }
      }
      if (parouNoLimite) {
        // o limite caiu no fim da pagina e nao ha mais nada depois: nao oferece "carregar mais" a toa
        if (codigos.length < PAGINA && proximo === offset + codigos.length) proximo = null;
        break;
      }
      offset += PAGINA;
      if (codigos.length < PAGINA) { proximo = null; break; }
      proximo = offset;
    }
    return { itens, proximo };
  }

  /**
   * Tudo o que o vendedor quer saber de um produto para ESTE cliente antes de pedir: preco e desconto maximo da lista, faixas do
   * incentivo, combos em que o produto entra, o que o cliente ja comprou dele e a ficha tecnica. Mesmo conteudo da tela de produto do app.
   */
  async produtoDetalhe(codVendedor: string, codCliente: string, codProdutoRaw: string, escopo: Escopo | null = null) {
    exigirVendedor(escopo, codVendedor);
    await this.exigirClienteNoEscopo(codCliente, escopo);
    const codProduto = String(codProdutoRaw ?? '').trim();
    if (!codProduto || codProduto.length > 40) throw new UnprocessableEntityException('Produto invalido');
    const ctx = await this.contextoCliente(codCliente, normCod(codVendedor));

    const { data: prod, error } = await this.sb.from('produtos').select('cod_produto, descricao, ean, ncm, validade, tipo_material, dados').eq('cod_produto', codProduto).maybeSingle();
    if (error) throw error;
    if (!prod) throw new NotFoundException('Produto nao encontrado');
    const p = prod as Linha;
    const dados = (p.dados ?? {}) as Dados & { classificacao?: Linha; peso?: Linha; estoque?: Linha; unidade_base?: string | null; unidade_base_texto?: string | null; conversoes?: Array<{ unidade: string; fator: number }> };
    const cls = dados.classificacao as ClassificacaoSrv | undefined;

    const [linha] = await this.montar(ctx, [codProduto], new Map());
    const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const faixas = faixasQueServem(ctx.incentivos, codProduto, ctx.ctxInc, cls).map((r) => ({
      qtd_minima: Number(r.qtd_minima),
      desconto_pct: Number(r.desconto_pct),
      extra_max_pct: Number(r.desconto_extra_max_pct),
      escopo: r.escopo,
      alvo: r.cod_produto ? 'produto' : r.linha_id || r.grupo_id || r.categoria_id || r.marca ? 'classificacao' : 'todos',
    }));

    const hoje = hojeSp();
    const combos = ctx.combos
      .filter((c) => (!c.vigencia_ini || c.vigencia_ini <= hoje) && (!c.vigencia_fim || c.vigencia_fim >= hoje))
      .filter((c) => c.escopo !== 'vendedor' || String(c.escopo_valor ?? '').split(',').map((x) => x.trim()).includes(normCod(codVendedor)))
      .filter((c) => c.itens.some((it) => itemCasa(it, codProduto, cls)))
      .map((c) => ({
        id: c.id, nome: c.nome, beneficio: c.beneficio,
        desconto_pct: c.beneficio === 'desconto_pct' && c.desconto_pct != null ? Number(c.desconto_pct) : null,
        brinde_cod_produto: c.beneficio === 'produto_gratis' ? c.brinde_cod_produto : null,
        brinde_qtd: c.beneficio === 'produto_gratis' && c.brinde_qtd != null ? Number(c.brinde_qtd) : null,
        condicao: c.itens.map((it) => ({ alvo_tipo: it.alvo_tipo, alvo_valor: it.alvo_valor, qtd_minima: Number(it.qtd_minima) })),
      }));

    return {
      produto: linha ?? null,
      ficha: {
        linha: texto(dados.classificacao?.linha), grupo: texto(dados.classificacao?.grupo), categoria: texto(dados.classificacao?.categoria), marca: texto(dados.classificacao?.marca),
        ncm: texto(p.ncm), ean: texto(p.ean), validade: texto(p.validade),
        peso_liquido: texto(dados.peso?.pesoliquido), peso_bruto: texto(dados.peso?.pesobruto), prazo_dias: texto(dados.estoque?.prazoentregadias),
        unidade_base_texto: texto(dados.unidade_base_texto),
        fator_venda: dados.unidade_venda ? (dados.conversoes?.find((c) => c.unidade === dados.unidade_venda)?.fator ?? null) : null,
      },
      faixas,
      combos,
      historico: await this.historicoDoProduto(ctx.codCliente, codProduto),
    };
  }

  /** O que este cliente ja comprou deste produto nos ultimos 12 meses: resumo e as ultimas compras. */
  private async historicoDoProduto(codCliente: string, codProduto: string) {
    const desde = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const { data: peds, error } = await this.sb.from('pedidos_sap').select('ordem, dt_criacao, status').eq('cod_cliente', codCliente).gte('dt_criacao', desde).limit(1000);
    if (error) throw error;
    const dataDe = new Map<string, string>();
    for (const x of (peds ?? []) as Linha[]) if (x.dt_criacao && String(x.status ?? '').toLowerCase() !== 'recusado') dataDe.set(String(x.ordem), String(x.dt_criacao).slice(0, 10));
    const ordens = [...dataDe.keys()];
    const compras: Array<{ ordem: string; data: string; quantidade: number; unidade: string | null }> = [];
    for (let i = 0; i < ordens.length; i += 100) {
      const { data: its, error: eI } = await this.sb.from('pedido_itens_sap').select('ordem, quantidade, unidade_venda, recusa').eq('cod_produto', codProduto).in('ordem', ordens.slice(i, i + 100)).limit(1000);
      if (eI) throw eI;
      for (const it of (its ?? []) as Linha[]) if (!it.recusa) compras.push({ ordem: String(it.ordem), data: dataDe.get(String(it.ordem))!, quantidade: Number(it.quantidade ?? 0), unidade: it.unidade_venda ?? null });
    }
    compras.sort((a, b) => b.data.localeCompare(a.data));
    const datas = [...new Set(compras.map((c) => c.data))].sort();
    const intervalo = datas.length > 1 ? Math.round((Date.parse(datas[datas.length - 1]) - Date.parse(datas[0])) / 86_400_000 / (datas.length - 1)) : null;
    return {
      pedidos: new Set(compras.map((c) => c.ordem)).size,
      quantidade_total: Math.round(compras.reduce((a, c) => a + c.quantidade, 0) * 1000) / 1000,
      ultima_compra: compras[0]?.data ?? null,
      intervalo_dias: intervalo,
      ultimas: compras.slice(0, 8),
    };
  }

  /** O cliente tem que ser da carteira do escopo (vendedor ve so o dele; sem escopo = sem restricao). */
  private async exigirClienteNoEscopo(codCliente: string, escopo: Escopo | null) {
    if (!escopo) return;
    const { data, error } = await this.sb.from('rota_clientes').select('rota').eq('cod_cliente', normCod(String(codCliente ?? ''))).limit(50);
    if (error) throw error;
    if (!((data ?? []) as Linha[]).some((r) => escopo.rotas.includes(r.rota as string))) throw new ForbiddenException('Este cliente nao e da sua carteira');
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

  /**
   * Itens de um pedido do SAP prontos para entrar de novo no carrinho ("duplicar pedido"): so os nao recusados, em caixa
   * (unidade que o pedido usa), com preco e estoque de hoje. O que nao da para repor volta em `ignorados` com o motivo.
   */
  async duplicar(codVendedor: string, codCliente: string, ordemRaw: string, escopo: Escopo | null = null) {
    exigirVendedor(escopo, codVendedor);
    const ordem = String(ordemRaw ?? '').trim();
    if (!/^[0-9]{1,10}$/.test(ordem)) throw new UnprocessableEntityException('Numero de ordem invalido');
    const ctx = await this.contextoCliente(codCliente, normCod(codVendedor));

    const { data: ped, error } = await this.sb.from('pedidos_sap').select('ordem, cod_cliente').eq('ordem', ordem).maybeSingle();
    if (error) throw error;
    if (!ped || normCod(String((ped as Linha).cod_cliente)) !== ctx.codCliente) throw new NotFoundException('Pedido nao encontrado para este cliente');
    const { data: its, error: eI } = await this.sb.from('pedido_itens_sap').select('cod_produto, denominacao, quantidade, unidade_venda, recusa').eq('ordem', ordem).order('item');
    if (eI) throw eI;

    const ignorados: Array<{ cod_produto: string; descricao: string | null; motivo: string }> = [];
    const qtd = new Map<string, number>();
    for (const it of (its ?? []) as Linha[]) {
      const cod = String(it.cod_produto ?? '');
      if (!cod) continue;
      if (it.recusa) { ignorados.push({ cod_produto: cod, descricao: it.denominacao ?? null, motivo: 'item recusado no pedido original' }); continue; }
      const un = String(it.unidade_venda ?? '').trim().toUpperCase();
      if (un && un !== 'CX' && un !== 'KI') { ignorados.push({ cod_produto: cod, descricao: it.denominacao ?? null, motivo: `vendido em ${un}: confira a quantidade e adicione pelo catalogo` }); continue; }
      qtd.set(cod, (qtd.get(cod) ?? 0) + Number(it.quantidade ?? 0));
    }
    if (!qtd.size) return { itens: [] as Linha[], ignorados };

    const linhas = new Map(
      (await this.montar(ctx, [...qtd.keys()], new Map([...qtd.keys()].map((c) => [c, 'comprou'])))).map((l) => [l.cod_produto as string, l]),
    );
    const itens: Linha[] = [];
    for (const [cod, q] of qtd) {
      const l = linhas.get(cod);
      if (!l || !l.disponivel) { ignorados.push({ cod_produto: cod, descricao: (l?.descricao as string | undefined) ?? null, motivo: 'sem preco de tabela ou estoque hoje' }); continue; }
      itens.push({ quantidade: Math.max(1, Math.round(q)), produto: l });
    }
    return { itens, ignorados };
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
    if (!lista.length) return { itens: [], total: 0, pedido_minimo: null, brindes: [], combos: { aplicados: [], incompletos: [] } };
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
      // proxima faixa do incentivo que da mais desconto que o atual: "faltam N cx para X%"
      const proxima = tipo === 'venda'
        ? faixasQueServem(ctx.incentivos, produto, { ...ctx.ctxInc, hoje }, (p.dados as Dados | null)?.classificacao as ClassificacaoSrv | undefined)
            .find((f) => Number(f.qtd_minima) > q && Number(f.desconto_pct) > auto)
        : undefined;
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
        proxima_faixa: proxima ? { qtd_minima: Number(proxima.qtd_minima), desconto_pct: Number(proxima.desconto_pct), extra_max_pct: Number(proxima.desconto_extra_max_pct), falta: Math.round((Number(proxima.qtd_minima) - q) * 1000) / 1000 } : null,
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

    // combos do carrinho: o que ja fecha e o que esta perto de fechar (falta X)
    const status = tipo === 'venda'
      ? statusCombosSrv(
          ctx.combos,
          lista.map((i) => ({ produto: String(i?.produto ?? '').trim(), quantidade: Number(String(i?.quantidade ?? '').replace(',', '.')) || 0 })),
          { ...ctx.ctxInc, hoje },
          Object.fromEntries([...prods].map(([k, x]) => [k, (x.dados as Dados | null)?.classificacao])),
        )
      : { aplicados: [], incompletos: [] };
    const codsNomes = [...new Set([
      ...status.aplicados.map((a) => a.combo.brinde_cod_produto),
      ...status.incompletos.flatMap((f) => [f.combo.brinde_cod_produto, ...f.faltas.filter((x) => x.item.alvo_tipo === 'produto').map((x) => x.item.alvo_valor)]),
    ].filter((x): x is string => !!x))];
    const nomes = await this.produtosPorCodigo(codsNomes);
    const nomeDe = (cod: string | null) => (cod ? ((nomes.get(cod)?.descricao as string | undefined) ?? cod) : null);
    const combos = {
      aplicados: status.aplicados.map((a) => ({
        id: a.combo.id, nome: a.combo.nome, vezes: a.vezes,
        desconto_pct: a.combo.beneficio === 'desconto_pct' && a.descontoPct > 0 ? a.descontoPct : null,
        brinde: a.combo.beneficio === 'produto_gratis' && a.combo.brinde_cod_produto && a.brindeQtd > 0 ? { produto: a.combo.brinde_cod_produto, descricao: nomeDe(a.combo.brinde_cod_produto), quantidade: a.brindeQtd } : null,
      })),
      incompletos: status.incompletos.map((f) => ({
        id: f.combo.id, nome: f.combo.nome, beneficio: f.combo.beneficio,
        desconto_pct: f.combo.beneficio === 'desconto_pct' && f.combo.desconto_pct != null ? Number(f.combo.desconto_pct) : null,
        brinde: f.combo.beneficio === 'produto_gratis' && f.combo.brinde_cod_produto ? { produto: f.combo.brinde_cod_produto, descricao: nomeDe(f.combo.brinde_cod_produto), quantidade: Number(f.combo.brinde_qtd ?? 1) } : null,
        faltas: f.faltas.map((x) => ({ alvo_tipo: x.item.alvo_tipo, alvo_valor: x.item.alvo_valor, alvo_descricao: x.item.alvo_tipo === 'produto' ? nomeDe(x.item.alvo_valor) : null, falta: x.falta })),
      })),
    };

    return { itens: saida, total: arred2(total), pedido_minimo: (cli as Linha | null)?.pedido_minimo == null ? null : Number((cli as Linha).pedido_minimo), brindes, combos };
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
