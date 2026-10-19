import type { SQLiteDatabase } from 'expo-sqlite';

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export interface FeriadosDoCliente {
  /** datas (AAAA-MM-DD) em que nao ha entrega para o cliente */
  datas: Set<string>;
  /** data -> descricao (para avisar "feriado: Finados") */
  descricao: Map<string, string>;
}

/** Feriados que valem para o cliente: nacionais + do estado + da cidade dele (cadastro do painel). */
export async function feriadosDoCliente(
  db: SQLiteDatabase,
  endereco: { uf?: string; cidade?: string } | null | undefined,
): Promise<FeriadosDoCliente> {
  const rows = await db.getAllAsync<{ data: string; descricao: string | null; uf: string | null; cidade: string | null }>(
    'SELECT data, descricao, uf, cidade FROM feriados ORDER BY data',
  );
  const uf = (endereco?.uf ?? '').trim().toUpperCase();
  const cidade = semAcento(endereco?.cidade ?? '');
  const datas = new Set<string>();
  const descricao = new Map<string, string>();
  for (const r of rows) {
    if (r.uf) {
      if (r.uf.trim().toUpperCase() !== uf) continue;
      if (r.cidade && semAcento(r.cidade) !== cidade) continue;
    }
    datas.add(r.data);
    if (r.descricao && !descricao.has(r.data)) descricao.set(r.data, r.descricao);
  }
  return { datas, descricao };
}
