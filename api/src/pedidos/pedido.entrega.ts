// Regras de DATA DE ENTREGA que o servidor decide e manda ao SAP (o SAP escolhe o dia pela grade ZSDT111):
//  * corte: pedido feito DEPOIS da hora de corte (17h, horario de Sao Paulo) conta como pedido do dia seguinte;
//  * feriados: a entrega nunca cai em feriado (nacional, do estado ou da cidade do cliente).
// Mesma regra do app (app/src/domain/entrega.ts).

/** Hora de corte (0-23, horario de Sao Paulo). Configuravel por HORA_CORTE_PEDIDO; padrao 17. */
export function horaDeCorte(): number {
  const n = Number(process.env.HORA_CORTE_PEDIDO);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 17;
}

/** Hora (0-23) em Sao Paulo de um instante ISO. */
export function horaSP(iso: string): number {
  const h = new Date(iso).toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false });
  return Number(h) % 24;
}

/** O pedido foi feito depois da hora de corte? */
export function aposCorte(criadoEmIso: string, hora = horaDeCorte()): boolean {
  return horaSP(criadoEmIso) >= hora;
}

export interface FeriadoRow {
  data: string; // AAAA-MM-DD
  uf: string | null;
  cidade: string | null;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Datas de feriado que valem para um cliente (nacional + estado + cidade dele). */
export function feriadosDoLocal(rows: FeriadoRow[], uf: string | null | undefined, cidade: string | null | undefined): string[] {
  const u = (uf ?? '').trim().toUpperCase();
  const c = semAcento(cidade ?? '');
  const datas = rows
    .filter((r) => {
      if (!r.uf) return true; // nacional
      if (r.uf.trim().toUpperCase() !== u) return false;
      return !r.cidade || semAcento(r.cidade) === c;
    })
    .map((r) => r.data);
  return [...new Set(datas)].sort();
}
