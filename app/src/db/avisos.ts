import type { SQLiteDatabase } from 'expo-sqlite';

// Avisos do painel: o servidor entrega os vigentes do vendedor; aqui o app confere escritorio/canal pelos clientes dele
// e esconde os que ele ja leu (um aviso editado no painel volta a aparecer, porque o `atualizado_em` muda).

export interface Aviso {
  id: string;
  titulo: string;
  mensagem: string;
  /** info | importante | urgente */
  nivel: string;
  escopo: string;
  escopo_valor: string | null;
  vigencia_ini: string | null;
  vigencia_fim: string | null;
  atualizado_em: string | null;
}

const NIVEL: Record<string, number> = { urgente: 0, importante: 1, info: 2 };

/** Avisos ainda nao lidos, os mais urgentes primeiro. `hoje` = AAAA-MM-DD do aparelho. */
export async function avisosNaoLidos(db: SQLiteDatabase, hoje: string): Promise<Aviso[]> {
  const todos = await db.getAllAsync<Aviso>(
    `SELECT a.* FROM avisos a
      WHERE NOT EXISTS (SELECT 1 FROM avisos_lidos l WHERE l.id = a.id AND COALESCE(l.atualizado_em, '') = COALESCE(a.atualizado_em, ''))
        AND (a.vigencia_ini IS NULL OR a.vigencia_ini <= ?) AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= ?)`,
    hoje, hoje,
  );
  if (!todos.length) return [];

  let escritorios = new Set<string>();
  let canais = new Set<string>();
  if (todos.some((a) => a.escopo === 'escritorio' || a.escopo === 'canal')) {
    const lin = await db.getAllAsync<{ tipo: string; codigo: string | null }>(
      `SELECT DISTINCT 'e' AS tipo, json_extract(a.value, '$.escritorio.codigo') AS codigo FROM clientes c, json_each(c.areas) a
       UNION SELECT DISTINCT 'c', json_extract(a.value, '$.canal.codigo') FROM clientes c, json_each(c.areas) a`,
    );
    escritorios = new Set(lin.filter((l) => l.tipo === 'e' && l.codigo).map((l) => l.codigo!));
    canais = new Set(lin.filter((l) => l.tipo === 'c' && l.codigo).map((l) => l.codigo!));
  }

  return todos
    .filter((a) => {
      if (a.escopo === 'geral' || a.escopo === 'vendedor') return true; // vendedor: o servidor ja filtrou
      const valores = (a.escopo_valor ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      if (a.escopo === 'escritorio') return valores.some((v) => escritorios.has(v));
      if (a.escopo === 'canal') return valores.some((v) => canais.has(v));
      return false;
    })
    .sort((x, y) => (NIVEL[x.nivel] ?? 2) - (NIVEL[y.nivel] ?? 2) || (y.atualizado_em ?? '').localeCompare(x.atualizado_em ?? ''));
}

export async function marcarAvisoLido(db: SQLiteDatabase, a: Pick<Aviso, 'id' | 'atualizado_em'>): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO avisos_lidos (id, atualizado_em, lido_em) VALUES (?, ?, ?)',
    a.id, a.atualizado_em, new Date().toISOString(),
  );
}
