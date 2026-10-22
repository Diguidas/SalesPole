// Sugestoes do "Novo pedido" do painel: reposicao (produtos que passaram do ritmo de compra do cliente) e combos que o
// cliente quase fecha. Mesma ideia do app (app/src/domain/reposicao.ts e oportunidade.ts); a diferenca e que aqui o
// servidor tem as DATAS REAIS dos pedidos, entao o ritmo e (ultima - primeira compra) / (pedidos - 1), mais preciso que
// o "12 meses / pedidos" que o aparelho usa (ele so guarda os totais).

import { comboVale, itemCasa, type ComboRow, type ItemCondicaoRow } from './pedido.combo';
import type { ClassificacaoSrv, ContextoIncentivo } from './pedido.incentivo';

export const FATOR_ATRASO = 1.3;
export const FATOR_ABANDONO = 5;
export const MIN_COMPRAS = 3;

export interface CompraSrv {
  cod_produto: string;
  descricao: string | null;
  /** AAAA-MM-DD */
  primeira_compra: string;
  ultima_compra: string;
  /** pedidos distintos com o produto */
  pedidos: number;
  quantidade: number;
  unidade: string | null;
}

export interface ReposicaoSrv {
  cod_produto: string;
  descricao: string | null;
  intervalo_dias: number;
  dias_desde: number;
  quantidade_tipica: number;
  unidade: string | null;
  atraso: number;
}

export function diasEntre(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** Produtos atrasados: passaram de FATOR_ATRASO x o ritmo e ainda nao de FATOR_ABANDONO x (depois disso e "sem giro"). */
export function reposicaoSrv(compras: CompraSrv[], hoje: string, max = 10): ReposicaoSrv[] {
  const lista: ReposicaoSrv[] = [];
  for (const c of compras) {
    if (c.pedidos < MIN_COMPRAS || !c.ultima_compra) continue;
    const intervalo = Math.max(1, Math.round(diasEntre(c.primeira_compra, c.ultima_compra) / (c.pedidos - 1)));
    const desde = diasEntre(c.ultima_compra, hoje);
    if (desde < intervalo * FATOR_ATRASO || desde > intervalo * FATOR_ABANDONO) continue;
    lista.push({
      cod_produto: c.cod_produto,
      descricao: c.descricao,
      intervalo_dias: intervalo,
      dias_desde: desde,
      quantidade_tipica: c.quantidade > 0 ? c.quantidade / c.pedidos : 0,
      unidade: c.unidade,
      atraso: Math.round((desde / intervalo) * 100) / 100,
    });
  }
  lista.sort((a, b) => b.atraso - a.atraso || a.intervalo_dias - b.intervalo_dias);
  return lista.slice(0, max);
}

const EM_CAIXA = new Set(['CX', 'KI']);

/** Pedido tipico do cliente: media por pedido, em caixas inteiras (so o historico em caixas entra). */
export function pedidoTipicoSrv(compras: CompraSrv[]): Array<{ produto: string; quantidade: number }> {
  return compras
    .filter((c) => c.pedidos > 0 && c.quantidade > 0 && (!c.unidade || EM_CAIXA.has(c.unidade.trim().toUpperCase())))
    .map((c) => ({ produto: c.cod_produto, quantidade: Math.max(1, Math.round(c.quantidade / c.pedidos)) }));
}

export interface ComboParaFechar {
  combo: ComboRow;
  faltas: Array<{ item: ItemCondicaoRow; falta: number }>;
}

/**
 * Combos que valem para o cliente, que o pedido tipico JA comeca a formar e ainda nao fecha, do que falta menos para o
 * que falta mais. (Os que ele ja fecharia sozinho nao sao oportunidade.)
 */
export function combosParaFechar(
  combos: ComboRow[],
  tipico: Array<{ produto: string; quantidade: number }>,
  ctx: ContextoIncentivo,
  classificacaoPorProduto: Record<string, ClassificacaoSrv | undefined>,
  max = 3,
): ComboParaFechar[] {
  const resultado: ComboParaFechar[] = [];
  for (const c of combos) {
    if (!comboVale(c, ctx) || !c.itens?.length) continue;
    const ordem = [...c.itens].sort((a, b) => Number(b.alvo_tipo === 'produto') - Number(a.alvo_tipo === 'produto'));
    const restante = tipico.map((l) => l.quantidade);
    const faltas: ComboParaFechar['faltas'] = [];
    let progresso = false;
    for (const it of ordem) {
      const min = Number(it.qtd_minima);
      let total = 0;
      tipico.forEach((l, n) => {
        if (restante[n] > 0 && itemCasa(it, l.produto, classificacaoPorProduto[l.produto])) {
          total += restante[n];
          restante[n] = 0;
        }
      });
      if (total > 0) progresso = true;
      if (total + 1e-9 < min) faltas.push({ item: it, falta: Math.round((min - total) * 1000) / 1000 });
    }
    if (progresso && faltas.length) resultado.push({ combo: c, faltas });
  }
  const soma = (f: ComboParaFechar) => f.faltas.reduce((a, x) => a + x.falta, 0);
  return resultado.sort((a, b) => soma(a) - soma(b)).slice(0, max);
}
