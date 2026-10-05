// Quantidades: texto digitado pelo vendedor -> numero valido; minimo e multiplo do produto.
import { fatorBase, type Conversoes } from './preco';
import { arredondar } from './numero';

export interface RegraQuantidade {
  minimo: number | null;
  multiplo: number | null;
}

/** "10", "10,5", "10.500" -> numero (ate 3 casas). Invalido/zero/negativo -> null. */
export function lerQuantidade(texto: string): number | null {
  const s = texto.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 1_000_000 ? n : null;
}

/** Forma canonica enviada a API ("10", "10.5"): sem zeros a direita. */
export function formatarQuantidade(n: number): string {
  return String(arredondar(n, 3));
}

const numero = (v: unknown): number | null => {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Le minimo/multiplo do campo `dados.pedido` do produto (0 ou vazio = sem regra). */
export function lerRegra(dados: { pedido?: { quantidademinima?: unknown; multiplo?: unknown } } | null | undefined): RegraQuantidade {
  return { minimo: numero(dados?.pedido?.quantidademinima), multiplo: numero(dados?.pedido?.multiplo) };
}

/**
 * Minimo/multiplo do cadastro estao na unidade BASE (ex.: "12 KG" = o peso da caixa). Converte para a
 * unidade do pedido: 1 caixa = 12 KG vira multiplo 1. Resultado menor que 0,001 vira "sem regra".
 */
export function regraNaUnidade(regra: RegraQuantidade, unidade: string, c: Conversoes): RegraQuantidade {
  const f = fatorBase(unidade, c);
  if (!f || f === 1) return regra;
  const converter = (v: number | null) => {
    if (v === null) return null;
    const r = arredondar(v / f, 3);
    return r > 0 ? r : null;
  };
  return { minimo: converter(regra.minimo), multiplo: converter(regra.multiplo) };
}

/** Mensagem de erro ou null se a quantidade respeita as regras do produto. */
export function validarQuantidade(qtd: number, regra: RegraQuantidade): string | null {
  if (!(qtd > 0)) return 'A quantidade deve ser maior que zero.';
  if (regra.minimo !== null && qtd < regra.minimo) return `Quantidade mínima: ${formatarQuantidade(regra.minimo)}.`;
  if (regra.multiplo !== null) {
    const vezes = qtd / regra.multiplo;
    if (Math.abs(vezes - Math.round(vezes)) > 1e-9) return `A quantidade deve ser múltipla de ${formatarQuantidade(regra.multiplo)}.`;
  }
  return null;
}
