export const NOME_DIA: Record<number, string> = {
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado',
  7: 'Domingo',
};

export const NOME_DIA_CURTO: Record<number, string> = {
  1: 'Seg',
  2: 'Ter',
  3: 'Qua',
  4: 'Qui',
  5: 'Sex',
  6: 'Sáb',
  7: 'Dom',
};

/** Dia da semana de hoje no padrao do SAP/API: 1 = segunda ... 7 = domingo. */
export function diaSemanaHoje(): number {
  const d = new Date().getDay(); // 0 = domingo
  return d === 0 ? 7 : d;
}

const dois = (n: number) => String(n).padStart(2, '0');

/** Data local de hoje, AAAA-MM-DD (nao UTC: vendedor em horario de Brasilia nao pode "virar o dia" as 21h). */
export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

export function moeda(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** '2026-10-05' (ou ISO completo) -> '05/10/2026' */
export function dataBR(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** 'ha 5 min', 'ha 2 h', 'ontem'... a partir de um ISO. */
export function haQuanto(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
}

/** CNPJ (14) ou CPF (11) com mascara; qualquer outro formato volta como veio. */
export function documento(v: string | null | undefined): string {
  const n = (v ?? '').replace(/\D/g, '');
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return v ?? '';
}

/** '2026-10-05' -> 'seg, 05/10/2026' */
export function dataComDia(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(a, m - 1, d);
  const semana = dt.getDay() === 0 ? 7 : dt.getDay();
  return `${NOME_DIA_CURTO[semana].toLowerCase()}, ${dataBR(iso)}`;
}

/** Numero no padrao brasileiro, ate 3 casas (quantidades). */
export function numero(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}
