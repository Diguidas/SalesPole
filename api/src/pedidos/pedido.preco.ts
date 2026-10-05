// Preco minimo permitido por item (trava de desconto no servidor). Mesma regra do app:
// lista+grupo (A912) vale antes de lista (A913); o preco de tabela e levado para a unidade do pedido
// (KG -> CX etc. pelas conversoes do produto); minimo = tabela x (1 - desconto_max/100), 2 casas.

export interface LinhaPrecoSrv {
  kbetr: number | null;
  kpein: number | null;
  kmein: string | null;
  datab: string;
  datbi: string;
  desconto_max: number | null;
}

export interface DadosProdutoSrv {
  unidade_base?: string | null;
  conversoes?: Array<{ unidade: string; fator: number }>;
}

const arred2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;

function fatorBase(unidade: string, d: DadosProdutoSrv): number | null {
  if (d.unidade_base && unidade === d.unidade_base) return 1;
  const f = d.conversoes?.find((c) => c.unidade === unidade)?.fator;
  return f && f > 0 ? f : null;
}

function escolher(linhas: LinhaPrecoSrv[], hoje: string): LinhaPrecoSrv | null {
  return (
    linhas
      .filter((l) => l.datab <= hoje && l.datbi >= hoje && l.kbetr !== null && l.kbetr > 0)
      .sort((a, b) => b.datab.localeCompare(a.datab))[0] ?? null
  );
}

/**
 * Preco de tabela por 1 `unidade` e o desconto maximo (%) que vale hoje para o produto.
 * null = nao ha preco vigente ou nao da para converter a unidade (nao da para validar).
 */
export function tabelaDoItem(
  grupos: LinhaPrecoSrv[],
  listas: LinhaPrecoSrv[],
  hoje: string,
  unidade: string,
  dados: DadosProdutoSrv,
): { valor: number; descontoMax: number } | null {
  const l = escolher(grupos, hoje) ?? escolher(listas, hoje);
  if (!l || l.kbetr === null) return null;
  const kpein = Number(l.kpein);
  const porUnidadeDaTabela = Number(l.kbetr) / (kpein > 0 ? kpein : 1);
  let valor = porUnidadeDaTabela;
  if (l.kmein !== unidade) {
    const de = l.kmein ? fatorBase(l.kmein, dados) : null;
    const para = fatorBase(unidade, dados);
    if (!de || !para) return null;
    valor = (porUnidadeDaTabela / de) * para;
  }
  const max = Number(l.desconto_max);
  return { valor, descontoMax: max > 0 ? max : 0 };
}

/** Preco minimo aceito (2 casas) para uma tabela com desconto maximo. */
export function precoMinimo(valor: number, descontoMax: number): number {
  return arred2(valor * (1 - descontoMax / 100));
}

/** Mensagem de erro ou null se o preco enviado respeita o desconto maximo (preco acima da tabela e livre). */
export function conferirPreco(preco: number, tabela: { valor: number; descontoMax: number }): string | null {
  const min = precoMinimo(tabela.valor, tabela.descontoMax);
  if (preco >= min - 0.0001) return null;
  const maxTxt = tabela.descontoMax > 0 ? `desconto maximo de ${tabela.descontoMax}%` : 'sem desconto para esta lista';
  return `preco ${preco.toFixed(2)} abaixo do minimo ${min.toFixed(2)} (tabela ${arred2(tabela.valor).toFixed(2)}, ${maxTxt})`;
}
