import type { SQLiteDatabase } from 'expo-sqlite';
import { ajustarDescontos } from '@/domain/incentivo';
import { adicionarItem, definirDesconto, definirQuantidade, type ItemPedido } from '@/domain/pedido';
import { formatarQuantidade } from '@/domain/quantidade';
import type { ProdutoCatalogo } from './catalogo';
import { classificacaoPorProduto, descontoMaxPorProduto, type DadosIncentivo } from './incentivos';
import { salvarItens } from './pedidos';

/**
 * Coloca um produto no carrinho (o pedido em rascunho) e recalcula os descontos de TODOS os itens
 * para as quantidades atuais (incentivo por quantidade + parte do vendedor).
 *  - 'somar':   soma a quantidade ao que ja esta no carrinho (adicionar pela lista / sugestao)
 *  - 'definir': a quantidade passa a ser exatamente `quantidade` (tela de info do produto)
 */
export async function colocarNoCarrinho(
  db: SQLiteDatabase,
  pedidoId: string,
  itensAtuais: ItemPedido[],
  p: ProdutoCatalogo,
  quantidade: number,
  descontoManual: number,
  modo: 'somar' | 'definir',
  infoDoCarrinho: Record<string, ProdutoCatalogo | undefined>,
  incentivos: DadosIncentivo | null,
): Promise<ItemPedido[]> {
  const existe = itensAtuais.some((i) => i.produto === p.cod_produto && i.unidade === p.unidade);
  const manual = descontoManual > 0 ? descontoManual : null;

  let novos: ItemPedido[];
  if (modo === 'definir' && existe) {
    novos = definirDesconto(definirQuantidade(itensAtuais, p.cod_produto, p.unidade, quantidade), p.cod_produto, p.unidade, descontoManual);
  } else {
    novos = adicionarItem(itensAtuais, {
      produto: p.cod_produto,
      unidade: p.unidade,
      quantidade: formatarQuantidade(quantidade),
      desconto: manual,
      descontoManual: manual,
    });
  }

  const ajustados = incentivos
    ? ajustarDescontos(
        novos,
        descontoMaxPorProduto({ ...infoDoCarrinho, [p.cod_produto]: p }),
        incentivos.rows,
        incentivos.ctx,
        classificacaoPorProduto({ ...infoDoCarrinho, [p.cod_produto]: p }),
      )
    : novos;
  await salvarItens(db, pedidoId, ajustados);
  return ajustados;
}
