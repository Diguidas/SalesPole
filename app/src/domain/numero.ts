/**
 * Arredonda para `casas` casas DECIMAIS, metade para cima, sem o erro do ponto flutuante.
 * Math.round(76.585 * 100) / 100 da 76.58 (porque 76.585 * 100 = 7658.4999...), e o preco que vai
 * ao SAP sairia um centavo errado. Deslocar a virgula pelo expoente do texto ("76.585e2" = 7658.5) evita isso.
 */
export function arredondar(valor: number, casas: number): number {
  if (!Number.isFinite(valor)) return valor;
  const deslocado = Number(`${valor}e${casas}`);
  if (Number.isNaN(deslocado)) {
    // valor ja em notacao cientifica (ex.: 1e-7): cai no metodo simples
    const f = 10 ** casas;
    return Math.round(valor * f) / f;
  }
  return Number(`${Math.round(deslocado)}e-${casas}`);
}
