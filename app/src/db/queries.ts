import type { SQLiteDatabase } from 'expo-sqlite';
import type { AreaCliente } from '@/domain/preco';

// Todas as telas leem SO daqui (SQLite local): funcionam 100% offline.

export interface ClienteResumo {
  cod_cliente: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  bloqueado: number;
  limite_disponivel: number | null;
  sequencia: number | null;
  atrasados: number;
  valor_atrasado: number;
}

const RESUMO = `
  c.cod_cliente, c.nome_fantasia, c.razao_social, c.bloqueado, c.limite_disponivel,
  (SELECT COUNT(*) FROM titulos t WHERE t.cod_cliente = c.cod_cliente AND t.status = 'Atrasado') AS atrasados,
  (SELECT COALESCE(SUM(t.valor), 0) FROM titulos t WHERE t.cod_cliente = c.cod_cliente AND t.status = 'Atrasado') AS valor_atrasado
`;

/** Clientes do roteiro de um dia da semana (1=seg..7=dom), na ordem de visita. */
export function clientesDoDia(db: SQLiteDatabase, dia: number) {
  return db.getAllAsync<ClienteResumo>(
    `SELECT ${RESUMO}, ca.sequencia AS sequencia
       FROM carteira ca JOIN clientes c ON c.cod_cliente = ca.cod_cliente
      WHERE ca.dia_semana = ?
      ORDER BY ca.sequencia, c.nome_fantasia`,
    dia,
  );
}

/** Todos os clientes da carteira, com busca opcional por nome, codigo ou documento. */
export function listarClientes(db: SQLiteDatabase, busca: string) {
  const termo = `%${busca.trim()}%`;
  const apenasDigitos = `%${busca.replace(/\D/g, '')}%`;
  return db.getAllAsync<ClienteResumo>(
    busca.trim()
      ? `SELECT ${RESUMO}, NULL AS sequencia
           FROM clientes c
          WHERE c.nome_fantasia LIKE ? OR c.razao_social LIKE ? OR c.cod_cliente LIKE ?
             OR (? <> '%%' AND REPLACE(REPLACE(REPLACE(c.cnpjcpf,'.',''),'/',''),'-','') LIKE ?)
          ORDER BY c.nome_fantasia`
      : `SELECT ${RESUMO}, NULL AS sequencia FROM clientes c ORDER BY c.nome_fantasia`,
    ...(busca.trim() ? [termo, termo, termo, apenasDigitos, apenasDigitos] : []),
  );
}

export interface RemessaCliente {
  cod_cliente: string;
  nome_fantasia: string | null;
  ordens: number;
  itens: number;
}

/** O que sai para entrega numa data, agrupado por cliente (inclui clientes fora do roteiro do dia). */
export function remessasDoDia(db: SQLiteDatabase, data: string) {
  return db.getAllAsync<RemessaCliente>(
    `SELECT r.cod_cliente, c.nome_fantasia,
            COUNT(DISTINCT r.ordem) AS ordens, COUNT(*) AS itens
       FROM remessas r LEFT JOIN clientes c ON c.cod_cliente = r.cod_cliente
      WHERE r.data_remessa = ?
      GROUP BY r.cod_cliente, c.nome_fantasia
      ORDER BY c.nome_fantasia`,
    data,
  );
}

export interface ClienteDetalhe {
  cod_cliente: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpjcpf: string | null;
  telefone: string | null;
  bloqueado: number;
  endereco: { logradouro?: string; bairro?: string; cidade?: string; uf?: string; cep?: string } | null;
  limite_total: number | null;
  limite_disponivel: number | null;
  agrupado: number;
  dias_entrega: number[];
  classe_risco: { codigo: string; descricao: string } | null;
  areas: AreaCliente[];
}

export async function obterCliente(db: SQLiteDatabase, cod: string): Promise<ClienteDetalhe | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM clientes WHERE cod_cliente = ?', cod);
  if (!r) return null;
  const parse = <T>(v: unknown, vazio: T): T => {
    try {
      return typeof v === 'string' ? (JSON.parse(v) as T) : vazio;
    } catch {
      return vazio;
    }
  };
  return {
    cod_cliente: r.cod_cliente as string,
    nome_fantasia: r.nome_fantasia as string | null,
    razao_social: r.razao_social as string | null,
    cnpjcpf: r.cnpjcpf as string | null,
    telefone: r.telefone as string | null,
    bloqueado: r.bloqueado as number,
    endereco: parse(r.endereco, null),
    limite_total: r.limite_total as number | null,
    limite_disponivel: r.limite_disponivel as number | null,
    agrupado: r.agrupado as number,
    dias_entrega: parse<number[]>(r.dias_entrega, []),
    classe_risco: parse(r.classe_risco, null),
    areas: parse<AreaCliente[]>(r.areas, []),
  };
}

export interface PedidoLista {
  origem: 'sap' | 'app';
  chave: string; // ordem SAP ou id do pedido do app
  data: string | null;
  valor: number | null;
  status: string | null;
  codigo: string | null; // sequencial do app (pedido_externo no SAP)
  erro: string | null;
}

/** Pedidos de um cliente: ordens do SAP + pedidos do app que ainda nao viraram ordem. */
export function pedidosDoCliente(db: SQLiteDatabase, cod: string, limite = 30) {
  return db.getAllAsync<PedidoLista>(
    `SELECT * FROM (
        SELECT 'sap' AS origem, ordem AS chave, dt_criacao AS data, valor, status,
               pedido_externo AS codigo, NULL AS erro
          FROM pedidos_sap WHERE cod_cliente = ?
        UNION ALL
        SELECT 'app', id, substr(criado_em, 1, 10), NULL, status, codigo, erro
          FROM pedidos_app a WHERE cod_cliente = ?
           AND (status <> 'enviado' OR NOT EXISTS (SELECT 1 FROM pedidos_sap s WHERE s.pedido_externo = a.codigo))
     ) ORDER BY data DESC LIMIT ?`,
    cod,
    cod,
    limite,
  );
}

export interface TituloLista {
  nfe: string;
  parcela: string;
  status: string | null;
  valor: number | null;
  vencimento: string | null;
  dt_compensacao: string | null;
  boleto_url: string | null;
}

/** Titulos de um cliente: atrasados primeiro, depois em aberto, depois compensados. */
export function titulosDoCliente(db: SQLiteDatabase, cod: string) {
  return db.getAllAsync<TituloLista>(
    `SELECT nfe, parcela, status, valor, vencimento, dt_compensacao, boleto_url
       FROM titulos WHERE cod_cliente = ?
      ORDER BY CASE status WHEN 'Atrasado' THEN 0 WHEN 'Em aberto' THEN 1 ELSE 2 END, vencimento`,
    cod,
  );
}

export interface TituloDetalhe extends TituloLista {
  cod_cliente: string;
  nome_cliente: string | null;
  ordem: string | null;
  danfe_url: string | null;
  ordem_no_aparelho: number; // 1 se a ordem de origem tem detalhe neste aparelho
}

/** Um titulo (parcela) com cliente, ordem de origem e links (DANFE/boleto). */
export function obterTitulo(db: SQLiteDatabase, cod: string, nfe: string, parcela: string) {
  return db.getFirstAsync<TituloDetalhe>(
    `SELECT t.cod_cliente, c.nome_fantasia AS nome_cliente, t.nfe, t.parcela, t.status, t.valor,
            t.vencimento, t.dt_compensacao, t.ordem, t.danfe_url, t.boleto_url,
            EXISTS (SELECT 1 FROM pedidos_sap p WHERE p.ordem = t.ordem) AS ordem_no_aparelho
       FROM titulos t LEFT JOIN clientes c ON c.cod_cliente = t.cod_cliente
      WHERE t.cod_cliente = ? AND t.nfe = ? AND t.parcela = ?`,
    cod, nfe, parcela,
  );
}

/** Id do pedido criado no app cuja ordem SAP e esta (a ordem pode ainda nao ter chegado em pedidos_sap). */
export async function pedidoAppDaOrdem(db: SQLiteDatabase, ordem: string): Promise<string | null> {
  const rows = await db.getAllAsync<{ id: string; ordens_sap: string | null }>(
    `SELECT id, ordens_sap FROM pedidos_app WHERE ordens_sap LIKE ?`, `%${ordem}%`,
  );
  for (const r of rows) {
    try {
      if ((JSON.parse(r.ordens_sap ?? '[]') as Array<{ ordem: string }>).some((o) => o.ordem === ordem)) return r.id;
    } catch { /* ignora */ }
  }
  return null;
}

export interface FilaPedidos {
  aguardando: number; // pendente / recebido / parcial / enviando
  erros: number;
}

export async function contarFila(db: SQLiteDatabase): Promise<FilaPedidos> {
  const r = await db.getFirstAsync<FilaPedidos>(
    `SELECT COALESCE(SUM(status IN ('pendente','recebido','parcial','enviando')), 0) AS aguardando,
            COALESCE(SUM(status = 'erro'), 0) AS erros
       FROM pedidos_app`,
  );
  return r ?? { aguardando: 0, erros: 0 };
}


// ---------------------------------------------------------------------------
// Aba "Pedidos e titulos": visao de TODA a carteira
// ---------------------------------------------------------------------------

export interface PedidoGeral extends PedidoLista {
  cod_cliente: string;
  nome_cliente: string | null;
}

export type FiltroPedidos = 'todos' | 'pendentes' | 'erros';

const STATUS_FILA = `('pendente','recebido','enviando','parcial')`;

/** Pedidos da carteira (SAP + app). Pendentes de envio e rascunhos aparecem junto, com selo proprio. */
export function listarPedidos(db: SQLiteDatabase, filtro: FiltroPedidos, limite = 200) {
  const where =
    filtro === 'pendentes' ? `WHERE origem = 'app' AND status IN ${STATUS_FILA}`
    : filtro === 'erros' ? `WHERE origem = 'app' AND status = 'erro'`
    : '';
  return db.getAllAsync<PedidoGeral>(
    `SELECT * FROM (
        SELECT 'sap' AS origem, p.ordem AS chave, p.cod_cliente, c.nome_fantasia AS nome_cliente,
               p.dt_criacao AS data, p.valor, p.status, p.pedido_externo AS codigo, NULL AS erro
          FROM pedidos_sap p LEFT JOIN clientes c ON c.cod_cliente = p.cod_cliente
        UNION ALL
        SELECT 'app', a.id, a.cod_cliente, c.nome_fantasia, substr(a.criado_em, 1, 10), NULL, a.status, a.codigo, a.erro
          FROM pedidos_app a LEFT JOIN clientes c ON c.cod_cliente = a.cod_cliente
         WHERE a.status <> 'enviado'
            OR NOT EXISTS (SELECT 1 FROM pedidos_sap s WHERE s.pedido_externo = a.codigo)
     ) ${where} ORDER BY data DESC LIMIT ?`,
    limite,
  );
}

export interface TituloGeral extends TituloLista {
  cod_cliente: string;
  nome_cliente: string | null;
}

export type FiltroTitulos = 'todos' | 'atrasados' | 'abertos';

export function listarTitulos(db: SQLiteDatabase, filtro: FiltroTitulos, limite = 500) {
  const where =
    filtro === 'atrasados' ? `WHERE t.status = 'Atrasado'`
    : filtro === 'abertos' ? `WHERE t.status IN ('Atrasado','Em aberto')`
    : '';
  return db.getAllAsync<TituloGeral>(
    `SELECT t.cod_cliente, c.nome_fantasia AS nome_cliente, t.nfe, t.parcela, t.status, t.valor,
            t.vencimento, t.dt_compensacao, t.boleto_url
       FROM titulos t LEFT JOIN clientes c ON c.cod_cliente = t.cod_cliente
       ${where}
      ORDER BY CASE t.status WHEN 'Atrasado' THEN 0 WHEN 'Em aberto' THEN 1 ELSE 2 END, t.vencimento
      LIMIT ?`,
    limite,
  );
}

// ---------------------------------------------------------------------------
// Detalhe de um pedido que veio do SAP
// ---------------------------------------------------------------------------

export interface PedidoSapDetalhe {
  ordem: string;
  cod_cliente: string;
  nome_cliente: string | null;
  tp_ped: string | null;
  dt_criacao: string | null;
  dt_entrega: string | null;
  valor: number | null;
  status: string | null;
  pedido_externo: string | null;
  notas: Array<{ nota_fiscal: string | null; serie: string | null; danfe_url: string | null; boleto_url: string | null }>;
}

export async function obterPedidoSap(db: SQLiteDatabase, ordem: string): Promise<PedidoSapDetalhe | null> {
  const r = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT p.*, c.nome_fantasia AS nome_cliente FROM pedidos_sap p
       LEFT JOIN clientes c ON c.cod_cliente = p.cod_cliente WHERE p.ordem = ?`,
    ordem,
  );
  if (!r) return null;
  let notas: PedidoSapDetalhe['notas'] = [];
  try {
    notas = typeof r.notas === 'string' ? JSON.parse(r.notas) : [];
  } catch {
    /* sem notas */
  }
  return {
    ordem: r.ordem as string,
    cod_cliente: r.cod_cliente as string,
    nome_cliente: r.nome_cliente as string | null,
    tp_ped: r.tp_ped as string | null,
    dt_criacao: r.dt_criacao as string | null,
    dt_entrega: r.dt_entrega as string | null,
    valor: r.valor as number | null,
    status: r.status as string | null,
    pedido_externo: r.pedido_externo as string | null,
    notas,
  };
}

export interface ItemSap {
  item: string;
  cod_produto: string | null;
  denominacao: string | null;
  quantidade: number | null;
  unidade_venda: string | null;
  valor_unitario: number | null;
  recusa: string | null;
}

export function itensDoPedidoSap(db: SQLiteDatabase, ordem: string) {
  return db.getAllAsync<ItemSap>(
    `SELECT item, cod_produto, denominacao, quantidade, unidade_venda, valor_unitario, recusa
       FROM pedido_itens_sap WHERE ordem = ? ORDER BY item`,
    ordem,
  );
}
