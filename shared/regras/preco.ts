// Nucleo de preco comum ao app (app/src/domain/preco.ts) e a API (api/src/pedidos/pedido.preco.ts). FONTE UNICA:
// edite so aqui (shared/) e rode `npm run shared` na pasta do app ou da API para copiar.

export interface VigenciaPreco {
  kbetr: number | null;
  datab: string; // inicio da vigencia AAAA-MM-DD
  datbi: string; // fim da vigencia
}

/** Vigencia que comecou mais recentemente entre as que valem hoje e tem preco. */
export function vigenteHoje<T extends VigenciaPreco>(linhas: T[], hoje: string): T | null {
  return (
    linhas
      .filter((l) => l.datab <= hoje && l.datbi >= hoje && l.kbetr !== null && l.kbetr > 0)
      .sort((a, b) => b.datab.localeCompare(a.datab))[0] ?? null
  );
}

/** Prioridade definida pelo negocio: lista+grupo (A912) vale antes de lista (A913). */
export function escolherVigente<T extends VigenciaPreco>(grupos: T[], listas: T[], hoje: string): T | null {
  return vigenteHoje(grupos, hoje) ?? vigenteHoje(listas, hoje);
}

/** Quantas unidades-base tem 1 `unidade` (1 CX = 10 KG -> 10). null = sem conversao. `fator` busca a conversao cadastrada. */
export function fatorDaUnidade(
  unidade: string | null | undefined,
  base: string | null | undefined,
  fator: (unidade: string) => number | null | undefined,
): number | null {
  if (!unidade) return null;
  if (base && unidade === base) return 1;
  const f = fator(unidade);
  return f && f > 0 ? f : null;
}
