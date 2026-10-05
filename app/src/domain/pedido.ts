import { formatarQuantidade, lerQuantidade } from './quantidade';
import { arredondar } from './numero';

/** Item do pedido: o que a API recebe. */
export interface ItemPedido {
  produto: string;
  unidade: string; // CODIGO da unidade (ex.: KI = caixa)
  quantidade: string; // canonica ("10", "10.5")
  /**
   * Preco POR CAIXA que entra no SAP como ZPR2 (como no app oficial). Preenchido na hora de enviar,
   * a partir do preco de tabela. Sem preco conhecido fica vazio e o SAP aplica a lista (ZPRL).
   * Mais tarde e aqui que entra o desconto: preco = tabela x (1 - desconto).
   */
  preco?: string | null;
  /** desconto em % dado pelo vendedor sobre o preco de tabela (limitado ao maximo da lista); ausente = sem desconto */
  desconto?: number | null;
}

const mesmo = (i: ItemPedido, produto: string, unidade: string) => i.produto === produto && i.unidade === unidade;

/** Adiciona um item; se o produto (na mesma unidade) ja esta no pedido, SOMA a quantidade. */
export function adicionarItem(itens: ItemPedido[], novo: ItemPedido): ItemPedido[] {
  const existente = itens.find((i) => mesmo(i, novo.produto, novo.unidade));
  if (!existente) return [...itens, novo];
  const soma = (lerQuantidade(existente.quantidade) ?? 0) + (lerQuantidade(novo.quantidade) ?? 0);
  return itens.map((i) => (i === existente ? { ...i, quantidade: formatarQuantidade(soma), ...(novo.desconto ? { desconto: novo.desconto } : {}) } : i));
}

export function definirQuantidade(itens: ItemPedido[], produto: string, unidade: string, quantidade: number): ItemPedido[] {
  return itens.map((i) => (mesmo(i, produto, unidade) ? { ...i, quantidade: formatarQuantidade(quantidade) } : i));
}

export function definirDesconto(itens: ItemPedido[], produto: string, unidade: string, desconto: number): ItemPedido[] {
  return itens.map((i) => (mesmo(i, produto, unidade) ? { ...i, desconto: desconto > 0 ? desconto : null } : i));
}

export function removerItem(itens: ItemPedido[], produto: string, unidade: string): ItemPedido[] {
  return itens.filter((i) => !mesmo(i, produto, unidade));
}

export interface PrecoRef {
  valor: number;
  unidade: string | null;
  descontoMax?: number;
}

/** "5", "5,5", "5.25" -> % (0 a 100, ate 2 casas). Vazio = 0. Invalido -> null. */
export function lerDesconto(texto: string): number | null {
  const s = texto.trim().replace(',', '.');
  if (s === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : null;
}

/** Mensagem de erro ou null se o desconto cabe no maximo da lista (0 e sempre valido). */
export function validarDesconto(desconto: number, max: number | undefined): string | null {
  if (!(desconto > 0)) return null;
  if (!max || max <= 0) return 'Esta lista de preço não permite desconto.';
  if (desconto > max) return `Desconto máximo: ${arredondar(max, 2)}%.`;
  return null;
}

/** Preco com o desconto aplicado (2 casas). */
export function aplicarDesconto(valor: number, desconto: number | null | undefined): number {
  return arredondar(valor * (1 - (desconto && desconto > 0 ? desconto : 0) / 100), 2);
}

/**
 * Preco por unidade do pedido para enviar como ZPR2, com 2 casas ("90.93"). So existe quando o preco
 * esta NA unidade do pedido: um preco por KG que nao deu para converter nao pode ser mandado como se
 * fosse por caixa (viraria um pedido com valor errado). Nesse caso devolve null e o SAP aplica a lista.
 */
export function precoParaEnvio(preco: PrecoRef | undefined, unidade: string, desconto?: number | null): string | null {
  if (!preco || preco.unidade !== unidade || !(preco.valor > 0)) return null;
  // defesa: nunca passa do maximo da lista, mesmo que o rascunho tenha um valor antigo
  const d = desconto && desconto > 0 && validarDesconto(desconto, preco.descontoMax) === null ? desconto : 0;
  return aplicarDesconto(preco.valor, d).toFixed(2);
}

/** Preco por unidade do item ja com o desconto (o mesmo que vai no ZPR2). */
export function precoUnitarioFinal(preco: PrecoRef, item: ItemPedido): number {
  const d = item.desconto && item.desconto > 0 && validarDesconto(item.desconto, preco.descontoMax) === null ? item.desconto : 0;
  return aplicarDesconto(preco.valor, d);
}

/**
 * Total ESTIMADO com o preco de tabela (e o desconto do item). So conta o item quando a unidade do preco e a
 * unidade de venda (senao faltaria a conversao, que o app nao tem); esses entram em `semEstimativa`.
 * O valor real quem calcula e o SAP.
 */
export function estimarTotal(itens: ItemPedido[], precos: Record<string, PrecoRef | undefined>): { total: number; semEstimativa: number } {
  let total = 0;
  let semEstimativa = 0;
  for (const i of itens) {
    const p = precos[i.produto];
    const q = lerQuantidade(i.quantidade);
    if (p && q !== null && p.unidade === i.unidade) total += precoUnitarioFinal(p, i) * q;
    else semEstimativa++;
  }
  return { total: arredondar(total, 2), semEstimativa };
}
