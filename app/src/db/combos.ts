import type { SQLiteDatabase } from 'expo-sqlite';
import type { Combo, ItemCondicao } from '@/domain/combo';

interface LinhaCombo {
  id: string;
  nome: string;
  escopo: string;
  escopo_valor: string | null;
  beneficio: string;
  brinde_cod_produto: string | null;
  brinde_qtd: number | null;
  desconto_pct: number | null;
  desconto_extra_max_pct: number;
  repete: number;
  max_repeticoes: number | null;
  itens: string;
}

/** Combos do painel que o aparelho tem (vigentes na ultima sincronizacao); o escopo (cliente, canal...) e conferido no calculo. */
export async function carregarCombos(db: SQLiteDatabase): Promise<Combo[]> {
  const rows = await db.getAllAsync<LinhaCombo>('SELECT * FROM combos');
  return rows.map((r) => {
    let itens: ItemCondicao[] = [];
    try {
      itens = (JSON.parse(r.itens) as ItemCondicao[]).map((i) => ({ alvo_tipo: i.alvo_tipo, alvo_valor: i.alvo_valor, qtd_minima: Number(i.qtd_minima) }));
    } catch {
      itens = [];
    }
    return { ...r, repete: r.repete === 1, itens };
  });
}
