import type { SQLiteDatabase } from 'expo-sqlite';
import type { Classificacao, ContextoIncentivo, Incentivo } from '@/domain/incentivo';
import type { AreaCliente } from '@/domain/preco';
import { lerMeta } from './sync';

export interface DadosIncentivo {
  rows: Incentivo[];
  ctx: ContextoIncentivo;
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
  try {
    codVendedor = (JSON.parse((await lerMeta(db, 'vendedor')) ?? '{}') as { cod?: string }).cod ?? '';
  } catch {
    codVendedor = '';
  }
  return {
    rows,
    ctx: {
      codCliente,
      codVendedor,
      canais: unicos(areas.map((a) => a.canal?.codigo)),
      escritorios: unicos(areas.map((a) => a.escritorio?.codigo)),
    },
  };
}

/** Desconto maximo da lista de preco por produto (para recalcular os descontos do carrinho). */
export function descontoMaxPorProduto(info: Record<string, { preco: { descontoMax?: number } | null } | undefined>): Record<string, number> {
  return Object.fromEntries(Object.entries(info).map(([k, v]) => [k, v?.preco?.descontoMax ?? 0]));
}

/** linha/grupo/categoria/marca de cada produto (para as regras de incentivo por classificacao). */
export function classificacaoPorProduto(info: Record<string, { classificacao?: Classificacao } | undefined>): Record<string, Classificacao | undefined> {
  return Object.fromEntries(Object.entries(info).map(([k, v]) => [k, v?.classificacao]));
}
