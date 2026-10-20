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
  /** cadastros do painel web: vem inteiros em todo pull */
  tipos_bonificacao?: Linha[];
  centros_custo?: Linha[];
  destaques?: Linha[];
  incentivos?: Linha[];
  feriados?: Linha[];
  /** visitas do vendedor dos ultimos dias (reconhece visita feita em outro aparelho e traz a validacao do painel) */
  visitas?: Linha[];
  /** perguntas que o painel manda o vendedor responder na visita (cadastro inteiro a cada pull) */
  visita_perguntas?: Linha[];
  /** avisos do painel vigentes para o vendedor (pop-up ao abrir o app) */
  avisos?: Linha[];
  /** totais de 12 meses (so vem quando mudaram): vendas por cliente/mes e o que cada cliente compra */
  historico_mes?: Linha[];
  historico_produto?: Linha[];
  /** parametros do painel: hoje, em quais status do SAP o pedido pode ser cancelado */
  parametros?: { status_cancelaveis?: unknown };
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

export async function gravarPedidosSap(db: SQLiteDatabase, pedidos: Linha[]) {
  await inserir(
    db,
    'pedidos_sap',
    ['ordem', 'cod_cliente', 'tp_ped', 'dt_criacao', 'dt_entrega', 'valor', 'status', 'refaturado',
      'pedido_externo', 'plataforma', 'notas'],
    pedidos.map((p) => [
      txt(p.ordem), txt(p.cod_cliente), txt(p.tp_ped), txt(p.dt_criacao), txt(p.dt_entrega), num(p.valor),
      txt(p.status), txt(p.refaturado), txt(p.pedido_externo), txt(p.plataforma), json(p.notas),
    ]),
  );
}

export async function gravarItensSap(db: SQLiteDatabase, itens: Linha[]) {
  await inserir(
    db,
    'pedido_itens_sap',
    ['ordem', 'item', 'cod_produto', 'denominacao', 'grupo', 'quantidade', 'unidade_venda',
      'valor_unitario', 'recusa', 'cod_recusa'],
    itens.map((i) => [
      txt(i.ordem), txt(i.item), txt(i.cod_produto), txt(i.denominacao), txt(i.grupo), num(i.quantidade),
      txt(i.unidade_venda), num(i.valor_unitario), txt(i.recusa), txt(i.cod_recusa),
    ]),
  );
}

/**
 * Pede ao servidor UMA ordem do SAP agora (cabecalho + itens) e grava no aparelho, sem esperar a sincronizacao.
 * Lanca erro com a mensagem do servidor se a ordem ainda nao aparece no SAP ou o SAP nao respondeu.
 */
export async function buscarOrdemNoSap(db: SQLiteDatabase, ordem: string): Promise<void> {
  const r = await api<{ pedido: Linha; itens: Linha[] }>(`/sync/ordem/${encodeURIComponent(ordem)}`, {
    method: 'POST',
    body: {},
    timeoutMs: 45_000,
  });
  await db.withTransactionAsync(async () => {
    await gravarPedidosSap(db, [r.pedido]);
    await db.runAsync('DELETE FROM pedido_itens_sap WHERE ordem = ?', [txt(r.pedido.ordem)]);
    await gravarItensSap(db, r.itens ?? []);
  });
}

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
        'limite_total', 'limite_disponivel', 'agrupado', 'dias_entrega', 'classe_risco', 'areas',
        'latitude', 'longitude', 'pedido_minimo', 'formas_pagamento', 'pagamento_antecipado'],
      r.clientes.map((c) => [
        txt(c.cod_cliente), txt(c.nome_fantasia), txt(c.razao_social), txt(c.cnpjcpf), txt(c.telefone),
        flag(c.bloqueado), json(c.endereco), num(c.limite_total), num(c.limite_disponivel),
        flag(c.agrupado), json(c.dias_entrega), json(c.classe_risco), json(c.areas),
        num(c.latitude), num(c.longitude), num(c.pedido_minimo), json(c.formas_pagamento), flag(c.pagamento_antecipado),
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

    await gravarPedidosSap(db, r.pedidos);
    await gravarItensSap(db, r.pedido_itens);

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

    // cadastros do painel (pequenos): o app substitui o que tem
    if (r.tipos_bonificacao) {
      await db.runAsync('DELETE FROM bonificacao_tipos');
      await inserir(db, 'bonificacao_tipos', ['codigo', 'descricao'], r.tipos_bonificacao.map((x) => [txt(x.codigo), txt(x.descricao)]));
    }
    if (r.centros_custo) {
      await db.runAsync('DELETE FROM centros_custo');
      await inserir(db, 'centros_custo', ['codigo', 'descricao'], r.centros_custo.map((x) => [txt(x.codigo), txt(x.descricao)]));
    }
    if (r.destaques) {
      await db.runAsync('DELETE FROM destaques');
      await inserir(
        db,
        'destaques',
        ['cod_produto', 'destaque', 'lancamento', 'ordem'],
        r.destaques.map((x) => [txt(x.cod_produto), flag(x.destaque), flag(x.lancamento), num(x.ordem) ?? 0]),
      );
    }
    if (r.incentivos) {
      await db.runAsync('DELETE FROM incentivos');
      await inserir(
        db,
        'incentivos',
        ['id', 'cod_produto', 'escopo', 'escopo_valor', 'linha_id', 'grupo_id', 'categoria_id', 'marca', 'qtd_minima', 'desconto_pct', 'desconto_extra_max_pct'],
        r.incentivos.map((x) => [
          txt(x.id), txt(x.cod_produto), txt(x.escopo), txt(x.escopo_valor),
          txt(x.linha_id), txt(x.grupo_id), txt(x.categoria_id), txt(x.marca), num(x.qtd_minima) ?? 0,
          num(x.desconto_pct) ?? 0, num(x.desconto_extra_max_pct) ?? 0,
        ]),
      );
    }

    if (r.avisos) {
      await db.runAsync('DELETE FROM avisos');
      await inserir(
        db,
        'avisos',
        ['id', 'titulo', 'mensagem', 'nivel', 'escopo', 'escopo_valor', 'vigencia_ini', 'vigencia_fim', 'atualizado_em'],
        r.avisos.map((x) => [txt(x.id), txt(x.titulo), txt(x.mensagem), txt(x.nivel) ?? 'info', txt(x.escopo) ?? 'geral', txt(x.escopo_valor), txt(x.vigencia_ini), txt(x.vigencia_fim), txt(x.updated_at)]),
      );
    }
    if (r.visita_perguntas) {
      await db.runAsync('DELETE FROM visita_perguntas');
      await inserir(
        db,
        'visita_perguntas',
        ['id', 'texto', 'tipo', 'opcoes', 'obrigatoria', 'escopo', 'escopo_valor', 'ordem'],
        r.visita_perguntas.map((x) => [txt(x.id), txt(x.texto), txt(x.tipo) ?? 'texto', txt(x.opcoes), flag(x.obrigatoria), txt(x.escopo) ?? 'geral', txt(x.escopo_valor), num(x.ordem) ?? 0]),
      );
    }

    if (r.feriados) {
      await db.runAsync('DELETE FROM feriados');
      await inserir(db, 'feriados', ['data', 'descricao', 'uf', 'cidade'], r.feriados.map((x) => [txt(x.data), txt(x.descricao), txt(x.uf), txt(x.cidade)]));
    }

    if (r.historico_mes) {
      await db.runAsync('DELETE FROM historico_mes');
      await inserir(db, 'historico_mes', ['cod_cliente', 'mes', 'valor', 'pedidos'], r.historico_mes.map((x) => [txt(x.cod_cliente), txt(x.mes), num(x.valor) ?? 0, num(x.pedidos) ?? 0]));
    }
    if (r.historico_produto) {
      await db.runAsync('DELETE FROM historico_produto');
      await inserir(
        db,
        'historico_produto',
        ['cod_cliente', 'cod_produto', 'denominacao', 'ultima_compra', 'pedidos', 'quantidade', 'unidade', 'meses_com_compra'],
        r.historico_produto.map((x) => [
          txt(x.cod_cliente), txt(x.cod_produto), txt(x.denominacao), txt(x.ultima_compra), num(x.pedidos) ?? 0,
          num(x.quantidade) ?? 0, txt(x.unidade), num(x.meses_com_compra) ?? 0,
        ]),
      );
    }
    if (Array.isArray(r.parametros?.status_cancelaveis)) {
      await gravarMeta(db, 'status_cancelaveis', JSON.stringify((r.parametros.status_cancelaveis as unknown[]).map(String)));
    }

    // visitas: o servidor e a autoridade sobre a validacao e a distancia; o que o aparelho ainda NAO enviou
    // (sincronizada = 0) nunca e sobrescrito. Visita de outro aparelho entra inteira.
    for (const x of r.visitas ?? []) {
      await db.runAsync(
        `INSERT INTO visitas (id, cod_cliente, data_visita, status, checkin_em, checkin_lat, checkin_lng, checkin_precisao_m, gps_falso,
                              distancia_m, fora_do_raio, sem_referencia, checkout_em, resultado, motivo_nao_venda, observacao, pedido_id,
                              validacao, validacao_obs, sincronizada)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status, checkout_em = excluded.checkout_em, resultado = excluded.resultado,
           motivo_nao_venda = excluded.motivo_nao_venda, pedido_id = excluded.pedido_id,
           distancia_m = excluded.distancia_m, fora_do_raio = excluded.fora_do_raio, sem_referencia = excluded.sem_referencia,
           validacao = excluded.validacao, validacao_obs = excluded.validacao_obs
         WHERE visitas.sincronizada = 1`,
        [
          txt(x.id), txt(x.cod_cliente), txt(x.data_visita), txt(x.status), txt(x.checkin_em), num(x.checkin_lat), num(x.checkin_lng),
          num(x.checkin_precisao_m), flag(x.checkin_gps_falso), num(x.distancia_m), flag(x.fora_do_raio), flag(x.sem_referencia),
          txt(x.checkout_em), txt(x.resultado), txt(x.motivo_nao_venda), txt(x.observacao), txt(x.pedido_id),
          txt(x.validacao), txt(x.validacao_obs),
        ],
      );
    }

    // pedidos criados no app: o servidor e a autoridade sobre status/codigo/ordens, mas NAO
    // conhece (e nao pode apagar) os itens e rascunhos locais -> upsert que preserva os itens
    for (const p of r.pedidos_app) {
      await db.runAsync(
        `INSERT INTO pedidos_app (id, codigo, cod_cliente, status, criado_em, dt_entrega, ordens_sap, erro,
                                  tentativas, enviado_em, duplicado_de, atualizado_em,
                                  tipo, tipo_bonificacao, centro_custo, justificativa, motivo_rejeicao)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           codigo = excluded.codigo, status = excluded.status, dt_entrega = excluded.dt_entrega,
           ordens_sap = excluded.ordens_sap, erro = excluded.erro, tentativas = excluded.tentativas,
           enviado_em = excluded.enviado_em, atualizado_em = excluded.atualizado_em,
           tipo = excluded.tipo, tipo_bonificacao = excluded.tipo_bonificacao, centro_custo = excluded.centro_custo,
           justificativa = excluded.justificativa, motivo_rejeicao = excluded.motivo_rejeicao`,
        [
          txt(p.id), txt(p.codigo), txt(p.cod_cliente), txt(p.status), txt(p.recebido_em), txt(p.dt_entrega),
          json(p.ordens_sap), txt(p.erro), num(p.tentativas) ?? 0, txt(p.enviado_sap_em), txt(p.duplicado_de),
          txt(p.updated_at),
          txt(p.tipo) ?? 'venda', txt(p.tipo_bonificacao), txt(p.centro_custo), txt(p.justificativa), txt(p.motivo_rejeicao),
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
