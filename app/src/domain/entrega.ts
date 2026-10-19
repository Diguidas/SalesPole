// Data de entrega: primeiro dia de entrega do cliente que respeite
//  * o PRAZO DE PRODUCAO do pedido (o maior prazo, em dias, entre os itens: 1 ou 2), contado a partir de hoje;
//  * o CORTE: pedido feito depois das 17h conta como pedido do dia seguinte;
//  * os FERIADOS: a entrega nunca cai em feriado (nacional, do estado ou da cidade do cliente).
// Mesma regra do servidor (api/src/pedidos/pedido.entrega.ts) e do SAP (SALESPOLE_CRIAR_PEDIDO);
// o SAP e quem decide de verdade e devolve a data usada.

const dois = (n: number) => String(n).padStart(2, '0');
export const isoLocal = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;

/** Hora de corte (0-23): pedido feito a partir dela conta como do dia seguinte. Igual a HORA_CORTE_PEDIDO da API. */
export const HORA_CORTE = 17;

interface Busca {
  data: string | null;
  feriadosPulados: string[];
}

/** Procura o 1o dia de entrega a partir de base + prazo, pulando feriados. `base` e a data comercial da compra. */
function procurar(diasEntrega: number[], base: Date, prazoDias: number, feriados: ReadonlySet<string>): Busca {
  const dias = new Set(diasEntrega.length ? diasEntrega : [1, 2, 3, 4, 5, 6]);
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + Math.max(1, Math.floor(prazoDias)) - 1);
  const pulados: string[] = [];
  for (let i = 0; i < 30; i++) {
    d.setDate(d.getDate() + 1);
    const semana = d.getDay() === 0 ? 7 : d.getDay();
    if (!dias.has(semana)) continue;
    const iso = isoLocal(d);
    if (feriados.has(iso)) {
      pulados.push(iso);
      continue;
    }
    return { data: iso, feriadosPulados: pulados };
  }
  return { data: null, feriadosPulados: pulados };
}

/**
 * @param diasEntrega dias da semana de entrega do cliente (1=seg ... 7=dom). Vazio = segunda a sabado.
 * @param base data da compra (padrao: agora).
 * @param prazoDias prazo minimo de producao (>= 1): a entrega nunca cai antes de base + prazoDias.
 *   Ex.: prazo 2, compra na segunda, cliente entrega terca e quinta -> quinta.
 * @param feriados datas (AAAA-MM-DD) em que nao ha entrega
 */
export function proximaEntrega(
  diasEntrega: number[],
  base: Date = new Date(),
  prazoDias = 1,
  feriados: ReadonlySet<string> = new Set(),
): string | null {
  return procurar(diasEntrega, base, prazoDias, feriados).data;
}

export interface PrevisaoEntrega {
  /** AAAA-MM-DD (null = nao achou nos proximos 30 dias) */
  data: string | null;
  /** o pedido esta sendo feito depois do corte: conta como pedido de amanha */
  aposCorte: boolean;
  /** feriados que cairiam em dia de entrega e foram pulados (para avisar o vendedor) */
  feriadosPulados: string[];
}

/** Previsao completa: corte das 17h + prazo de producao + feriados. `agora` e a hora do aparelho (horario de Brasilia). */
export function previsaoEntrega(
  diasEntrega: number[],
  agora: Date = new Date(),
  prazoDias = 1,
  feriados: ReadonlySet<string> = new Set(),
  horaCorte = HORA_CORTE,
): PrevisaoEntrega {
  const aposCorte = agora.getHours() >= horaCorte;
  const base = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + (aposCorte ? 1 : 0));
  return { ...procurar(diasEntrega, base, prazoDias, feriados), aposCorte };
}

/** Prazo de producao (dias) do cadastro do produto (estoque.prazoentregadias). Ausente ou invalido = 1. */
export function prazoProducao(v: unknown): number {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
