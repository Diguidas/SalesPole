// Desconto por incentivo (cadastrado no painel web): a partir de uma quantidade o produto ganha um
// desconto automatico, e o vendedor ainda pode dar um EXTRA ate um teto.
// Mesma regra do servidor (api/src/pedidos/pedido.incentivo.ts): se mudar uma, mude a outra.
//
// A regra tem duas dimensoes:
//   QUEM compra (escopo): geral | cliente | vendedor | canal | escritorio
//   O QUE compra (alvo):  um produto (cod_produto) OU a classificacao do produto (ID da linha, do grupo,
//                         da categoria; marca por texto; varios juntos = todos precisam bater) OU qualquer produto
// Quantidade minima 0 = sem minimo (desconto fixo).
//
// Descontos no item (todos em % sobre o preco de tabela, somados):
//   desconto        = incentivo automatico + desconto do vendedor      (o que vira o preco ZPR2)
//   descontoManual  = parte do vendedor (limite = maximo da lista + extra liberado pelo incentivo)
//   descontoLiberado= teto do desconto TOTAL deste item (lista + incentivo + extra), usado para validar

import { arredondar } from './numero';
import type { ItemPedido } from './pedido';
import { lerQuantidade } from './quantidade';

export interface Incentivo {
  id: string;
  cod_produto: string | null;
  /** geral | produto | cliente | vendedor | canal | escritorio */
  escopo: string;
  escopo_valor: string | null;
  /** alvo por classificacao do produto (ID do cadastro ZSDT130-132; marca = texto); vazio = nao filtra por isso */
  linha_id?: string | null;
  grupo_id?: string | null;
  categoria_id?: string | null;
  marca?: string | null;
  qtd_minima: number;
  desconto_pct: number;
  desconto_extra_max_pct: number;
}

/** Classificacao do produto no cadastro: IDs (usados nas regras) e os textos (so para mostrar). */
export interface Classificacao {
  linha_id?: string | null;
  grupo_id?: string | null;
  categoria_id?: string | null;
  marca?: string | null;
  linha?: string | null;
  grupo?: string | null;
  categoria?: string | null;
}

/** Quem esta comprando: define quais regras do painel valem. */
export interface ContextoIncentivo {
  codCliente: string;
  codVendedor: string;
  /** canais de venda do cliente (KNVV-VTWEG) */
  canais: string[];
  /** escritorios de vendas do cliente (KNVV-VKBUR) */
  escritorios: string[];
}

// quanto mais especifico o escopo, maior o peso (desempate quando a quantidade minima e igual)
const PESO: Record<string, number> = { cliente: 5, vendedor: 4, escritorio: 3, canal: 2, produto: 1, geral: 0 };

const CRITERIOS = ['linha_id', 'grupo_id', 'categoria_id', 'marca'] as const;

/** IDs do SAP podem vir com zeros a esquerda (NUMC): '0003' e '3' sao o mesmo ID. A marca e texto (sem diferenciar caixa). */
const norm = (campo: (typeof CRITERIOS)[number], v: string | null | undefined): string => {
  const t = (v ?? '').trim().toLowerCase();
  return campo === 'marca' ? t : t.replace(/^0+(?=\d)/, '');
};

/** A regra serve para este PRODUTO? (codigo e/ou classificacao; regra sem alvo serve para qualquer produto) */
export function incentivoServeProduto(r: Incentivo, produto: string, cls?: Classificacao | null): boolean {
  if (r.cod_produto && r.cod_produto !== produto) return false;
  return CRITERIOS.every((c) => !norm(c, r[c]) || norm(c, r[c]) === norm(c, cls?.[c]));
}

/** Quao especifico e o alvo da regra: produto especifico > classificacao (quanto mais criterios, mais especifica) > qualquer produto. */
function pesoProduto(r: Incentivo): number {
  if (r.cod_produto) return 10;
  return CRITERIOS.filter((c) => norm(c, r[c])).length;
}

/** A regra serve para este produto e este comprador (sem olhar a quantidade)? */
export function incentivoServe(r: Incentivo, produto: string, ctx: ContextoIncentivo, cls?: Classificacao | null): boolean {
  if (!incentivoServeProduto(r, produto, cls)) return false;
  switch (r.escopo) {
    case 'geral':
    case 'produto':
      return true;
    case 'cliente':
      return r.escopo_valor === ctx.codCliente;
    case 'vendedor':
      return r.escopo_valor === ctx.codVendedor;
    case 'canal':
      return !!r.escopo_valor && ctx.canais.includes(r.escopo_valor);
    case 'escritorio':
      return !!r.escopo_valor && ctx.escritorios.includes(r.escopo_valor);
    default:
      return false;
  }
}

/** Todas as faixas que servem para o produto, da menor para a maior quantidade (a tela mostra a tabela). */
export function faixasDoProduto(rows: Incentivo[], produto: string, ctx: ContextoIncentivo, cls?: Classificacao | null): Incentivo[] {
  return rows.filter((r) => incentivoServe(r, produto, ctx, cls)).sort((a, b) => a.qtd_minima - b.qtd_minima);
}

/** Regra que vale nessa quantidade: maior quantidade minima atingida; empate = escopo mais especifico, depois alvo mais especifico. */
export function incentivoAplicavel(
  rows: Incentivo[],
  produto: string,
  qtd: number,
  ctx: ContextoIncentivo,
  cls?: Classificacao | null,
): Incentivo | null {
  return (
    rows
      .filter((r) => incentivoServe(r, produto, ctx, cls) && r.qtd_minima <= qtd)
      .sort(
        (a, b) =>
          b.qtd_minima - a.qtd_minima || (PESO[b.escopo] ?? 0) - (PESO[a.escopo] ?? 0) || pesoProduto(b) - pesoProduto(a),
      )[0] ?? null
  );
}

/** Maximo que o VENDEDOR pode digitar: o da lista + o extra que o incentivo libera. */
export function maxManual(descontoMaxLista: number, inc: Incentivo | null): number {
  return arredondar(Math.max(0, descontoMaxLista) + (inc ? inc.desconto_extra_max_pct : 0), 2);
}

/** Teto do desconto TOTAL do item: lista + incentivo automatico + extra. */
export function descontoTotalMax(descontoMaxLista: number, inc: Incentivo | null): number {
  return arredondar(maxManual(descontoMaxLista, inc) + (inc ? inc.desconto_pct : 0), 2);
}

/** Desconto automatico que um combo da a cada produto (ver combo.ts): vale o maior entre ele e o incentivo por quantidade. */
export type DescontoCombo = Record<string, { pct: number; extra: number } | undefined>;

/**
 * Recalcula o desconto de cada item para a quantidade ATUAL: incentivo automatico (se atingiu a faixa)
 * + a parte do vendedor, que nunca passa de (maximo da lista + extra do incentivo).
 * Chame sempre que a quantidade de um item mudar e antes de enviar.
 * @param descontoMaxPorProduto desconto maximo da lista de preco por produto (0 = lista sem desconto)
 * @param classificacaoPorProduto linha/grupo/categoria/marca de cada produto (para as regras por classificacao)
 */
export function ajustarDescontos(
  itens: ItemPedido[],
  descontoMaxPorProduto: Record<string, number | undefined>,
  rows: Incentivo[],
  ctx: ContextoIncentivo,
  classificacaoPorProduto: Record<string, Classificacao | undefined> = {},
  descontoCombo: DescontoCombo = {},
): ItemPedido[] {
  return itens.map((i) => {
    if (i.brinde) return i; // brinde de combo: sem desconto, sem incentivo
    const q = lerQuantidade(i.quantidade) ?? 0;
    let inc = incentivoAplicavel(rows, i.produto, q, ctx, classificacaoPorProduto[i.produto]);
    const cb = descontoCombo[i.produto];
    // combo e incentivo no mesmo produto: vale o maior desconto automatico (o extra do vendedor acompanha o que venceu)
    if (cb && cb.pct > 0 && (!inc || cb.pct > inc.desconto_pct)) {
      inc = { id: 'combo', cod_produto: null, escopo: 'geral', escopo_valor: null, qtd_minima: 0, desconto_pct: cb.pct, desconto_extra_max_pct: cb.extra };
    }
    const maxLista = descontoMaxPorProduto[i.produto] ?? 0;
    const auto = inc ? inc.desconto_pct : 0;
    // itens antigos (sem descontoManual): o desconto que existia era do vendedor
    const manualBruto = i.descontoManual ?? i.desconto ?? 0;
    const manual = Math.min(Math.max(0, manualBruto), maxManual(maxLista, inc));
    const total = arredondar(auto + manual, 2);
    return {
      ...i,
      descontoManual: manual > 0 ? manual : null,
      desconto: total > 0 ? total : null,
      descontoLiberado: descontoTotalMax(maxLista, inc),
    };
  });
}
