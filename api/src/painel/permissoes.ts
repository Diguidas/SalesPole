import { PapelPainel } from './painel.guard';

/** Acoes que o admin liga/desliga por usuario. O admin tem todas, sempre. */
export const PERMISSOES = [
  { chave: 'aprovar_bonificacao', rotulo: 'Aprovar ou rejeitar bonificações', descricao: 'Decide as bonificações aguardando aprovação.' },
  { chave: 'validar_visita', rotulo: 'Validar visitas e fotos', descricao: 'Valida ou recusa a visita do vendedor.' },
  { chave: 'criar_pedido', rotulo: 'Criar pedido pelo vendedor', descricao: 'Novo pedido em nome de um vendedor.' },
  { chave: 'cancelar_pedido', rotulo: 'Cancelar pedidos no SAP', descricao: 'Cancela ordens nos status liberados.' },
  { chave: 'comunicados', rotulo: 'Criar comunicados (avisos para vendedores)', descricao: 'Cria e edita avisos; supervisor e gerente só para os vendedores da equipe.' },
] as const;

export type Permissao = (typeof PERMISSOES)[number]['chave'];
const CHAVES: string[] = PERMISSOES.map((p) => p.chave);

const APROVA: Permissao[] = ['aprovar_bonificacao', 'validar_visita', 'criar_pedido', 'cancelar_pedido'];

/** Padrao de cada papel (o que vale quando o admin nao mexeu). */
export const PADROES: Record<PapelPainel, Permissao[]> = {
  admin: PERMISSOES.map((p) => p.chave),
  aprovador: APROVA,
  consulta: [],
  supervisor: APROVA,
  gerente: APROVA,
  gerente_geral: APROVA,
  vendedor: ['criar_pedido', 'cancelar_pedido'],
};

/** Permissoes efetivas: padrao do papel + ajustes do usuario. Admin: todas. */
export function permissoesEfetivas(papel: PapelPainel, ajustes: unknown): Permissao[] {
  if (papel === 'admin') return PADROES.admin;
  const a = (ajustes && typeof ajustes === 'object' ? ajustes : {}) as Record<string, unknown>;
  const set = new Set<Permissao>(PADROES[papel] ?? []);
  for (const k of CHAVES) {
    if (a[k] === true) set.add(k as Permissao);
    else if (a[k] === false) set.delete(k as Permissao);
  }
  return [...set];
}

/** Do mapa completo marcado na tela para so as diferencas do padrao do papel (o que vai para o banco). */
export function ajustesDe(papel: PapelPainel, marcadas: unknown): Record<string, boolean> {
  const m = (marcadas && typeof marcadas === 'object' ? marcadas : {}) as Record<string, unknown>;
  const padrao = new Set<string>(PADROES[papel] ?? []);
  const out: Record<string, boolean> = {};
  for (const k of CHAVES) {
    if (typeof m[k] !== 'boolean') continue;
    if (m[k] !== padrao.has(k)) out[k] = m[k] as boolean;
  }
  return out;
}
