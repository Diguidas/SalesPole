import type { SQLiteDatabase } from 'expo-sqlite';
import { api } from '@/lib/api';
import { aplicarResultado, pendentesDeEnvio, type PedidoApp, type ResultadoServidor } from './pedidos';

interface RespostaPush {
  resultados: ResultadoServidor[];
}

const TAMANHO_LOTE = 50; // limite da API por envio

/** Corpo que a API espera (o servidor atribui o codigo e calcula a data de entrega). */
function paraApi(p: PedidoApp) {
  return {
    id: p.id,
    criado_no_app_em: p.criado_em,
    cod_cliente: p.cod_cliente,
    cond_pagamento: p.cond_pagamento,
    ordem_compra_cliente: p.ordem_compra_cliente,
    endereco_entrega: p.endereco_entrega,
    observacao: p.observacao,
    duplicado_de: p.duplicado_de,
    // preco = por CAIXA (vira ZPR2); sem preco o SAP usa a lista
    itens: p.itens.map((i) => ({ produto: i.produto, unidade: i.unidade, quantidade: i.quantidade, preco: i.preco ?? null })),
  };
}

export interface ResumoEnvio {
  enviados: number; // pedidos que a API aceitou nesta rodada
  comErro: number; // recusados (validacao) ou com erro no SAP
}

/**
 * Envia os pedidos pendentes, em ordem de criacao (o original de um "duplicar" chega antes).
 * Falha de rede/timeout LANCA e deixa os pedidos pendentes: o proximo sincronismo tenta de novo,
 * e reenviar e seguro porque o UUID do pedido e a chave de idempotencia.
 */
export async function enviarPendentes(db: SQLiteDatabase): Promise<ResumoEnvio> {
  const pendentes = await pendentesDeEnvio(db);
  const resumo: ResumoEnvio = { enviados: 0, comErro: 0 };

  for (let i = 0; i < pendentes.length; i += TAMANHO_LOTE) {
    const lote = pendentes.slice(i, i + TAMANHO_LOTE);
    const resp = await api<RespostaPush>('/pedidos/push', {
      method: 'POST',
      body: { pedidos: lote.map(paraApi) },
      timeoutMs: 120_000,
    });

    for (const r of resp.resultados) {
      await aplicarResultado(db, r);
      if (r.status === 'invalido' || r.status === 'conflito' || r.status === 'erro') resumo.comErro++;
      else resumo.enviados++;
    }
  }
  return resumo;
}

/** Pede ao servidor para reenviar ao SAP um pedido que ele ja conhece e que ficou em 'erro'. */
export async function reenviarNoServidor(db: SQLiteDatabase, id: string): Promise<void> {
  const r = await api<ResultadoServidor>(`/pedidos/${id}/reenviar`, { method: 'POST', timeoutMs: 120_000 });
  await aplicarResultado(db, r);
}
