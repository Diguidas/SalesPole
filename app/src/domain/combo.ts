// Combos de desconto (cadastrados no painel, tela Desconto): o pedido precisa ter certos itens (a CONDICAO) para o
// cliente ganhar um BENEFICIO: um produto de brinde (item de preco zero) ou um desconto % nos itens da condicao.
// Cada item da condicao aceita VARIOS materiais (alvo_valor com codigos separados por virgula = qualquer um deles) e
// o combo (sem repeticao) pode ter FAIXAS: o beneficio sobe pelo total de caixas dos itens da condicao.
// O nucleo do calculo vive em shared/regras/combo.ts e e o MESMO da API; aqui ficam os tipos e o carrinho do app.
//
// Regras do calculo:
//  - Cada item da condicao e produto | marca | linha | grupo | categoria, com a quantidade minima (em caixas).
//  - A quantidade de cada linha do pedido conta para UM item da condicao: os itens por produto pegam primeiro,
//    depois os demais, na ordem em que foram cadastrados. (Nao conta duas vezes.)
//  - Combo completo = todos os itens atingiram o minimo. Com `repete`, vale uma vez para cada vez que a condicao
//    cabe (ate `max_repeticoes`); sem `repete`, vale uma vez so.
//  - Brinde: brinde_qtd x vezes. Desconto: nos produtos que formaram a condicao; se houver incentivo por quantidade
//    no mesmo produto, vale o MAIOR desconto (e o extra do vendedor acompanha o que venceu).
//  - Os itens de brinde do pedido (brinde = true) nunca entram na condicao.

import type { Classificacao, ContextoIncentivo } from './incentivo';
import { avaliarCondicao, beneficioDaFaixa, registrarDescontoCombo, semSubstituidos, vezesDoCombo, faixaAtingida, itemCasa } from './regras/combo';
import { escopoServe } from './regras/incentivo';
import type { ItemPedido } from './pedido';
import { formatarQuantidade, lerQuantidade } from './quantidade';

export { faixaAtingida, itemCasa };

export type AlvoTipo = 'produto' | 'marca' | 'linha' | 'grupo' | 'categoria';

export interface ItemCondicao {
  alvo_tipo: AlvoTipo | string;
  alvo_valor: string;
  qtd_minima: number;
}

export type { FaixaCombo } from './regras/combo';
import type { FaixaCombo } from './regras/combo';

export interface Combo {
  id: string;
  nome: string;
  /** geral | cliente | vendedor | canal | escritorio */
  escopo: string;
  escopo_valor: string | null;
  /** produto_gratis | desconto_pct */
  beneficio: string;
  brinde_cod_produto: string | null;
  brinde_qtd: number | null;
  desconto_pct: number | null;
  desconto_extra_max_pct: number;
  repete: boolean;
  max_repeticoes: number | null;
  /** degraus do beneficio pelo total de caixas da condicao (so combo sem repeticao) */
  faixas?: FaixaCombo[];
  itens: ItemCondicao[];
}

export interface AplicacaoCombo {
  combo: Combo;
  /** quantas vezes a condicao se completou (e o beneficio se repete) */
  vezes: number;
  /** produtos do pedido que formaram a condicao */
  produtos: string[];
  /** total de caixas dos itens da condicao e a faixa atingida (se o combo tem faixas) */
  total: number;
  faixa: FaixaCombo | null;
}

export interface BrindeCombo {
  produto: string;
  quantidade: number;
  comboId: string;
  comboNome: string;
}

export interface FaltaCombo {
  combo: Combo;
  /** o que ainda falta, por item da condicao (so os que nao atingiram o minimo) */
  faltas: Array<{ item: ItemCondicao; falta: number }>;
}

export interface ResultadoCombos {
  aplicados: AplicacaoCombo[];
  brindes: BrindeCombo[];
  /** desconto % automatico (e extra liberado ao vendedor) que o combo da a cada produto */
  descontoPorProduto: Record<string, { pct: number; extra: number }>;
  /** combos que servem ao comprador e ja tem parte da condicao no pedido (para avisar "falta X") */
  incompletos: FaltaCombo[];
}

/** O combo vale para quem esta comprando? (so o escopo; a vigencia o servidor ja filtrou) */
export function comboServe(c: Combo, ctx: ContextoIncentivo): boolean {
  return c.escopo !== 'produto' && escopoServe(c.escopo, c.escopo_valor, ctx);
}

/** Avalia todos os combos para o carrinho (sem os itens de brinde, que sao ignorados). */
export function avaliarCombos(
  combos: Combo[],
  itens: ItemPedido[],
  ctx: ContextoIncentivo,
  classificacaoPorProduto: Record<string, Classificacao | undefined> = {},
): ResultadoCombos {
  const linhas = itens
    .filter((i) => !i.brinde)
    .map((i) => ({ produto: i.produto, qtd: lerQuantidade(i.quantidade) ?? 0 }))
    .filter((l) => l.qtd > 0);

  const aplicados: AplicacaoCombo[] = [];
  const incompletos: FaltaCombo[] = [];

  for (const combo of combos) {
    if (!comboServe(combo, ctx) || !combo.itens.length) continue;

    const r = avaliarCondicao(combo.itens, linhas, classificacaoPorProduto);
    if (!r.completo) {
      if (r.algumProgresso) incompletos.push({ combo, faltas: r.faltas });
      continue;
    }
    const vezes = vezesDoCombo(combo, r.razoes);
    const faixa = combo.repete ? null : faixaAtingida(combo.faixas, r.total);
    aplicados.push({ combo, vezes, produtos: [...r.usados], total: r.total, faixa });
  }

  // entre combos completos com a MESMA condicao vale so o de escopo mais especifico (igual ao incentivo)
  const vencedores = semSubstituidos(aplicados, (a) => a.combo);
  aplicados.splice(0, aplicados.length, ...vencedores);

  const brindesPorProduto = new Map<string, BrindeCombo>();
  const descontoPorProduto: ResultadoCombos['descontoPorProduto'] = {};
  for (const a of aplicados) {
    const c = a.combo;
    const { brindeQtd, descontoPct } = beneficioDaFaixa(c, a.faixa);
    if (c.beneficio === 'produto_gratis' && c.brinde_cod_produto && brindeQtd > 0) {
      const q = brindeQtd * a.vezes;
      const atual = brindesPorProduto.get(c.brinde_cod_produto);
      brindesPorProduto.set(c.brinde_cod_produto, atual ? { ...atual, quantidade: atual.quantidade + q } : { produto: c.brinde_cod_produto, quantidade: q, comboId: c.id, comboNome: c.nome });
    } else if (c.beneficio === 'desconto_pct' && descontoPct > 0) {
      registrarDescontoCombo(descontoPorProduto, a.produtos, descontoPct, c.desconto_extra_max_pct);
    }
  }

  return { aplicados, brindes: [...brindesPorProduto.values()], descontoPorProduto, incompletos };
}

/**
 * Sincroniza os itens de brinde do carrinho com o resultado dos combos: remove os brindes antigos e coloca os de agora.
 * O brinde nao tem preco (vai ao SAP com valor zero) nem desconto manual; a unidade e a de venda do produto (padrao KI = caixa).
 */
export function comBrindes(itens: ItemPedido[], brindes: BrindeCombo[], unidadePorProduto: Record<string, string | undefined> = {}): ItemPedido[] {
  const base = itens.filter((i) => !i.brinde);
  const novos: ItemPedido[] = brindes.map((b) => ({
    produto: b.produto,
    unidade: unidadePorProduto[b.produto] ?? 'KI',
    quantidade: formatarQuantidade(b.quantidade),
    preco: null,
    desconto: null,
    descontoManual: null,
    brinde: true,
    comboId: b.comboId,
  }));
  return [...base, ...novos];
}
