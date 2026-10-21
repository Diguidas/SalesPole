// Combos de desconto no servidor (tabelas combos + combo_itens, cadastradas no painel).
// Mesma regra do app (app/src/domain/combo.ts): se mudar uma, mude a outra. Resumo:
//  - condicao = itens (produto | marca | linha | grupo | categoria) com quantidade minima em caixas; cada linha do pedido
//    conta para UM item (os de produto pegam primeiro); combo completo = todos atingiram o minimo;
//  - com `repete` vale uma vez para cada vez que a condicao cabe (ate max_repeticoes), senao uma vez so;
//  - beneficio: brinde (item de preco zero) ou desconto % nos produtos da condicao (vale o maior entre combo e incentivo).
// Aqui o servidor CONFERE o que o app mandou: o brinde precisa caber no que os combos do pedido dao.

import type { ClassificacaoSrv, ContextoIncentivo } from './pedido.incentivo';

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

const norm = (tipo: string, v: string | null | undefined): string => {
  const t = (v ?? '').trim().toLowerCase();
  return tipo === 'marca' || tipo === 'produto' ? t : t.replace(/^0+(?=\d)/, '');
};

const lista = (v: string | null) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

function comboVale(c: ComboRow, ctx: ContextoIncentivo): boolean {
  if (!c.ativo) return false;
  if (c.vigencia_ini && c.vigencia_ini > ctx.hoje) return false;
  if (c.vigencia_fim && c.vigencia_fim < ctx.hoje) return false;
  switch (c.escopo) {
    case 'geral':
      return true;
    case 'cliente':
      return lista(c.escopo_valor).includes(ctx.codCliente);
    case 'vendedor':
      return lista(c.escopo_valor).includes(ctx.codVendedor);
    case 'canal':
      return lista(c.escopo_valor).some((x) => ctx.canais.includes(x));
    case 'escritorio':
      return lista(c.escopo_valor).some((x) => ctx.escritorios.includes(x));
    default:
      return false;
  }
}

function itemCasa(it: ItemCondicaoRow, produto: string, cls?: ClassificacaoSrv | null): boolean {
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

  for (const c of combos) {
    if (!comboVale(c, ctx) || !c.itens?.length) continue;
    const ordem = [...c.itens].sort((a, b) => Number(b.alvo_tipo === 'produto') - Number(a.alvo_tipo === 'produto'));
    const restante = linhas.map((l) => l.quantidade);
    const usados = new Set<string>();
    const razoes: number[] = [];

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
      razoes.push(min > 0 ? Math.floor(total / min + EPS) : 0);
    }
    if (!razoes.every((r) => r >= 1)) continue;

    const limite = c.max_repeticoes && c.max_repeticoes > 0 ? c.max_repeticoes : Infinity;
    const vezes = c.repete ? Math.min(Math.min(...razoes), limite) : 1;

    if (c.beneficio === 'produto_gratis' && c.brinde_cod_produto && Number(c.brinde_qtd) > 0) {
      brindes[c.brinde_cod_produto] = (brindes[c.brinde_cod_produto] ?? 0) + Number(c.brinde_qtd) * vezes;
      brindesPorCombo.push({
        comboId: c.id, comboNome: c.nome, produto: c.brinde_cod_produto, quantidade: Number(c.brinde_qtd) * vezes,
        tipo_bonificacao: c.tipo_bonificacao ?? null, centro_custo: c.centro_custo ?? null,
      });
    } else if (c.beneficio === 'desconto_pct' && Number(c.desconto_pct) > 0) {
      const pct = Number(c.desconto_pct);
      const extra = Number(c.desconto_extra_max_pct) || 0;
      for (const p of usados) {
        const atual = descontoPorProduto[p];
        if (!atual || pct > atual.pct || (pct === atual.pct && extra > atual.extra)) descontoPorProduto[p] = { pct, extra };
      }
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
