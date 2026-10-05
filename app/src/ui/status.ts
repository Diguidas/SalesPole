export type Tom = 'ok' | 'aviso' | 'erro' | 'neutro';

/** Cor do selo por status (status do SAP e status do pedido do app). */
export const TOM_STATUS: Record<string, Tom> = {
  // SAP
  Faturado: 'ok',
  'Faturado Parcial': 'ok',
  'A Faturar': 'aviso',
  'Liberado para faturamento': 'aviso',
  'Aguardando Liberação': 'aviso',
  Recusado: 'erro',
  // app
  rascunho: 'neutro',
  pendente: 'aviso',
  recebido: 'aviso',
  enviando: 'aviso',
  parcial: 'aviso',
  enviado: 'ok',
  erro: 'erro',
};

/** Texto do selo para pedidos criados no app. */
export const ROTULO_APP: Record<string, string> = {
  rascunho: 'Rascunho',
  pendente: 'Aguardando envio',
  recebido: 'Enviando ao SAP',
  enviando: 'Enviando ao SAP',
  parcial: 'Parcialmente enviado',
  erro: 'Erro no envio',
  enviado: 'Enviado',
};

export const seloDoPedido = (origem: 'sap' | 'app', status: string | null): { texto: string; tom: Tom } | null =>
  status ? { texto: origem === 'app' ? (ROTULO_APP[status] ?? status) : status, tom: TOM_STATUS[status] ?? 'neutro' } : null;
