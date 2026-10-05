import { SapCriarPedidoResp } from '../sap/sap.types';

export interface OrdemSap {
  ordem: string;
  tipo_material: string;
  vkorg: string;
}

/**
 * O que a resposta do SAP significa para o pedido:
 *  - ok          : todas as ordens existem no SAP
 *  - parcial     : so parte das ordens (FERT/HAWA) foi criada; repetir cria so as que faltam
 *  - permanente  : erro de negocio/validacao; repetir igual nao adianta (vendedor precisa agir)
 *  - transitorio : indisponibilidade/pedido em processamento; vale tentar de novo
 */
export type Desfecho =
  | { tipo: 'ok'; ordens: OrdemSap[]; dtEntrega: string | null }
  | { tipo: 'parcial'; ordens: OrdemSap[]; dtEntrega: string | null; erro: string }
  | { tipo: 'permanente'; erro: string }
  | { tipo: 'transitorio'; erro: string };

/** Minutos de espera antes de cada nova tentativa (1a, 2a, ...). */
export const BACKOFF_MIN = [1, 2, 5, 10, 30, 60, 120, 240];
export const MAX_TENTATIVAS = BACKOFF_MIN.length;

/** Quando tentar de novo, dado o numero de tentativas ja feitas. */
export function proximaTentativa(tentativas: number, agora = Date.now()): string {
  const min = BACKOFF_MIN[Math.min(Math.max(tentativas, 1) - 1, BACKOFF_MIN.length - 1)];
  return new Date(agora + min * 60_000).toISOString();
}

const dataValida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export function classificar(status: number, d: SapCriarPedidoResp): Desfecho {
  const mensagens = (d.mensagens ?? [])
    .map((m) => m.mensagem)
    .filter(Boolean)
    .join(' | ');
  const erro = (mensagens || d.erro || `SAP respondeu ${status}`).slice(0, 1000);

  const ordens: OrdemSap[] = (d.ordens ?? []).map((o) => ({
    ordem: o.ordem,
    tipo_material: o.tipo_material,
    vkorg: o.vkorg,
  }));
  const dtEntrega = dataValida(d.dt_entrega);

  if (status >= 200 && status < 300 && d.sucesso === 'true') return { tipo: 'ok', ordens, dtEntrega };
  if (d.parcial === 'true' && ordens.length) return { tipo: 'parcial', ordens, dtEntrega, erro };

  // 409 = outro envio do mesmo codigo em andamento (enqueue); 5xx = SAP com problema
  if (status === 409 || status >= 500) return { tipo: 'transitorio', erro };
  // validacao / carteira / regra de negocio
  if ([400, 403, 404, 422].includes(status)) return { tipo: 'permanente', erro };

  // demais (401 credencial, 408, 429, ...): pode se resolver sozinho ou por configuracao
  return { tipo: 'transitorio', erro };
}
