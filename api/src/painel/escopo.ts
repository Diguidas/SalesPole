import { ForbiddenException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod } from '../auth/vendedores.service';

/** O que um usuario da hierarquia (supervisor/gerente) enxerga: os vendedores da equipe e as rotas deles. */
export interface Escopo {
  vendedores: string[];
  rotas: string[];
}

/** Papeis que veem apenas a propria equipe (gerente geral ve tudo). */
export const PAPEIS_COM_ESCOPO = ['supervisor', 'gerente', 'vendedor'];

const TTL_MS = 60_000;
const cache = new Map<string, { em: number; escopo: Escopo }>();

/** Limpa o cache (cadastro de usuario ou nova importacao de supervisores). */
export function invalidarEscopo(): void {
  cache.clear();
}

/**
 * Escopo do usuario: null = sem restricao (admin, aprovador, consulta, gerente geral).
 * supervisor: vendedores dos escritorio+equipe dele; gerente: dos escritorio+equipe de todos os supervisores dele.
 * Sem codigo SAP cadastrado ou sem equipe: escopo vazio (nao ve nada), nunca "tudo".
 */
export async function resolverEscopo(sb: SupabaseClient, papel: string, codSap: string | null): Promise<Escopo | null> {
  if (!PAPEIS_COM_ESCOPO.includes(papel)) return null;
  const cod = codSap ? normCod(codSap) : '';
  if (!cod) return { vendedores: [], rotas: [] };

  // vendedor: so a propria carteira (ele mesmo e a rota dele)
  if (papel === 'vendedor') {
    const { data, error } = await sb.from('vendedores').select('rota').eq('cod_vendedor', cod).maybeSingle();
    if (error) throw error;
    const rota = (data as { rota: string | null } | null)?.rota ?? null;
    return { vendedores: [cod], rotas: rota ? [rota] : [] };
  }

  const chave = `${papel}:${cod}`;
  const ac = cache.get(chave);
  if (ac && Date.now() - ac.em < TTL_MS) return ac.escopo;

  const { data: sup, error } = await sb
    .from('supervisores')
    .select('escritorio, equipe')
    .eq(papel === 'supervisor' ? 'cod_supervisor' : 'cod_gerente', cod);
  if (error) throw error;
  const pares = new Set(((sup ?? []) as Array<{ escritorio: string; equipe: string }>).map((s) => `${s.escritorio}|${s.equipe}`));

  let escopo: Escopo = { vendedores: [], rotas: [] };
  if (pares.size) {
    const escritorios = [...new Set([...pares].map((p) => p.split('|')[0]))];
    const { data: ven, error: e2 } = await sb.from('vendedores').select('cod_vendedor, rota, escritorio, equipe').in('escritorio', escritorios);
    if (e2) throw e2;
    const dos = ((ven ?? []) as Array<{ cod_vendedor: string; rota: string | null; escritorio: string; equipe: string }>).filter((v) => pares.has(`${v.escritorio}|${v.equipe}`));
    escopo = {
      vendedores: [...new Set(dos.map((v) => normCod(v.cod_vendedor)))],
      rotas: [...new Set(dos.map((v) => v.rota).filter((r): r is string => !!r))],
    };
  }
  cache.set(chave, { em: Date.now(), escopo });
  return escopo;
}

/** O vendedor esta no escopo? (sem escopo = sim) */
export const vendedorNoEscopo = (escopo: Escopo | null | undefined, cod: string | null | undefined): boolean =>
  !escopo || (!!cod && escopo.vendedores.includes(normCod(String(cod))));

/** A rota esta no escopo? (sem escopo = sim) */
export const rotaNoEscopo = (escopo: Escopo | null | undefined, rota: string | null | undefined): boolean =>
  !escopo || (!!rota && escopo.rotas.includes(rota));

/** Barra o acesso a algo fora da equipe. A mensagem e a mesma de "nao existe" para nao revelar o que ha fora do escopo. */
export function exigirVendedor(escopo: Escopo | null | undefined, cod: string | null | undefined): void {
  if (!vendedorNoEscopo(escopo, cod)) throw new ForbiddenException('Este registro nao pertence a sua equipe');
}
export function exigirRota(escopo: Escopo | null | undefined, rota: string | null | undefined): void {
  if (!rotaNoEscopo(escopo, rota)) throw new ForbiddenException('Este registro nao pertence a sua equipe');
}
