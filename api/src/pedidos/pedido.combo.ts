// Combos de desconto no servidor (tabelas combos + combo_itens, cadastradas no painel).
// O nucleo do calculo vive em shared/regras/combo.ts e e o MESMO do app (app/src/domain/combo.ts). Resumo:
//  - condicao = itens (produto | marca | linha | grupo | categoria) com quantidade minima em caixas; cada linha do pedido
//    conta para UM item (os de produto pegam primeiro); combo completo = todos atingiram o minimo;
//  - com `repete` vale uma vez para cada vez que a condicao cabe (ate max_repeticoes), senao uma vez so;
//  - cada item aceita VARIOS materiais (alvo_valor com codigos separados por virgula = qualquer um);
//  - `faixas` (combo sem repeticao): o beneficio sobe pelo total de caixas da condicao;
//  - beneficio: brinde (item de preco zero) ou desconto % nos produtos da condicao (vale o maior entre combo e incentivo).
// Aqui o servidor CONFERE o que o app mandou: o brinde precisa caber no que os combos do pedido dao.

import type { ClassificacaoSrv, ContextoIncentivo } from './pedido.incentivo';
import { avaliarCondicao, beneficioDaFaixa, EPS, faixaAtingida, itemCasa, registrarDescontoCombo, semSubstituidos, vezesDoCombo } from './regras/combo';
import type { FaixaCombo } from './regras/combo';
import { escopoServe } from './regras/incentivo';

export { faixaAtingida, itemCasa };
export type { FaixaCombo };

export interface ItemCondicaoRow {
  alvo_tipo: string;
  alvo_valor: string;
  qtd_minima: number | string;
}

export interface ComboRow {
  id: string;
  nome: string;
  escopo: string;
  escopo_valor: string | null;
  beneficio: string;
  brinde_cod_produto: string | null;
  brinde_qtd: number | string | null;
  /** bonificacao do brinde (ORD_REASON e centro de custo, dos cadastros do painel) */
  tipo_bonificacao?: string | null;
  centro_custo?: string | null;
  desconto_pct: number | string | null;
  desconto_extra_max_pct: number | string;
  repete: boolean;
  max_repeticoes: number | null;
  /** degraus do beneficio pelo total de caixas da condicao (so combo sem repeticao) */
  faixas?: FaixaCombo[] | null;
  vigencia_ini: string | null;
  vigencia_fim: string | null;
  ativo: boolean;
  itens: ItemCondicaoRow[];
}

export interface LinhaCombo {
  produto: string;
  quantidade: number;
}

/** Brinde que UM combo do pedido da (vira item da bonificacao automatica). */
export interface BrindeDoCombo {
  comboId: string;
  comboNome: string;
  produto: string;
  quantidade: number;
  tipo_bonificacao: string | null;
  centro_custo: string | null;
}

export interface ResultadoComboSrv {
  /** quantidade de brinde que os combos do pedido dao, por produto */
  brindes: Record<string, number>;
  /** o mesmo, combo a combo (com o tipo e o centro de custo da bonificacao) */
  brindesPorCombo: BrindeDoCombo[];
  /** desconto % automatico e extra do vendedor que o combo da a cada produto */
  descontoPorProduto: Record<string, { pct: number; extra: number }>;
}

export function comboVale(c: ComboRow, ctx: ContextoIncentivo): boolean {
  if (!c.ativo) return false;
  if (c.vigencia_ini && c.vigencia_ini > ctx.hoje) return false;
  if (c.vigencia_fim && c.vigencia_fim < ctx.hoje) return false;
  return c.escopo !== 'produto' && escopoServe(c.escopo, c.escopo_valor, ctx);
}

/** Combos que valem para o pedido (so os itens que NAO sao brinde entram em `linhas`). */
export function avaliarCombosSrv(
  combos: ComboRow[],
  linhasBrutas: LinhaCombo[],
  ctx: ContextoIncentivo,
  classificacaoPorProduto: Record<string, ClassificacaoSrv | undefined>,
): ResultadoComboSrv {
  const linhas = linhasBrutas.filter((l) => l.quantidade > 0);
  const brindes: Record<string, number> = {};
  const brindesPorCombo: BrindeDoCombo[] = [];
  const descontoPorProduto: ResultadoComboSrv['descontoPorProduto'] = {};

  const completos: Array<{ c: ComboRow; vezes: number; usados: Set<string>; totalCondicao: number }> = [];
  for (const c of combos) {
    if (!comboVale(c, ctx) || !c.itens?.length) continue;
    const r = avaliarCondicao(
      c.itens,
      linhas.map((l) => ({ produto: l.produto, qtd: l.quantidade })),
      classificacaoPorProduto,
    );
    if (!r.completo) continue;
    completos.push({ c, vezes: vezesDoCombo(c, r.razoes), usados: r.usados, totalCondicao: r.total });
  }

  for (const { c, vezes, usados, totalCondicao } of semSubstituidos(completos, (x) => x.c)) {
    const faixa = c.repete ? null : faixaAtingida(c.faixas, totalCondicao);
    const { brindeQtd, descontoPct } = beneficioDaFaixa(c, faixa);

    if (c.beneficio === 'produto_gratis' && c.brinde_cod_produto && brindeQtd > 0) {
      brindes[c.brinde_cod_produto] = (brindes[c.brinde_cod_produto] ?? 0) + brindeQtd * vezes;
      brindesPorCombo.push({
        comboId: c.id, comboNome: c.nome, produto: c.brinde_cod_produto, quantidade: brindeQtd * vezes,
        tipo_bonificacao: c.tipo_bonificacao ?? null, centro_custo: c.centro_custo ?? null,
      });
    } else if (c.beneficio === 'desconto_pct' && descontoPct > 0) {
      registrarDescontoCombo(descontoPorProduto, usados, descontoPct, c.desconto_extra_max_pct);
    }
  }
  return { brindes, brindesPorCombo, descontoPorProduto };
}

/**
 * Erros do brinde: cada produto de brinde do pedido precisa caber no que os combos dao (somando as linhas do mesmo
 * produto). Brinde sem combo que o sustente, ou acima do que ele da, e recusado.
 */
export function conferirBrindes(brindesDoPedido: LinhaCombo[], resultado: ResultadoComboSrv): string[] {
  const pedidos = new Map<string, number>();
  for (const b of brindesDoPedido) pedidos.set(b.produto, (pedidos.get(b.produto) ?? 0) + b.quantidade);
  const erros: string[] = [];
  for (const [produto, q] of pedidos) {
    const permitido = resultado.brindes[produto] ?? 0;
    if (q > permitido + EPS) {
      erros.push(
        permitido > 0
          ? `brinde ${produto}: ${q} cx no pedido, mas os combos dao ${permitido} cx. Sincronize para atualizar os combos.`
          : `brinde ${produto}: nenhum combo do pedido da este brinde. Sincronize para atualizar os combos.`,
      );
    }
  }
  return erros;
}
