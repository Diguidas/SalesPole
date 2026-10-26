// Desconto por incentivo (tabela incentivos_desconto, cadastrada no painel): a partir de uma
// quantidade o produto ganha um desconto, e o vendedor ainda pode dar um extra ate um teto.
// O nucleo (escopo, alvo, desempate) vive em shared/regras/incentivo.ts e e o MESMO do app; aqui fica so o que e do servidor
// (conferir ativo e vigencia, que o app ja recebe filtrado).
//
// A regra tem duas dimensoes:
//   QUEM compra (escopo): geral | cliente | vendedor | canal | escritorio
//   O QUE compra (alvo):  um produto (cod_produto) OU a classificacao do produto (ID da linha, do grupo,
//                         da categoria; marca por texto; varios juntos = todos precisam bater) OU qualquer produto
// Quantidade minima 0 = sem minimo (desconto fixo).

import { alvoServeProduto, escopoServe, melhorPorQuantidade, pesoEscopo, type ClassificacaoIds, type ContextoComprador } from './regras/incentivo';

export interface IncentivoRow {
  id: string;
  cod_produto: string | null;
  escopo: string; // geral | produto | cliente | vendedor | canal | escritorio
  escopo_valor: string | null;
  linha_id?: string | null;
  grupo_id?: string | null;
  categoria_id?: string | null;
  marca?: string | null;
  qtd_minima: number;
  desconto_pct: number;
  desconto_extra_max_pct: number;
  vigencia_ini: string | null;
  vigencia_fim: string | null;
  ativo: boolean;
}

export type ClassificacaoSrv = ClassificacaoIds;

export interface ContextoIncentivo extends ContextoComprador {
  /** AAAA-MM-DD */
  hoje: string;
}

export { pesoEscopo };

function vale(r: IncentivoRow, produto: string, ctx: ContextoIncentivo, cls?: ClassificacaoSrv | null): boolean {
  if (!r.ativo) return false;
  if (r.vigencia_ini && r.vigencia_ini > ctx.hoje) return false;
  if (r.vigencia_fim && r.vigencia_fim < ctx.hoje) return false;
  return alvoServeProduto(r, produto, cls) && escopoServe(r.escopo, r.escopo_valor, ctx);
}

/** Todas as faixas que servem ao produto (para o comprador do contexto), da menor para a maior quantidade minima. */
export function faixasQueServem(rows: IncentivoRow[], produto: string, ctx: ContextoIncentivo, cls?: ClassificacaoSrv | null): IncentivoRow[] {
  return rows.filter((r) => vale(r, produto, ctx, cls)).sort((a, b) => Number(a.qtd_minima) - Number(b.qtd_minima));
}

/** Regra que vale para o produto nessa quantidade: maior quantidade minima atingida; empate = escopo mais especifico, depois alvo mais especifico. */
export function incentivoAplicavel(
  rows: IncentivoRow[],
  produto: string,
  qtd: number,
  ctx: ContextoIncentivo,
  cls?: ClassificacaoSrv | null,
): IncentivoRow | null {
  return melhorPorQuantidade(rows.filter((r) => vale(r, produto, ctx, cls)), qtd);
}

/** Desconto extra (%) que o incentivo libera alem do maximo da lista: o automatico + o que o vendedor pode acrescentar. */
export function descontoLiberadoPeloIncentivo(r: IncentivoRow | null): number {
  return r ? Number(r.desconto_pct) + Number(r.desconto_extra_max_pct) : 0;
}
