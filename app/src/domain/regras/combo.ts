// GERADO a partir de shared/regras/combo.ts. NAO EDITE AQUI: altere a fonte e rode "npm run shared" (app ou api).
// Nucleo das regras de combo comum ao app (app/src/domain) e a API (api/src/pedidos). FONTE UNICA: edite so aqui
// (shared/) e rode `npm run shared` na pasta do app ou da API para copiar. O app usa tambem as "faltas" (aviso "falta X");
// a API so confere o que o app mandou.

import { listaCsv, pesoEscopo, type ClassificacaoIds } from './incentivo';

export const EPS = 1e-9;

export interface ItemCondicaoBase {
  alvo_tipo: string;
  alvo_valor: string | null | undefined;
  qtd_minima: number | string;
}

export interface FaixaCombo {
  qtd_minima: number;
  desconto_pct?: number | null;
  brinde_qtd?: number | null;
}

export const normAlvo = (tipo: string, v: string | null | undefined): string => {
  const t = (v ?? '').trim().toLowerCase();
  // IDs do SAP (NUMC) podem vir com zeros a esquerda; a marca e texto
  return tipo === 'marca' || tipo === 'produto' ? t : t.replace(/^0+(?=\d)/, '');
};

/** O produto casa com este item da condicao? alvo_valor aceita VARIOS materiais separados por virgula ("qualquer um destes"). */
export function itemCasa(it: ItemCondicaoBase, produto: string, cls?: ClassificacaoIds | null): boolean {
  const alvos = listaCsv(it.alvo_valor).map((x) => normAlvo(it.alvo_tipo, x));
  if (!alvos.length) return false;
  switch (it.alvo_tipo) {
    case 'produto':
      return alvos.includes(normAlvo('produto', produto));
    case 'marca':
      return alvos.includes(normAlvo('marca', cls?.marca));
    case 'linha':
      return alvos.includes(normAlvo('linha', cls?.linha_id));
    case 'grupo':
      return alvos.includes(normAlvo('grupo', cls?.grupo_id));
    case 'categoria':
      return alvos.includes(normAlvo('categoria', cls?.categoria_id));
    default:
      return false;
  }
}

/** Mesma promocao = mesmo tipo de beneficio e mesma condicao (itens, materiais e quantidades). */
export const assinaturaCombo = (c: { beneficio: string; itens: ItemCondicaoBase[] }): string =>
  c.beneficio + '#' + c.itens.map((i) => `${i.alvo_tipo}|${listaCsv(i.alvo_valor).map((x) => normAlvo(i.alvo_tipo, x)).sort().join('+')}|${Number(i.qtd_minima)}`).sort().join('&');

/** Entre combos completos com a MESMA condicao, vale so o de escopo mais especifico (cliente > vendedor > equipe > escritorio > lista+grupo > lista > tipo > canal > geral). */
export function semSubstituidos<T>(
  completos: T[],
  combo: (x: T) => { beneficio: string; itens: ItemCondicaoBase[]; escopo: string; escopo_valor?: string | null },
): T[] {
  return completos.filter(
    (x) => !completos.some((y) => y !== x && assinaturaCombo(combo(y)) === assinaturaCombo(combo(x)) && pesoEscopo(combo(y)) > pesoEscopo(combo(x))),
  );
}

/** Maior faixa cujo minimo o total de caixas da condicao atingiu (null = vale o beneficio base). */
export function faixaAtingida(faixas: FaixaCombo[] | null | undefined, total: number): FaixaCombo | null {
  let melhor: FaixaCombo | null = null;
  for (const f of faixas ?? []) {
    if (Number(f.qtd_minima) <= total + EPS && (!melhor || Number(f.qtd_minima) > Number(melhor.qtd_minima))) melhor = f;
  }
  return melhor;
}

export interface ResultadoCondicao<I extends ItemCondicaoBase> {
  /** quantas vezes cada item da condicao cabe */
  razoes: number[];
  /** todos os itens atingiram o minimo */
  completo: boolean;
  /** total de caixas que entraram na condicao */
  total: number;
  /** produtos do pedido que formaram a condicao */
  usados: Set<string>;
  /** o que ainda falta, por item (so os que nao atingiram o minimo) */
  faltas: Array<{ item: I; falta: number }>;
  /** algum item da condicao ja tem quantidade no pedido */
  algumProgresso: boolean;
}

/**
 * Confere a condicao do combo contra as linhas do pedido (sem os brindes). A quantidade de cada linha conta para UM
 * item da condicao: os itens por produto pegam primeiro, depois os demais, na ordem do cadastro. (Nao conta duas vezes.)
 */
export function avaliarCondicao<I extends ItemCondicaoBase>(
  itens: I[],
  linhas: Array<{ produto: string; qtd: number }>,
  classificacaoPorProduto: Record<string, ClassificacaoIds | undefined>,
): ResultadoCondicao<I> {
  const ordem = [...itens].sort((a, b) => Number(b.alvo_tipo === 'produto') - Number(a.alvo_tipo === 'produto'));
  const restante = linhas.map((l) => l.qtd);
  const usados = new Set<string>();
  const razoes: number[] = [];
  const faltas: ResultadoCondicao<I>['faltas'] = [];
  let total = 0;
  let algumProgresso = false;

  for (const it of ordem) {
    const min = Number(it.qtd_minima);
    let doItem = 0;
    linhas.forEach((l, n) => {
      if (restante[n] > 0 && itemCasa(it, l.produto, classificacaoPorProduto[l.produto])) {
        doItem += restante[n];
        restante[n] = 0;
        usados.add(l.produto);
      }
    });
    if (doItem > 0) algumProgresso = true;
    total += doItem;
    razoes.push(min > 0 ? Math.floor(doItem / min + EPS) : 0);
    if (doItem + EPS < min) faltas.push({ item: it, falta: Math.round((min - doItem) * 1000) / 1000 });
  }
  return { razoes, completo: razoes.every((r) => r >= 1), total, usados, faltas, algumProgresso };
}

/** Com `repete` o beneficio vale uma vez para cada vez que a condicao cabe (ate `max_repeticoes`); sem `repete`, uma vez so. */
export function vezesDoCombo(c: { repete: boolean; max_repeticoes: number | null }, razoes: number[]): number {
  const limite = c.max_repeticoes && c.max_repeticoes > 0 ? c.max_repeticoes : Infinity;
  return c.repete ? Math.min(Math.min(...razoes), limite) : 1;
}

/** Beneficio do combo na faixa atingida (a faixa, quando tem valor, vale no lugar do beneficio base). */
export function beneficioDaFaixa(
  c: { brinde_qtd?: number | string | null; desconto_pct?: number | string | null },
  faixa: FaixaCombo | null,
): { brindeQtd: number; descontoPct: number } {
  return {
    brindeQtd: faixa?.brinde_qtd != null && Number(faixa.brinde_qtd) > 0 ? Number(faixa.brinde_qtd) : Number(c.brinde_qtd ?? 0),
    descontoPct: faixa?.desconto_pct != null && Number(faixa.desconto_pct) > 0 ? Number(faixa.desconto_pct) : Number(c.desconto_pct ?? 0),
  };
}

/** Desconto do combo nos produtos que formaram a condicao: vale o maior (e, empatando, o maior extra do vendedor). */
export function registrarDescontoCombo(
  mapa: Record<string, { pct: number; extra: number }>,
  produtos: Iterable<string>,
  pct: number,
  extraBruto: number | string | null | undefined,
): void {
  const extra = Number(extraBruto) || 0;
  for (const p of produtos) {
    const atual = mapa[p];
    if (!atual || pct > atual.pct || (pct === atual.pct && extra > atual.extra)) mapa[p] = { pct, extra };
  }
}
