// Oportunidade de combo: com o que o cliente COSTUMA comprar (media por pedido nos ultimos 12 meses), quais combos
// ele esta perto de fechar? Reaproveita o calculo dos combos do carrinho (avaliarCombos) sobre um "pedido tipico".
// So entra no pedido tipico o historico em caixas (CX/KI); em outra unidade a quantidade nao e comparavel com o combo.

import { avaliarCombos, type Combo, type FaltaCombo, type ResultadoCombos } from './combo';
import type { Classificacao, ContextoIncentivo } from './incentivo';
import type { ItemPedido } from './pedido';
import { formatarQuantidade } from './quantidade';
import type { CompraDoCliente } from './reposicao';

const EM_CAIXA = new Set(['CX', 'KI']);

export function pedidoTipico(compras: CompraDoCliente[]): ItemPedido[] {
  return compras
    .filter((c) => c.pedidos > 0 && c.quantidade > 0 && (!c.unidade || EM_CAIXA.has(c.unidade.trim().toUpperCase())))
    .map((c) => ({
      produto: c.cod_produto,
      unidade: 'KI',
      // caixas inteiras: o "pedido tipico" nao leva meia caixa
      quantidade: formatarQuantidade(Math.max(1, Math.round(c.quantidade / c.pedidos))),
    }));
}

/** O quanto falta em caixas para fechar o combo (soma do que falta em cada item da condicao). */
const totalFalta = (f: FaltaCombo) => f.faltas.reduce((a, x) => a + x.falta, 0);

/**
 * Combos que o cliente quase fecha com o pedido tipico, do que falta menos para o que falta mais.
 * `aplicados` vem vazio de proposito: combo que ele ja fecharia sozinho nao e oportunidade.
 */
export function oportunidadesDeCombo(
  combos: Combo[],
  compras: CompraDoCliente[],
  ctx: ContextoIncentivo,
  classificacaoPorProduto: Record<string, Classificacao | undefined>,
  max = 3,
): ResultadoCombos {
  const r = avaliarCombos(combos, pedidoTipico(compras), ctx, classificacaoPorProduto);
  const aplicados = new Set(r.aplicados.map((a) => a.combo.id));
  const incompletos = r.incompletos
    .filter((f) => !aplicados.has(f.combo.id) && f.faltas.length > 0)
    .sort((a, b) => totalFalta(a) - totalFalta(b))
    .slice(0, max);
  return { aplicados: [], brindes: [], descontoPorProduto: {}, incompletos };
}
