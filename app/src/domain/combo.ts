// Combos de desconto (cadastrados no painel, tela Desconto): o pedido precisa ter certos itens (a CONDICAO) para o
// cliente ganhar um BENEFICIO: um produto de brinde (item de preco zero) ou um desconto % nos itens da condicao.
// Mesma regra do servidor (api/src/pedidos/pedido.combo.ts): se mudar uma, mude a outra.
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
import type { ItemPedido } from './pedido';
import { formatarQuantidade, lerQuantidade } from './quantidade';

export type AlvoTipo = 'produto' | 'marca' | 'linha' | 'grupo' | 'categoria';

export interface ItemCondicao {
  alvo_tipo: AlvoTipo | string;
  alvo_valor: string;
  qtd_minima: number;
}

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
  itens: ItemCondicao[];
}

export interface AplicacaoCombo {
  combo: Combo;
  /** quantas vezes a condicao se completou (e o beneficio se repete) */
  vezes: number;
  /** produtos do pedido que formaram a condicao */
  produtos: string[];
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

const norm = (tipo: string, v: string | null | undefined): string => {
  const t = (v ?? '').trim().toLowerCase();
  // IDs do SAP (NUMC) podem vir com zeros a esquerda; a marca e texto
  return tipo === 'marca' || tipo === 'produto' ? t : t.replace(/^0+(?=\d)/, '');
};

/** O combo vale para quem esta comprando? (so o escopo; a vigencia o servidor ja filtrou) */
export function comboServe(c: Combo, ctx: ContextoIncentivo): boolean {
  switch (c.escopo) {
    case 'geral':
      return true;
    case 'cliente':
      return (c.escopo_valor ?? '').split(',').includes(ctx.codCliente);
    case 'vendedor':
      return (c.escopo_valor ?? '').split(',').includes(ctx.codVendedor);
    case 'canal':
      return (c.escopo_valor ?? '').split(',').some((x) => ctx.canais.includes(x.trim()));
    case 'escritorio':
      return (c.escopo_valor ?? '').split(',').some((x) => ctx.escritorios.includes(x.trim()));
    default:
      return false;
  }
}

/** O produto casa com este item da condicao? */
export function itemCasa(it: ItemCondicao, produto: string, cls?: Classificacao | null): boolean {
  const alvo = norm(it.alvo_tipo, it.alvo_valor);
  if (!alvo) return false;
  switch (it.alvo_tipo) {
    case 'produto':
      return norm('produto', produto) === alvo;
    case 'marca':
      return norm('marca', cls?.marca) === alvo;
    case 'linha':
      return norm('linha', cls?.linha_id) === alvo;
    case 'grupo':
      return norm('grupo', cls?.grupo_id) === alvo;
    case 'categoria':
      return norm('categoria', cls?.categoria_id) === alvo;
    default:
      return false;
  }
}

const EPS = 1e-9;

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

    // itens por produto pegam primeiro; os demais mantem a ordem do cadastro
    const ordem = [...combo.itens].sort((a, b) => Number(b.alvo_tipo === 'produto') - Number(a.alvo_tipo === 'produto'));
    const restante = linhas.map((l) => l.qtd);
    const usados = new Set<string>();
    const razoes: number[] = [];
    const faltas: FaltaCombo['faltas'] = [];
    let algumProgresso = false;

    for (const it of ordem) {
      const min = Number(it.qtd_minima);
      let total = 0;
      linhas.forEach((l, n) => {
        if (restante[n] > 0 && itemCasa(it, l.produto, classificacaoPorProduto[l.produto])) {
          total += restante[n];
          restante[n] = 0;
          usados.add(l.produto);
        }
      });
      if (total > 0) algumProgresso = true;
      razoes.push(min > 0 ? Math.floor(total / min + EPS) : 0);
      if (total + EPS < min) faltas.push({ item: it, falta: Math.round((min - total) * 1000) / 1000 });
    }

    const completo = razoes.every((r) => r >= 1);
    if (!completo) {
      if (algumProgresso) incompletos.push({ combo, faltas });
      continue;
    }
    const limite = combo.max_repeticoes && combo.max_repeticoes > 0 ? combo.max_repeticoes : Infinity;
    const vezes = combo.repete ? Math.min(Math.min(...razoes), limite) : 1;
    aplicados.push({ combo, vezes, produtos: [...usados] });
  }

  const brindesPorProduto = new Map<string, BrindeCombo>();
  const descontoPorProduto: ResultadoCombos['descontoPorProduto'] = {};
  for (const a of aplicados) {
    const c = a.combo;
    if (c.beneficio === 'produto_gratis' && c.brinde_cod_produto && (c.brinde_qtd ?? 0) > 0) {
      const q = Number(c.brinde_qtd) * a.vezes;
      const atual = brindesPorProduto.get(c.brinde_cod_produto);
      brindesPorProduto.set(c.brinde_cod_produto, atual ? { ...atual, quantidade: atual.quantidade + q } : { produto: c.brinde_cod_produto, quantidade: q, comboId: c.id, comboNome: c.nome });
    } else if (c.beneficio === 'desconto_pct' && (c.desconto_pct ?? 0) > 0) {
      for (const p of a.produtos) {
        const atual = descontoPorProduto[p];
        const pct = Number(c.desconto_pct);
        const extra = Number(c.desconto_extra_max_pct) || 0;
        if (!atual || pct > atual.pct || (pct === atual.pct && extra > atual.extra)) descontoPorProduto[p] = { pct, extra };
      }
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
