import type { SQLiteDatabase } from 'expo-sqlite';

// Consultas da tela de info do produto e da aba Sugestao do pedido. Tudo local (offline).

const json = <T>(v: unknown, vazio: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : vazio;
  } catch {
    return vazio;
  }
};

export interface FichaProduto {
  cod_produto: string;
  descricao: string;
  ean: string | null;
  ncm: string | null;
  validade: string | null;
  marca: string | null;
  categoria: string | null;
  linha: string | null;
  grupo: string | null;
  pesoLiquido: string | null;
  pesoBruto: string | null;
  /** dias de producao do produto (estoque.prazoentregadias) */
  prazoDias: string | null;
  /** unidade base (ex.: KG) e unidade em que o pedido e feito (ex.: KI = caixa), com os textos */
  unidadeBase: string | null;
  unidadeBaseTexto: string | null;
  unidadeVenda: string | null;
  unidadeVendaTexto: string | null;
  /** quantas unidades base ha em 1 unidade de venda (ex.: 14 = caixa de 14 KG) */
  fatorVenda: number | null;
}

/** Ficha tecnica (linha, grupo, NCM, EAN...) do cadastro do produto. */
export async function fichaDoProduto(db: SQLiteDatabase, cod: string): Promise<FichaProduto | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT cod_produto, descricao, ean, ncm, validade, dados FROM produtos WHERE cod_produto = ?',
    cod,
  );
  if (!r) return null;
  const d = json<{
    classificacao?: { marca?: string; categoria?: string; linha?: string; grupo?: string };
    peso?: { pesoliquido?: string; pesobruto?: string };
    estoque?: { prazoentregadias?: string };
    unidade_base?: string | null;
    unidade_base_texto?: string | null;
    unidade_venda?: string | null;
    unidade_venda_texto?: string | null;
    conversoes?: Array<{ unidade: string; fator: number }>;
  }>(r.dados, {});
  const t = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    cod_produto: r.cod_produto as string,
    descricao: (r.descricao as string | null) ?? (r.cod_produto as string),
    ean: t(r.ean),
    ncm: t(r.ncm),
    validade: t(r.validade),
    marca: t(d.classificacao?.marca),
    categoria: t(d.classificacao?.categoria),
    linha: t(d.classificacao?.linha),
    grupo: t(d.classificacao?.grupo),
    pesoLiquido: t(d.peso?.pesoliquido),
    pesoBruto: t(d.peso?.pesobruto),
    prazoDias: t(d.estoque?.prazoentregadias),
    unidadeBase: t(d.unidade_base),
    unidadeBaseTexto: t(d.unidade_base_texto),
    unidadeVenda: t(d.unidade_venda),
    unidadeVendaTexto: t(d.unidade_venda_texto),
    fatorVenda: d.unidade_venda ? (d.conversoes?.find((c) => c.unidade === d.unidade_venda)?.fator ?? null) : null,
  };
}

export interface Destaque {
  cod_produto: string;
  destaque: number;
  lancamento: number;
}

/** Produtos marcados como destaque/lancamento no painel web. */
export function listarDestaques(db: SQLiteDatabase) {
  return db.getAllAsync<Destaque>(
    'SELECT cod_produto, destaque, lancamento FROM destaques WHERE destaque = 1 OR lancamento = 1 ORDER BY ordem, cod_produto',
  );
}

export interface UltimoPedido {
  ordem: string;
  dt_criacao: string | null;
  valor: number | null;
  status: string | null;
  itens: number;
}

/** Ultimos pedidos (ordens do SAP) do cliente, com a quantidade de itens. */
export function ultimosPedidosDoCliente(db: SQLiteDatabase, cod: string, limite = 5) {
  return db.getAllAsync<UltimoPedido>(
    `SELECT p.ordem AS ordem, p.dt_criacao AS dt_criacao, p.valor AS valor, p.status AS status,
            (SELECT COUNT(*) FROM pedido_itens_sap i WHERE i.ordem = p.ordem AND COALESCE(i.recusa, '') = '') AS itens
       FROM pedidos_sap p WHERE p.cod_cliente = ? ORDER BY p.dt_criacao DESC, p.ordem DESC LIMIT ?`,
    cod,
    limite,
  );
}
