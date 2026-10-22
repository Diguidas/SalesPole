import type { SQLiteDatabase } from 'expo-sqlite';
import { avaliarCombos, comBrindes, type Combo, type ResultadoCombos } from '@/domain/combo';
import { oportunidadesDeCombo } from '@/domain/oportunidade';
import type { CompraDoCliente } from '@/domain/reposicao';
import { ajustarDescontos, type Classificacao, type ContextoIncentivo, type Incentivo } from '@/domain/incentivo';
import type { ItemPedido } from '@/domain/pedido';
import { carregarCombos } from './combos';
import type { AreaCliente } from '@/domain/preco';
import { lerMeta } from './sync';

export interface DadosIncentivo {
  rows: Incentivo[];
  ctx: ContextoIncentivo;
  /** combos do painel (tela Desconto) que o aparelho tem */
  combos: Combo[];
  /** produtos de brinde dos combos: unidade de venda e nome (o brinde nem sempre esta no carrinho) */
  brindes: Record<string, { unidade: string; descricao: string }>;
}

const unicos = (v: Array<string | null | undefined>) => [...new Set(v.filter((x): x is string => !!x))];

/**
 * Regras de incentivo do painel que o aparelho tem (tabela `incentivos`) e o contexto de quem esta
 * comprando (cliente, vendedor, canal, escritorio), que decide quais regras valem.
 */
export async function carregarIncentivos(db: SQLiteDatabase, codCliente: string, areas: AreaCliente[]): Promise<DadosIncentivo> {
  const rows = await db.getAllAsync<Incentivo>(
    `SELECT id, cod_produto, escopo, escopo_valor, linha_id, grupo_id, categoria_id, marca, qtd_minima, desconto_pct, desconto_extra_max_pct FROM incentivos`,
  );
  let codVendedor = '';
  let equipe: string | null = null;
  try {
    const v = JSON.parse((await lerMeta(db, 'vendedor')) ?? '{}') as { cod?: string; equipe?: string | null };
    codVendedor = v.cod ?? '';
    equipe = v.equipe ?? null;
  } catch {
    codVendedor = '';
  }
  const combos = await carregarCombos(db);
  return {
    rows,
    ctx: {
      codCliente,
      codVendedor,
      canais: unicos(areas.map((a) => a.canal?.codigo)),
      escritorios: unicos(areas.map((a) => a.escritorio?.codigo)),
      // lista sozinha ("L") e lista com o grupo de preco do cliente ("L.G")
      listasPreco: unicos(areas.flatMap((a) => (a.lista_preco?.codigo ? [a.lista_preco.codigo, a.rede?.codigo ? `${a.lista_preco.codigo}.${a.rede.codigo}` : null] : []))),
      tiposEstabelecimento: unicos(areas.map((a) => a.tipo_estabelecimento?.codigo)),
      equipes: unicos([equipe]),
    },
    combos,
    brindes: await produtosDeBrinde(db, combos),
  };
}

/** Unidade de venda (codigo, ex.: KI) e descricao dos produtos que os combos dao de brinde. */
async function produtosDeBrinde(db: SQLiteDatabase, combos: Combo[]): Promise<DadosIncentivo['brindes']> {
  const codigos = unicos(combos.filter((c) => c.beneficio === 'produto_gratis').map((c) => c.brinde_cod_produto));
  if (!codigos.length) return {};
  const rows = await db.getAllAsync<{ cod_produto: string; descricao: string | null; dados: string | null }>(
    `SELECT cod_produto, descricao, dados FROM produtos WHERE cod_produto IN (${codigos.map(() => '?').join(',')})`,
    ...codigos,
  );
  const out: DadosIncentivo['brindes'] = {};
  for (const r of rows) {
    let unidade = 'KI';
    try {
      unidade = (JSON.parse(r.dados ?? '{}') as { unidade_venda?: string | null }).unidade_venda || 'KI';
    } catch {
      unidade = 'KI';
    }
    out[r.cod_produto] = { unidade, descricao: r.descricao ?? r.cod_produto };
  }
  return out;
}

/**
 * Recalcula o pedido com TODAS as regras de desconto: combos (condicao no carrinho -> brinde ou desconto) e
 * incentivo por quantidade + parte do vendedor. Os brindes antigos saem e entram os de agora. Chame sempre que
 * a quantidade de um item mudar, antes de gravar o carrinho e antes de enviar.
 */
export function aplicarRegras(
  itens: ItemPedido[],
  info: Record<string, { preco: { descontoMax?: number } | null; classificacao?: Classificacao } | undefined>,
  dados: DadosIncentivo,
  /** false = pedido de bonificacao: combo nao vale (e brindes antigos saem) */
  usarCombos = true,
): { itens: ItemPedido[]; combos: ResultadoCombos } {
  const base = itens.filter((i) => !i.brinde);
  const cls = classificacaoPorProduto(info);
  const combos = avaliarCombos(usarCombos ? dados.combos : [], base, dados.ctx, cls);
  const ajustados = ajustarDescontos(base, descontoMaxPorProduto(info), dados.rows, dados.ctx, cls, combos.descontoPorProduto);
  const unidades = Object.fromEntries(Object.entries(dados.brindes).map(([k, v]) => [k, v.unidade]));
  return { itens: comBrindes(ajustados, combos.brindes, unidades), combos };
}

/** Desconto maximo da lista de preco por produto (para recalcular os descontos do carrinho). */
/**
 * Combos que o cliente quase fecha com o que costuma comprar (pedido tipico dos ultimos 12 meses).
 * A classificacao (linha, grupo, categoria, marca) dos produtos vem do cadastro local, para os combos por classificacao.
 */
export async function oportunidadesDoCliente(db: SQLiteDatabase, compras: CompraDoCliente[], dados: DadosIncentivo, max = 3): Promise<ResultadoCombos> {
  if (!dados.combos.length || !compras.length) return { aplicados: [], brindes: [], descontoPorProduto: {}, incompletos: [] };
  const codigos = compras.map((c) => c.cod_produto);
  const rows: Array<{ cod_produto: string; dados: string | null }> = [];
  for (let i = 0; i < codigos.length; i += 400) {
    const lote = codigos.slice(i, i + 400);
    rows.push(...(await db.getAllAsync<{ cod_produto: string; dados: string | null }>(
      `SELECT cod_produto, dados FROM produtos WHERE cod_produto IN (${lote.map(() => '?').join(',')})`,
      ...lote,
    )));
  }
  const cls: Record<string, Classificacao | undefined> = {};
  for (const r of rows) {
    try {
      cls[r.cod_produto] = (JSON.parse(r.dados ?? '{}') as { classificacao?: Classificacao }).classificacao;
    } catch {
      cls[r.cod_produto] = undefined;
    }
  }
  return oportunidadesDeCombo(dados.combos, compras, dados.ctx, cls, max);
}

export function descontoMaxPorProduto(info: Record<string, { preco: { descontoMax?: number } | null } | undefined>): Record<string, number> {
  return Object.fromEntries(Object.entries(info).map(([k, v]) => [k, v?.preco?.descontoMax ?? 0]));
}

/** linha/grupo/categoria/marca de cada produto (para as regras de incentivo por classificacao). */
export function classificacaoPorProduto(info: Record<string, { classificacao?: Classificacao } | undefined>): Record<string, Classificacao | undefined> {
  return Object.fromEntries(Object.entries(info).map(([k, v]) => [k, v?.classificacao]));
}
