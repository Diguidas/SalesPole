import type { SQLiteDatabase } from 'expo-sqlite';
import type { Combo, FaixaCombo, ItemCondicao } from '@/domain/combo';

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
  faixas: string | null;
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
    let faixas: FaixaCombo[] = [];
    try {
      faixas = (JSON.parse(r.faixas ?? '[]') as FaixaCombo[]).map((f) => ({ qtd_minima: Number(f.qtd_minima), desconto_pct: f.desconto_pct == null ? null : Number(f.desconto_pct), brinde_qtd: f.brinde_qtd == null ? null : Number(f.brinde_qtd) }));
    } catch {
      faixas = [];
    }
    const { faixas: _f, ...resto } = r;
    return { ...resto, repete: r.repete === 1, itens, faixas };
  });
}
