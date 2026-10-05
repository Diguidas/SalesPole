import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { ItemPedido } from '@/domain/pedido';
import { lerConversoes, unidadeInterna, type DadosProduto } from '@/domain/preco';
import { formatarQuantidade } from '@/domain/quantidade';

/** Pedido criado no app (tabela pedidos_app), com os campos JSON ja convertidos. */
export interface PedidoApp {
  id: string;
  codigo: string | null; // sequencial definitivo (so existe depois que o servidor recebe)
  cod_cliente: string;
  /** rascunho | pendente | recebido | enviando | parcial | enviado | erro */
  status: string;
  criado_em: string;
  dt_entrega: string | null;
  cond_pagamento: string | null;
  ordem_compra_cliente: string | null;
  endereco_entrega: string | null;
  observacao: string | null;
  itens: ItemPedido[];
  duplicado_de: string | null;
  ordens_sap: Array<{ ordem: string; tipo_material: string; vkorg: string }>;
  erro: string | null;
  tentativas: number;
}

const json = <T>(v: unknown, vazio: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : vazio;
  } catch {
    return vazio;
  }
};

function paraPedido(r: Record<string, unknown>): PedidoApp {
  return {
    id: r.id as string,
    codigo: (r.codigo as string | null) ?? null,
    cod_cliente: r.cod_cliente as string,
    status: r.status as string,
    criado_em: r.criado_em as string,
    dt_entrega: (r.dt_entrega as string | null) ?? null,
    cond_pagamento: (r.cond_pagamento as string | null) ?? null,
    ordem_compra_cliente: (r.ordem_compra_cliente as string | null) ?? null,
    endereco_entrega: (r.endereco_entrega as string | null) ?? null,
    observacao: (r.observacao as string | null) ?? null,
    itens: json<ItemPedido[]>(r.itens, []),
    duplicado_de: (r.duplicado_de as string | null) ?? null,
    ordens_sap: json(r.ordens_sap, []),
    erro: (r.erro as string | null) ?? null,
    tentativas: (r.tentativas as number) ?? 0,
  };
}

const agora = () => new Date().toISOString();

export async function lerPedidoApp(db: SQLiteDatabase, id: string): Promise<PedidoApp | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM pedidos_app WHERE id = ?', id);
  return r ? paraPedido(r) : null;
}

/** Cria um rascunho novo. O UUID e gerado AQUI (offline): e a chave de idempotencia do envio. */
async function criarRascunho(
  db: SQLiteDatabase,
  codCliente: string,
  itens: ItemPedido[] = [],
  duplicadoDe: string | null = null,
): Promise<string> {
  const id = Crypto.randomUUID();
  await db.runAsync(
    `INSERT INTO pedidos_app (id, cod_cliente, status, criado_em, itens, duplicado_de, atualizado_em)
     VALUES (?, ?, 'rascunho', ?, ?, ?, ?)`,
    id, codCliente, agora(), JSON.stringify(itens), duplicadoDe, agora(),
  );
  return id;
}

/** Retoma o rascunho aberto do cliente, ou cria um novo (o pedido sobrevive se o app for fechado). */
export async function obterOuCriarRascunho(db: SQLiteDatabase, codCliente: string): Promise<string> {
  const r = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM pedidos_app WHERE cod_cliente = ? AND status = 'rascunho' ORDER BY criado_em DESC LIMIT 1`,
    codCliente,
  );
  return r?.id ?? criarRascunho(db, codCliente);
}

export interface RascunhoResumo {
  id: string;
  cod_cliente: string;
  nome_cliente: string | null;
  itens: number;
  atualizado_em: string | null;
}

export async function listarRascunhos(db: SQLiteDatabase): Promise<RascunhoResumo[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT a.id, a.cod_cliente, c.nome_fantasia AS nome_cliente, a.itens, a.atualizado_em
       FROM pedidos_app a LEFT JOIN clientes c ON c.cod_cliente = a.cod_cliente
      WHERE a.status = 'rascunho' ORDER BY a.atualizado_em DESC`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    cod_cliente: r.cod_cliente as string,
    nome_cliente: r.nome_cliente as string | null,
    itens: json<ItemPedido[]>(r.itens, []).length,
    atualizado_em: r.atualizado_em as string | null,
  }));
}

export async function salvarItens(db: SQLiteDatabase, id: string, itens: ItemPedido[]): Promise<void> {
  await db.runAsync(`UPDATE pedidos_app SET itens = ?, atualizado_em = ? WHERE id = ? AND status = 'rascunho'`, JSON.stringify(itens), agora(), id);
}

export async function salvarCampos(
  db: SQLiteDatabase,
  id: string,
  campos: { ordem_compra_cliente: string | null; observacao: string | null },
): Promise<void> {
  await db.runAsync(
    `UPDATE pedidos_app SET ordem_compra_cliente = ?, observacao = ?, atualizado_em = ? WHERE id = ? AND status = 'rascunho'`,
    campos.ordem_compra_cliente?.trim() || null, campos.observacao?.trim() || null, agora(), id,
  );
}

/**
 * Confirma o pedido: vai para a fila de envio. A data da compra passa a ser AGORA (um rascunho
 * aberto ha dias nao pode levar a data antiga). So o envio ao servidor gera o codigo definitivo.
 */
export async function confirmarPedido(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(
    `UPDATE pedidos_app SET status = 'pendente', criado_em = ?, erro = NULL, atualizado_em = ?
      WHERE id = ? AND status = 'rascunho'`,
    agora(), agora(), id,
  );
}

/** Descarta um pedido que o servidor NAO conhece (rascunho, pendente, ou erro sem codigo). */
export async function descartarPedido(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(`DELETE FROM pedidos_app WHERE id = ? AND codigo IS NULL AND status IN ('rascunho','pendente','erro')`, id);
}

/** "Duplicar pedido": novo rascunho do mesmo cliente com os mesmos itens, ligado ao original. */
export async function duplicarPedidoApp(db: SQLiteDatabase, id: string): Promise<string | null> {
  const p = await lerPedidoApp(db, id);
  if (!p) return null;
  return criarRascunho(db, p.cod_cliente, p.itens, p.id);
}

/** Duplica uma ordem que veio do SAP (itens recusados nao entram). */
export async function duplicarPedidoSap(db: SQLiteDatabase, ordem: string): Promise<string | null> {
  const p = await db.getFirstAsync<{ cod_cliente: string }>('SELECT cod_cliente FROM pedidos_sap WHERE ordem = ?', ordem);
  if (!p) return null;
  const itens = await db.getAllAsync<{ cod_produto: string | null; unidade_venda: string | null; quantidade: number | null }>(
    `SELECT cod_produto, unidade_venda, quantidade FROM pedido_itens_sap
      WHERE ordem = ? AND (cod_recusa IS NULL OR cod_recusa = '') ORDER BY item`,
    ordem,
  );
  // o SAP devolve o TEXTO da unidade ("CX") nos itens; o pedido novo precisa do CODIGO ("KI")
  const codigos = [...new Set(itens.map((i) => i.cod_produto).filter((c): c is string => !!c))];
  const dados = codigos.length
    ? await db.getAllAsync<{ cod_produto: string; dados: string | null }>(
        `SELECT cod_produto, dados FROM produtos WHERE cod_produto IN (${codigos.map(() => '?').join(',')})`,
        codigos,
      )
    : [];
  const conversoes = new Map(dados.map((d) => [d.cod_produto, lerConversoes(json<DadosProduto>(d.dados, {}))]));

  const lista: ItemPedido[] = itens
    .filter((i) => i.cod_produto && i.unidade_venda && i.quantidade && i.quantidade > 0)
    .map((i) => {
      const conv = conversoes.get(i.cod_produto!);
      return {
        produto: i.cod_produto!,
        unidade: conv ? unidadeInterna(i.unidade_venda!, conv) : i.unidade_venda!,
        quantidade: formatarQuantidade(i.quantidade!),
      };
    });
  return criarRascunho(db, p.cod_cliente, lista, null);
}

/** Pedidos confirmados que ainda nao chegaram ao servidor, na ordem em que foram criados. */
export async function pendentesDeEnvio(db: SQLiteDatabase): Promise<PedidoApp[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM pedidos_app WHERE status = 'pendente' ORDER BY criado_em`);
  return rows.map(paraPedido);
}

export interface ResultadoServidor {
  id: string | null;
  status: string;
  codigo?: string;
  ordens?: Array<{ ordem: string; tipo_material: string; vkorg: string }>;
  erro?: string | null;
  erros?: string[];
  dt_entrega?: string | null;
  tentativas?: number;
}

/** Grava no banco local o que o servidor respondeu para um pedido enviado. */
export async function aplicarResultado(db: SQLiteDatabase, r: ResultadoServidor): Promise<void> {
  if (!r.id) return;
  // 'invalido' / 'conflito': o servidor nao guardou o pedido -> fica local, em erro, sem codigo
  const rejeitado = r.status === 'invalido' || r.status === 'conflito';
  const status = rejeitado ? 'erro' : r.status;
  const erro = rejeitado ? (r.erros ?? []).join(' ') || 'Pedido recusado pelo servidor.' : (r.erro ?? null);

  await db.runAsync(
    `UPDATE pedidos_app
        SET status = ?, codigo = COALESCE(?, codigo), ordens_sap = COALESCE(?, ordens_sap), erro = ?,
            dt_entrega = COALESCE(?, dt_entrega), tentativas = COALESCE(?, tentativas),
            enviado_em = CASE WHEN ? = 'enviado' THEN ? ELSE enviado_em END, atualizado_em = ?
      WHERE id = ?`,
    status, r.codigo ?? null, r.ordens ? JSON.stringify(r.ordens) : null, erro,
    r.dt_entrega ?? null, r.tentativas ?? null, status, agora(), agora(), r.id,
  );
}
