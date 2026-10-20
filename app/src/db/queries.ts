import type { SQLiteDatabase } from 'expo-sqlite';
import type { AreaCliente } from '@/domain/preco';

// Todas as telas leem SO daqui (SQLite local): funcionam 100% offline.

export interface ClienteResumo {
  cod_cliente: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  bloqueado: number;
  limite_disponivel: number | null;
  /** 1 = pagamento antecipado (forma 'V'): sem credito */
  pagamento_antecipado: number;
  sequencia: number | null;
  atrasados: number;
  valor_atrasado: number;
}

const RESUMO = `
  c.cod_cliente, c.nome_fantasia, c.razao_social, c.bloqueado, c.limite_disponivel, c.pagamento_antecipado,
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
  latitude: number | null;
  longitude: number | null;
  pedido_minimo: number | null;
  formas_pagamento: Array<{ codigo: string; descricao?: string }>;
  /** true = forma de pagamento so 'V' (antecipado): sem credito, o limite disponivel vem zerado */
  pagamento_antecipado: boolean;
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
    latitude: (r.latitude as number | null) ?? null,
    longitude: (r.longitude as number | null) ?? null,
    pedido_minimo: (r.pedido_minimo as number | null) ?? null,
    formas_pagamento: parse<Array<{ codigo: string; descricao?: string }>>(r.formas_pagamento, []),
    pagamento_antecipado: !!r.pagamento_antecipado,
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
  /** 1 = pedido de bonificacao (so existe para pedidos criados no app) */
  bonificacao: number;
}

/** Pedidos de um cliente: ordens do SAP + pedidos do app que ainda nao viraram ordem. */
export function pedidosDoCliente(db: SQLiteDatabase, cod: string, limite = 30) {
  return db.getAllAsync<PedidoLista>(
    `SELECT * FROM (
        SELECT 'sap' AS origem, ordem AS chave, dt_criacao AS data, valor, status,
               pedido_externo AS codigo, NULL AS erro, 0 AS bonificacao
          FROM pedidos_sap WHERE cod_cliente = ?
        UNION ALL
        SELECT 'app', id, substr(criado_em, 1, 10), NULL, status, codigo, erro, (tipo = 'bonificacao')
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
  aguardando: number; // pendente / recebido / parcial / enviando / aprovado (a caminho do SAP)
  erros: number; // erro / rejeitado
  aprovacao: number; // bonificacao aguardando aprovacao
}

export async function contarFila(db: SQLiteDatabase): Promise<FilaPedidos> {
  const r = await db.getFirstAsync<FilaPedidos>(
    `SELECT COALESCE(SUM(status IN ('pendente','recebido','parcial','enviando','aprovado')), 0) AS aguardando,
            COALESCE(SUM(status IN ('erro','rejeitado')), 0) AS erros,
            COALESCE(SUM(status = 'aguardando_aprovacao'), 0) AS aprovacao
       FROM pedidos_app`,
  );
  return r ?? { aguardando: 0, erros: 0, aprovacao: 0 };
}


// ---------------------------------------------------------------------------
// Aba "Pedidos e titulos": visao de TODA a carteira
// ---------------------------------------------------------------------------

export interface PedidoGeral extends PedidoLista {
  cod_cliente: string;
  nome_cliente: string | null;
}

export type FiltroPedidos = 'todos' | 'pendentes' | 'erros' | 'aprovacao' | 'fila';

const STATUS_FILA = `('pendente','recebido','enviando','parcial','aprovado')`;

/** Pedidos da carteira (SAP + app). Pendentes de envio e rascunhos aparecem junto, com selo proprio. */
export function listarPedidos(db: SQLiteDatabase, filtro: FiltroPedidos, limite = 200) {
  const where =
    filtro === 'fila' ? `WHERE origem = 'app' AND (status IN ${STATUS_FILA} OR status IN ('erro','rejeitado','aguardando_aprovacao'))`
    : filtro === 'pendentes' ? `WHERE origem = 'app' AND status IN ${STATUS_FILA}`
    : filtro === 'aprovacao' ? `WHERE origem = 'app' AND status = 'aguardando_aprovacao'`
    : filtro === 'erros' ? `WHERE origem = 'app' AND status IN ('erro','rejeitado')`
    : '';
  return db.getAllAsync<PedidoGeral>(
    `SELECT * FROM (
        SELECT 'sap' AS origem, p.ordem AS chave, p.cod_cliente, c.nome_fantasia AS nome_cliente,
               p.dt_criacao AS data, p.valor, p.status, p.pedido_externo AS codigo, NULL AS erro, 0 AS bonificacao
          FROM pedidos_sap p LEFT JOIN clientes c ON c.cod_cliente = p.cod_cliente
        UNION ALL
        SELECT 'app', a.id, a.cod_cliente, c.nome_fantasia, substr(a.criado_em, 1, 10), NULL, a.status, a.codigo, COALESCE(a.motivo_rejeicao, a.erro), (a.tipo = 'bonificacao')
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

export interface VendasMes {
  total: number;
  pedidos: number;
}

/** Soma dos pedidos do SAP criados no mes de `hoje` (AAAA-MM-DD), dos clientes da carteira. */
export async function vendasDoMes(db: SQLiteDatabase, hoje: string): Promise<VendasMes> {
  const r = await db.getFirstAsync<VendasMes>(
    `SELECT COALESCE(SUM(valor), 0) AS total, COUNT(*) AS pedidos
       FROM pedidos_sap WHERE substr(dt_criacao, 1, 7) = ?`,
    hoje.slice(0, 7),
  );
  return r ?? { total: 0, pedidos: 0 };
}

// ---- Cliente: ultima compra, historico mensal e produtos ----

export interface UltimaCompra {
  ordem: string;
  data: string;
  valor: number | null;
}

/** O aparelho ja recebeu os totais de 12 meses do servidor? (senao as telas usam so os 90 dias de pedidos locais) */
async function temTotais(db: SQLiteDatabase, tabela: 'historico_mes' | 'historico_produto'): Promise<boolean> {
  return !!(await db.getFirstAsync(`SELECT 1 AS x FROM ${tabela} LIMIT 1`));
}

export async function ultimaCompraDoCliente(db: SQLiteDatabase, cod: string): Promise<UltimaCompra | null> {
  const local = await db.getFirstAsync<UltimaCompra>(
    `SELECT ordem, dt_criacao AS data, valor FROM pedidos_sap
      WHERE cod_cliente = ? AND dt_criacao IS NOT NULL ORDER BY dt_criacao DESC, ordem DESC LIMIT 1`,
    cod,
  );
  if (local) return local;
  // compra mais antiga que os 90 dias do aparelho: so a data (vem dos totais de 12 meses; sem numero nem valor)
  const h = await db.getFirstAsync<{ data: string | null }>('SELECT MAX(ultima_compra) AS data FROM historico_produto WHERE cod_cliente = ?', cod);
  return h?.data ? { ordem: '', data: h.data, valor: null } : null;
}

export interface MesCompra {
  /** AAAA-MM */
  mes: string;
  total: number;
  pedidos: number;
}

/** Compras do cliente nos ultimos `meses` meses (inclui o atual), um ponto por mes, com zero onde nao comprou. */
export async function historicoMensalDoCliente(db: SQLiteDatabase, cod: string, hoje: string, meses = 12): Promise<MesCompra[]> {
  const ano = Number(hoje.slice(0, 4));
  const mes0 = Number(hoje.slice(5, 7)) - 1;
  const lista: MesCompra[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(ano, mes0 - i, 1);
    lista.push({ mes: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, total: 0, pedidos: 0 });
  }
  // com os totais de 12 meses do servidor usa eles; sem eles, so o que ha nos 90 dias de pedidos locais
  const rows = (await temTotais(db, 'historico_mes'))
    ? await db.getAllAsync<MesCompra>('SELECT mes, valor AS total, pedidos FROM historico_mes WHERE cod_cliente = ? AND mes >= ?', cod, lista[0].mes)
    : await db.getAllAsync<MesCompra>(
        `SELECT substr(dt_criacao, 1, 7) AS mes, COALESCE(SUM(valor), 0) AS total, COUNT(*) AS pedidos
           FROM pedidos_sap WHERE cod_cliente = ? AND dt_criacao >= ? GROUP BY 1`,
        cod,
        `${lista[0].mes}-01`,
      );
  for (const r of rows) {
    const alvo = lista.find((m) => m.mes === r.mes);
    if (alvo) {
      alvo.total = r.total;
      alvo.pedidos = r.pedidos;
    }
  }
  return lista;
}

export interface ProdutoComprado {
  cod_produto: string;
  descricao: string;
  ultima_compra: string;
  pedidos: number;
  quantidade: number;
  unidade: string | null;
}

/** Produtos que o cliente comprou (itens nao recusados), do mais recente ao mais antigo: 12 meses quando o servidor ja mandou os totais, senao os 90 dias locais. */
export async function produtosCompradosPeloCliente(db: SQLiteDatabase, cod: string): Promise<ProdutoComprado[]> {
  if (await temTotais(db, 'historico_produto')) {
    return db.getAllAsync<ProdutoComprado>(
      `SELECT cod_produto, COALESCE(denominacao, cod_produto) AS descricao, ultima_compra, pedidos, quantidade, unidade
         FROM historico_produto WHERE cod_cliente = ? ORDER BY ultima_compra DESC`,
      cod,
    );
  }
  return db.getAllAsync<ProdutoComprado>(
    `SELECT i.cod_produto AS cod_produto,
            COALESCE(MAX(i.denominacao), i.cod_produto) AS descricao,
            MAX(p.dt_criacao) AS ultima_compra,
            COUNT(DISTINCT i.ordem) AS pedidos,
            COALESCE(SUM(i.quantidade), 0) AS quantidade,
            MAX(i.unidade_venda) AS unidade
       FROM pedido_itens_sap i JOIN pedidos_sap p ON p.ordem = i.ordem
      WHERE p.cod_cliente = ? AND i.cod_produto IS NOT NULL AND COALESCE(i.recusa, '') = ''
      GROUP BY i.cod_produto
      ORDER BY ultima_compra DESC`,
    cod,
  );
}

export interface CompraDoProduto {
  ordem: string;
  data: string;
  quantidade: number | null;
  unidade: string | null;
  valor_unitario: number | null;
}

/** Historico de compras de UM produto por UM cliente. */
export function historicoDoProduto(db: SQLiteDatabase, cod: string, produto: string) {
  return db.getAllAsync<CompraDoProduto>(
    `SELECT i.ordem AS ordem, p.dt_criacao AS data, i.quantidade AS quantidade,
            i.unidade_venda AS unidade, i.valor_unitario AS valor_unitario
       FROM pedido_itens_sap i JOIN pedidos_sap p ON p.ordem = i.ordem
      WHERE p.cod_cliente = ? AND i.cod_produto = ? AND COALESCE(i.recusa, '') = ''
      ORDER BY p.dt_criacao DESC, i.ordem DESC`,
    cod,
    produto,
  );
}

export interface VendaMes {
  /** AAAA-MM */
  mes: string;
  total: number;
  pedidos: number;
}

/** Vendas da carteira (pedidos do SAP) por mes, nos ultimos `meses` meses incluindo o atual; zero onde nao vendeu. */
export async function vendasPorMes(db: SQLiteDatabase, hoje: string, meses = 3): Promise<VendaMes[]> {
  const ano = Number(hoje.slice(0, 4));
  const mes0 = Number(hoje.slice(5, 7)) - 1;
  const lista: VendaMes[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(ano, mes0 - i, 1);
    lista.push({ mes: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, total: 0, pedidos: 0 });
  }
  // com os totais do servidor os meses vem COMPLETOS (inclusive o primeiro); sem eles, so os 90 dias locais
  const rows = (await temTotais(db, 'historico_mes'))
    ? await db.getAllAsync<VendaMes>('SELECT mes, SUM(valor) AS total, SUM(pedidos) AS pedidos FROM historico_mes WHERE mes >= ? GROUP BY mes', lista[0].mes)
    : await db.getAllAsync<VendaMes>(
        `SELECT substr(dt_criacao, 1, 7) AS mes, COALESCE(SUM(valor), 0) AS total, COUNT(*) AS pedidos
           FROM pedidos_sap WHERE dt_criacao >= ? GROUP BY 1`,
        `${lista[0].mes}-01`,
      );
  for (const r of rows) {
    const alvo = lista.find((m) => m.mes === r.mes);
    if (alvo) {
      alvo.total = r.total;
      alvo.pedidos = r.pedidos;
    }
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Carteira parada: clientes da carteira que nao compram ha X dias
// ---------------------------------------------------------------------------

export interface ClienteParado {
  cod_cliente: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  bloqueado: number;
  /** AAAA-MM-DD da ultima ordem que o aparelho conhece (null = nenhuma nos ultimos 90 dias) */
  ultima_compra: string | null;
  /** dias da semana de visita (1=seg..7=dom) */
  dias_visita: number[];
}

/**
 * Clientes da carteira SEM compra desde `corte` (AAAA-MM-DD): os que nao compraram em nada que o aparelho conhece
 * (12 meses quando o servidor mandou os totais; senao 90 dias) vem primeiro, depois do mais antigo para o mais recente.
 */
export async function carteiraParada(db: SQLiteDatabase, corte: string): Promise<ClienteParado[]> {
  const rows = await db.getAllAsync<{
    cod_cliente: string; nome_fantasia: string | null; razao_social: string | null; bloqueado: number;
    ultima_compra: string | null; dias: string | null;
  }>(
    `SELECT c.cod_cliente AS cod_cliente, c.nome_fantasia AS nome_fantasia, c.razao_social AS razao_social, c.bloqueado AS bloqueado,
            NULLIF(MAX(COALESCE((SELECT MAX(p.dt_criacao) FROM pedidos_sap p WHERE p.cod_cliente = c.cod_cliente), ''),
                       COALESCE((SELECT MAX(h.ultima_compra) FROM historico_produto h WHERE h.cod_cliente = c.cod_cliente), '')), '') AS ultima_compra,
            (SELECT GROUP_CONCAT(DISTINCT ca.dia_semana) FROM carteira ca WHERE ca.cod_cliente = c.cod_cliente) AS dias
       FROM clientes c
      WHERE c.cod_cliente IN (SELECT cod_cliente FROM carteira)
        AND NOT EXISTS (SELECT 1 FROM pedidos_sap p WHERE p.cod_cliente = c.cod_cliente AND p.dt_criacao >= ?)
        AND NOT EXISTS (SELECT 1 FROM historico_produto h WHERE h.cod_cliente = c.cod_cliente AND h.ultima_compra >= ?)
      ORDER BY ultima_compra IS NOT NULL, ultima_compra, c.nome_fantasia`,
    corte,
    corte,
  );
  return rows.map((r) => ({
    cod_cliente: r.cod_cliente,
    nome_fantasia: r.nome_fantasia,
    razao_social: r.razao_social,
    bloqueado: r.bloqueado,
    ultima_compra: r.ultima_compra,
    dias_visita: (r.dias ?? '').split(',').map(Number).filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b),
  }));
}

/** O cliente esta no roteiro do dia da semana `dia` (1=seg..7=dom)? So esses clientes tem visita (sem visita avulsa). */
export async function noRoteiroDoDia(db: SQLiteDatabase, cod: string, dia: number): Promise<boolean> {
  const r = await db.getFirstAsync<{ x: number }>('SELECT 1 AS x FROM carteira WHERE cod_cliente = ? AND dia_semana = ? LIMIT 1', cod, dia);
  return !!r;
}
