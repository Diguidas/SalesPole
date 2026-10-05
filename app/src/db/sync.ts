import type { SQLiteBindParams, SQLiteDatabase } from 'expo-sqlite';
import { api } from '@/lib/api';
import { TABELAS_DE_DADOS } from './schema';

// ---- formato da resposta de GET /sync/pull (API NestJS) ----
type Linha = Record<string, unknown>;

export interface PullResposta {
  cursor: string;
  rota: string;
  vendedor?: { cod: string; nome: string | null; email: string };
  carteira: Array<{ cod_cliente: string; dia_semana: number; sequencia: number }>;
  clientes: Linha[];
  produtos: Linha[];
  pedidos: Linha[];
  pedidos_app: Linha[];
  pedido_itens: Linha[];
  titulos: Linha[];
  estoque: Linha[];
  precos_lista?: Linha[];
  precos_grupo?: Linha[];
  remessas?: Linha[];
  /** conjuntos devolvidos COMPLETOS: o app substitui o que tem */
  completos: string[];
}

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
const flag = (v: unknown) => (v ? 1 : 0);
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));

// ---- meta (chave/valor) ----
export async function lerMeta(db: SQLiteDatabase, chave: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ valor: string | null }>('SELECT valor FROM meta WHERE chave = ?', chave);
  return r?.valor ?? null;
}

export async function gravarMeta(db: SQLiteDatabase, chave: string, valor: string | null): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO meta (chave, valor) VALUES (?, ?)', chave, valor);
}

/** INSERT OR REPLACE em lote com um unico statement preparado. */
async function inserir(db: SQLiteDatabase, tabela: string, colunas: string[], linhas: SQLiteBindParams[]) {
  if (!linhas.length) return;
  const stmt = await db.prepareAsync(
    `INSERT OR REPLACE INTO ${tabela} (${colunas.join(',')}) VALUES (${colunas.map(() => '?').join(',')})`,
  );
  try {
    for (const l of linhas) await stmt.executeAsync(l);
  } finally {
    await stmt.finalizeAsync();
  }
}

const precoCols = ['pltyp', 'cod_produto', 'datab', 'datbi', 'kbetr', 'kpein', 'kmein', 'konwa', 'krech', 'preco_kg', 'desconto_max'];
const precoLinha = (p: Linha, comGrupo: boolean): SQLiteBindParams => [
  txt(p.pltyp),
  ...(comGrupo ? [txt(p.kdgrp)] : []),
  txt(p.cod_produto),
  txt(p.datab),
  txt(p.datbi),
  num(p.kbetr),
  num(p.kpein),
  txt(p.kmein),
  txt(p.konwa),
  txt(p.krech),
  num(p.preco_kg),
  num(p.desconto_max) ?? 0,
];

/** Aplica uma resposta do pull no banco local, numa unica transacao. */
export async function aplicarPull(db: SQLiteDatabase, r: PullResposta): Promise<void> {
  await db.withTransactionAsync(async () => {
    // carteira: sempre completa. Cliente que saiu da carteira some do aparelho.
    await db.runAsync('DELETE FROM carteira');
    await inserir(
      db,
      'carteira',
      ['cod_cliente', 'dia_semana', 'sequencia'],
      r.carteira.map((c) => [c.cod_cliente, c.dia_semana, c.sequencia]),
    );
    await inserir(
      db,
      'clientes',
      ['cod_cliente', 'nome_fantasia', 'razao_social', 'cnpjcpf', 'telefone', 'bloqueado', 'endereco',
        'limite_total', 'limite_disponivel', 'agrupado', 'dias_entrega', 'classe_risco', 'areas'],
      r.clientes.map((c) => [
        txt(c.cod_cliente), txt(c.nome_fantasia), txt(c.razao_social), txt(c.cnpjcpf), txt(c.telefone),
        flag(c.bloqueado), json(c.endereco), num(c.limite_total), num(c.limite_disponivel),
        flag(c.agrupado), json(c.dias_entrega), json(c.classe_risco), json(c.areas),
      ]),
    );

    // so fica quem esta na carteira (apos gravar: a resposta pode trazer cliente que acabou de sair dela)
    await db.runAsync('DELETE FROM clientes WHERE cod_cliente NOT IN (SELECT cod_cliente FROM carteira)');

    await inserir(
      db,
      'produtos',
      ['cod_produto', 'descricao', 'tipo', 'unidade', 'ean', 'ncm', 'validade', 'tipo_material', 'dados'],
      r.produtos.map((p) => [
        txt(p.cod_produto), txt(p.descricao), txt(p.tipo), txt(p.unidade), txt(p.ean), txt(p.ncm),
        txt(p.validade), txt(p.tipo_material), json(p.dados),
      ]),
    );

    await inserir(
      db,
      'estoque',
      ['centro', 'cod_produto', 'quantidade', 'unidade_base'],
      r.estoque.map((e) => [txt(e.centro), txt(e.cod_produto), num(e.quantidade) ?? 0, txt(e.unidade_base)]),
    );

    await inserir(
      db,
      'pedidos_sap',
      ['ordem', 'cod_cliente', 'tp_ped', 'dt_criacao', 'dt_entrega', 'valor', 'status', 'refaturado',
        'pedido_externo', 'plataforma', 'notas'],
      r.pedidos.map((p) => [
        txt(p.ordem), txt(p.cod_cliente), txt(p.tp_ped), txt(p.dt_criacao), txt(p.dt_entrega), num(p.valor),
        txt(p.status), txt(p.refaturado), txt(p.pedido_externo), txt(p.plataforma), json(p.notas),
      ]),
    );

    await inserir(
      db,
      'pedido_itens_sap',
      ['ordem', 'item', 'cod_produto', 'denominacao', 'grupo', 'quantidade', 'unidade_venda',
        'valor_unitario', 'recusa', 'cod_recusa'],
      r.pedido_itens.map((i) => [
        txt(i.ordem), txt(i.item), txt(i.cod_produto), txt(i.denominacao), txt(i.grupo), num(i.quantidade),
        txt(i.unidade_venda), num(i.valor_unitario), txt(i.recusa), txt(i.cod_recusa),
      ]),
    );

    await inserir(
      db,
      'titulos',
      ['cod_cliente', 'nfe', 'parcela', 'status', 'valor', 'vencimento', 'dt_compensacao', 'ordem',
        'danfe_url', 'boleto_url'],
      r.titulos.map((t) => [
        txt(t.cod_cliente), txt(t.nfe) ?? '', txt(t.parcela) ?? '', txt(t.status), num(t.valor),
        txt(t.vencimento), txt(t.dt_compensacao), txt(t.ordem), txt(t.danfe_url), txt(t.boleto_url),
      ]),
    );

    // conjuntos completos: preco vencido e remessa entregue SAEM (delta nao avisa remocao)
    if (r.completos.includes('precos_lista')) {
      await db.runAsync('DELETE FROM precos_lista');
      await inserir(db, 'precos_lista', precoCols, (r.precos_lista ?? []).map((p) => precoLinha(p, false)));
    }
    if (r.completos.includes('precos_grupo')) {
      await db.runAsync('DELETE FROM precos_grupo');
      await inserir(
        db,
        'precos_grupo',
        ['pltyp', 'kdgrp', ...precoCols.slice(1)],
        (r.precos_grupo ?? []).map((p) => precoLinha(p, true)),
      );
    }
    if (r.completos.includes('remessas')) {
      await db.runAsync('DELETE FROM remessas');
      await inserir(
        db,
        'remessas',
        ['ordem', 'item', 'data_remessa', 'cod_cliente', 'tp_ped', 'cod_produto', 'denominacao',
          'unidade_venda', 'quantidade_pedida', 'quantidade_confirmada', 'peso'],
        (r.remessas ?? []).map((x) => [
          txt(x.ordem), txt(x.item), txt(x.data_remessa), txt(x.cod_cliente), txt(x.tp_ped), txt(x.cod_produto),
          txt(x.denominacao), txt(x.unidade_venda), num(x.quantidade_pedida), num(x.quantidade_confirmada),
          num(x.peso),
        ]),
      );
    }

    // pedidos criados no app: o servidor e a autoridade sobre status/codigo/ordens, mas NAO
    // conhece (e nao pode apagar) os itens e rascunhos locais -> upsert que preserva os itens
    for (const p of r.pedidos_app) {
      await db.runAsync(
        `INSERT INTO pedidos_app (id, codigo, cod_cliente, status, criado_em, dt_entrega, ordens_sap, erro,
                                  tentativas, enviado_em, duplicado_de, atualizado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           codigo = excluded.codigo, status = excluded.status, dt_entrega = excluded.dt_entrega,
           ordens_sap = excluded.ordens_sap, erro = excluded.erro, tentativas = excluded.tentativas,
           enviado_em = excluded.enviado_em, atualizado_em = excluded.atualizado_em`,
        [
          txt(p.id), txt(p.codigo), txt(p.cod_cliente), txt(p.status), txt(p.recebido_em), txt(p.dt_entrega),
          json(p.ordens_sap), txt(p.erro), num(p.tentativas) ?? 0, txt(p.enviado_sap_em), txt(p.duplicado_de),
          txt(p.updated_at),
        ],
      );
    }

    await gravarMeta(db, 'cursor', r.cursor);
    await gravarMeta(db, 'rota', r.rota);
    if (r.vendedor) await gravarMeta(db, 'vendedor', JSON.stringify(r.vendedor));
    await gravarMeta(db, 'ultimo_sync', new Date().toISOString());
  });
}

/** Baixa o que mudou no servidor desde o ultimo cursor e aplica no banco local. */
export async function executarPull(db: SQLiteDatabase): Promise<void> {
  const cursor = await lerMeta(db, 'cursor');
  const caminho = cursor ? `/sync/pull?since=${encodeURIComponent(cursor)}` : '/sync/pull';
  const resposta = await api<PullResposta>(caminho, { timeoutMs: 120_000 });
  await aplicarPull(db, resposta);
}

/** Apaga TODOS os dados locais (troca de usuario no mesmo aparelho). */
export async function limparBancoLocal(db: SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const t of TABELAS_DE_DADOS) await db.runAsync(`DELETE FROM ${t}`);
    await db.runAsync('DELETE FROM meta');
  });
}
