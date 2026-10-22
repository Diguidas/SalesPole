import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Banco local (SQLite) do app: espelho da carteira do vendedor + fila de pedidos.
 * Versionado por PRAGMA user_version: para mudar o schema, acrescente um bloco
 * `if (v < N)` abaixo; nunca edite um bloco ja publicado.
 *
 * Campos estruturados (endereco, areas, dias_entrega...) ficam como JSON em TEXT.
 * Datas como 'AAAA-MM-DD' (TEXT) e booleanos como 0/1.
 */
const V1 = `
CREATE TABLE IF NOT EXISTS meta (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS carteira (
  cod_cliente TEXT NOT NULL,
  dia_semana  INTEGER NOT NULL,           -- 1=seg ... 7=dom
  sequencia   INTEGER NOT NULL,
  PRIMARY KEY (cod_cliente, dia_semana)
);

CREATE TABLE IF NOT EXISTS clientes (
  cod_cliente       TEXT PRIMARY KEY,
  nome_fantasia     TEXT,
  razao_social      TEXT,
  cnpjcpf           TEXT,
  telefone          TEXT,
  bloqueado         INTEGER NOT NULL DEFAULT 0,
  endereco          TEXT,                  -- JSON {logradouro,bairro,cidade,uf,cep}
  limite_total      REAL,
  limite_disponivel REAL,
  agrupado          INTEGER NOT NULL DEFAULT 0,
  dias_entrega      TEXT,                  -- JSON [1..7]
  classe_risco      TEXT,                  -- JSON {codigo,descricao}
  areas             TEXT                   -- JSON [{vkorg,tipo_material,centro,lista_preco,rede,...}]
);

CREATE TABLE IF NOT EXISTS produtos (
  cod_produto   TEXT PRIMARY KEY,
  descricao     TEXT,
  tipo          TEXT,
  unidade       TEXT,
  ean           TEXT,
  ncm           TEXT,
  validade      TEXT,
  tipo_material TEXT,
  dados         TEXT                       -- JSON {estoque,peso,pedido,classificacao}
);

CREATE TABLE IF NOT EXISTS precos_lista (
  pltyp TEXT NOT NULL, cod_produto TEXT NOT NULL, datab TEXT NOT NULL, datbi TEXT NOT NULL,
  kbetr REAL, kpein REAL, kmein TEXT, konwa TEXT, krech TEXT, preco_kg REAL,
  PRIMARY KEY (pltyp, cod_produto, datab)
);

CREATE TABLE IF NOT EXISTS precos_grupo (
  pltyp TEXT NOT NULL, kdgrp TEXT NOT NULL, cod_produto TEXT NOT NULL, datab TEXT NOT NULL, datbi TEXT NOT NULL,
  kbetr REAL, kpein REAL, kmein TEXT, konwa TEXT, krech TEXT, preco_kg REAL,
  PRIMARY KEY (pltyp, kdgrp, cod_produto, datab)
);

CREATE TABLE IF NOT EXISTS estoque (
  centro TEXT NOT NULL, cod_produto TEXT NOT NULL, quantidade REAL NOT NULL, unidade_base TEXT,
  PRIMARY KEY (centro, cod_produto)
);

CREATE TABLE IF NOT EXISTS pedidos_sap (
  ordem TEXT PRIMARY KEY,
  cod_cliente TEXT NOT NULL,
  tp_ped TEXT, dt_criacao TEXT, dt_entrega TEXT, valor REAL, status TEXT, refaturado TEXT,
  pedido_externo TEXT, plataforma TEXT,
  notas TEXT                               -- JSON [{nota_fiscal,serie,danfe_url,xml_url,boleto_url}]
);
CREATE INDEX IF NOT EXISTS ix_pedidos_sap_cliente ON pedidos_sap (cod_cliente, dt_criacao DESC);

CREATE TABLE IF NOT EXISTS pedido_itens_sap (
  ordem TEXT NOT NULL, item TEXT NOT NULL, cod_produto TEXT, denominacao TEXT, grupo TEXT,
  quantidade REAL, unidade_venda TEXT, valor_unitario REAL, recusa TEXT, cod_recusa TEXT,
  PRIMARY KEY (ordem, item)
);

CREATE TABLE IF NOT EXISTS titulos (
  cod_cliente TEXT NOT NULL, nfe TEXT NOT NULL, parcela TEXT NOT NULL,
  status TEXT, valor REAL, vencimento TEXT, dt_compensacao TEXT, ordem TEXT,
  danfe_url TEXT, boleto_url TEXT,
  PRIMARY KEY (cod_cliente, nfe, parcela)
);
CREATE INDEX IF NOT EXISTS ix_titulos_cliente ON titulos (cod_cliente, status);

CREATE TABLE IF NOT EXISTS remessas (
  ordem TEXT NOT NULL, item TEXT NOT NULL, data_remessa TEXT NOT NULL, cod_cliente TEXT NOT NULL,
  tp_ped TEXT, cod_produto TEXT, denominacao TEXT, unidade_venda TEXT,
  quantidade_pedida REAL, quantidade_confirmada REAL, peso REAL,
  PRIMARY KEY (ordem, item, data_remessa)
);
CREATE INDEX IF NOT EXISTS ix_remessas_data ON remessas (data_remessa);

-- Pedidos criados no app. 'id' (UUID) e gerado AQUI, offline, e e a chave de idempotencia.
-- status: rascunho | pendente (aguardando envio) | recebido | enviando | parcial | enviado | erro
CREATE TABLE IF NOT EXISTS pedidos_app (
  id                   TEXT PRIMARY KEY,
  codigo               TEXT,               -- sequencial definitivo, atribuido pelo servidor
  cod_cliente          TEXT NOT NULL,
  status               TEXT NOT NULL,
  criado_em            TEXT NOT NULL,
  dt_entrega           TEXT,
  cond_pagamento       TEXT,
  ordem_compra_cliente TEXT,
  endereco_entrega     TEXT,
  observacao           TEXT,
  itens                TEXT NOT NULL DEFAULT '[]',   -- JSON [{produto,unidade,quantidade,preco}]
  duplicado_de         TEXT,
  ordens_sap           TEXT,                          -- JSON [{ordem,tipo_material,vkorg}]
  erro                 TEXT,
  tentativas           INTEGER NOT NULL DEFAULT 0,
  enviado_em           TEXT,
  atualizado_em        TEXT
);
CREATE INDEX IF NOT EXISTS ix_pedidos_app_cliente ON pedidos_app (cod_cliente, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_pedidos_app_status ON pedidos_app (status);
`;

export const TABELAS_DE_DADOS = [
  'carteira',
  'clientes',
  'produtos',
  'precos_lista',
  'precos_grupo',
  'estoque',
  'pedidos_sap',
  'pedido_itens_sap',
  'titulos',
  'remessas',
  'pedidos_app',
  'bonificacao_tipos',
  'centros_custo',
  'destaques',
  'incentivos',
  'combos',
  'feriados',
  'visita_perguntas',
  'avisos',
  'avisos_lidos',
  'visita_fotos',
  'visitas',
  'historico_mes',
  'historico_produto',
] as const;

/** Migracoes em andamento por arquivo de banco: duas chamadas ao mesmo tempo (o React pode repetir o onInit do SQLiteProvider) esperam a mesma. */
const migrando = new Map<string, Promise<void>>();

export function migrar(db: SQLiteDatabase): Promise<void> {
  const chave = db.databasePath;
  const andamento = migrando.get(chave);
  if (andamento) return andamento;
  const p = executarMigracoes(db).finally(() => migrando.delete(chave));
  migrando.set(chave, p);
  return p;
}

async function executarMigracoes(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const v = row?.user_version ?? 0;

  if (v < 1) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(V1);
      await db.execAsync('PRAGMA user_version = 1');
    });
  }
  if (v < 2) {
    // desconto maximo (%) por item de preco; so existe a partir da v2
    await db.withTransactionAsync(async () => {
      await db.execAsync('ALTER TABLE precos_lista ADD COLUMN desconto_max REAL NOT NULL DEFAULT 0');
      await db.execAsync('ALTER TABLE precos_grupo ADD COLUMN desconto_max REAL NOT NULL DEFAULT 0');
      await db.execAsync('PRAGMA user_version = 2');
    });
  }
  if (v < 3) {
    // o servidor entregava so as primeiras 1000 linhas de cada lista: refaz o pull do zero uma vez
    await db.withTransactionAsync(async () => {
      await db.execAsync("DELETE FROM meta WHERE chave = 'cursor'");
      await db.execAsync('PRAGMA user_version = 3');
    });
  }
  if (v < 4) {
    // localizacao, pedido minimo e formas de pagamento do cliente; refaz o pull do zero para preencher
    await db.withTransactionAsync(async () => {
      await db.execAsync('ALTER TABLE clientes ADD COLUMN latitude REAL');
      await db.execAsync('ALTER TABLE clientes ADD COLUMN longitude REAL');
      await db.execAsync('ALTER TABLE clientes ADD COLUMN pedido_minimo REAL');
      await db.execAsync('ALTER TABLE clientes ADD COLUMN formas_pagamento TEXT');
      await db.execAsync("DELETE FROM meta WHERE chave = 'cursor'");
      await db.execAsync('PRAGMA user_version = 4');
    });
  }
  if (v < 5) {
    // bonificacao (tipo, centro de custo, justificativa, aprovacao) e cadastros do painel web
    await db.withTransactionAsync(async () => {
      await db.execAsync("ALTER TABLE pedidos_app ADD COLUMN tipo TEXT NOT NULL DEFAULT 'venda'");
      await db.execAsync('ALTER TABLE pedidos_app ADD COLUMN tipo_bonificacao TEXT');
      await db.execAsync('ALTER TABLE pedidos_app ADD COLUMN centro_custo TEXT');
      await db.execAsync('ALTER TABLE pedidos_app ADD COLUMN justificativa TEXT');
      await db.execAsync('ALTER TABLE pedidos_app ADD COLUMN motivo_rejeicao TEXT');
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS bonificacao_tipos (codigo TEXT PRIMARY KEY, descricao TEXT);
        CREATE TABLE IF NOT EXISTS centros_custo (codigo TEXT PRIMARY KEY, descricao TEXT);
        CREATE TABLE IF NOT EXISTS destaques (
          cod_produto TEXT PRIMARY KEY, destaque INTEGER NOT NULL DEFAULT 0, lancamento INTEGER NOT NULL DEFAULT 0,
          ordem INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS incentivos (
          id TEXT PRIMARY KEY, cod_produto TEXT, escopo TEXT NOT NULL, escopo_valor TEXT,
          qtd_minima REAL NOT NULL, desconto_pct REAL NOT NULL, desconto_extra_max_pct REAL NOT NULL DEFAULT 0
        );
      `);
      await db.execAsync('PRAGMA user_version = 5');
    });
  }
  if (v < 6) {
    // desconto por incentivo tambem por linha, grupo, categoria e marca do produto
    await db.withTransactionAsync(async () => {
      for (const c of ['linha', 'grupo', 'categoria', 'marca']) {
        await db.execAsync(`ALTER TABLE incentivos ADD COLUMN ${c} TEXT`);
      }
      await db.execAsync('PRAGMA user_version = 6');
    });
  }
  if (v < 7) {
    // incentivo por ID de linha/grupo/categoria (os textos da v6 ficam sem uso) e feriados (calendario de entrega)
    await db.withTransactionAsync(async () => {
      for (const c of ['linha_id', 'grupo_id', 'categoria_id']) {
        await db.execAsync(`ALTER TABLE incentivos ADD COLUMN ${c} TEXT`);
      }
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS feriados (data TEXT NOT NULL, descricao TEXT, uf TEXT, cidade TEXT);
        CREATE INDEX IF NOT EXISTS ix_feriados_data ON feriados (data);
      `);
      await db.execAsync('PRAGMA user_version = 7');
    });
  }
  if (v < 8) {
    // cliente com pagamento antecipado (forma 'V'): sem credito
    await db.withTransactionAsync(async () => {
      await db.execAsync('ALTER TABLE clientes ADD COLUMN pagamento_antecipado INTEGER NOT NULL DEFAULT 0');
      await db.execAsync('PRAGMA user_version = 8');
    });
  }
  if (v < 9) {
    // roteiro de visita: check-in com GPS + foto de fachada + resultado (offline; sobe depois)
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS visitas (
          id TEXT PRIMARY KEY, cod_cliente TEXT NOT NULL, data_visita TEXT NOT NULL,
          status TEXT NOT NULL, checkin_em TEXT NOT NULL,
          checkin_lat REAL, checkin_lng REAL, checkin_precisao_m REAL, gps_falso INTEGER NOT NULL DEFAULT 0,
          distancia_m INTEGER, fora_do_raio INTEGER NOT NULL DEFAULT 0, sem_referencia INTEGER NOT NULL DEFAULT 0,
          checkout_em TEXT, resultado TEXT, motivo_nao_venda TEXT, observacao TEXT, pedido_id TEXT,
          validacao TEXT, validacao_obs TEXT,
          sincronizada INTEGER NOT NULL DEFAULT 0,   -- 0 = precisa enviar | 1 = enviada | 2 = recusada pelo servidor
          erro_envio TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_visitas_dia ON visitas (data_visita, cod_cliente);
        CREATE TABLE IF NOT EXISTS visita_fotos (
          id TEXT PRIMARY KEY, visita_id TEXT NOT NULL, tipo TEXT NOT NULL, uri TEXT NOT NULL, tirada_em TEXT NOT NULL,
          lat REAL, lng REAL, tamanho_bytes INTEGER, enviada INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS ix_visita_fotos_visita ON visita_fotos (visita_id);
      `);
      await db.execAsync('PRAGMA user_version = 9');
    });
  }
  if (v < 10) {
    // historico de 12 meses: so totais prontos (o servidor guarda os pedidos antigos; o app nao baixa)
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS historico_mes (
          cod_cliente TEXT NOT NULL, mes TEXT NOT NULL, valor REAL NOT NULL DEFAULT 0, pedidos INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (cod_cliente, mes)
        );
        CREATE TABLE IF NOT EXISTS historico_produto (
          cod_cliente TEXT NOT NULL, cod_produto TEXT NOT NULL, denominacao TEXT, ultima_compra TEXT,
          pedidos INTEGER NOT NULL DEFAULT 0, quantidade REAL NOT NULL DEFAULT 0, unidade TEXT, meses_com_compra INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (cod_cliente, cod_produto)
        );
      `);
      await db.execAsync('PRAGMA user_version = 10');
    });
  }
  if (v < 11) {
    // perguntas da visita (cadastradas no painel) e as respostas do vendedor (JSON na propria visita)
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS visita_perguntas (
          id TEXT PRIMARY KEY, texto TEXT NOT NULL, tipo TEXT NOT NULL, opcoes TEXT, obrigatoria INTEGER NOT NULL DEFAULT 0,
          escopo TEXT NOT NULL DEFAULT 'geral', escopo_valor TEXT, ordem INTEGER NOT NULL DEFAULT 0
        );
      `);
      await db.execAsync('ALTER TABLE visitas ADD COLUMN respostas TEXT');
      await db.execAsync('PRAGMA user_version = 11');
    });
  }
  if (v < 12) {
    // avisos do painel (pop-up ao abrir o app) e quais o vendedor ja leu neste aparelho
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS avisos (
          id TEXT PRIMARY KEY, titulo TEXT NOT NULL, mensagem TEXT NOT NULL, nivel TEXT NOT NULL DEFAULT 'info',
          escopo TEXT NOT NULL DEFAULT 'geral', escopo_valor TEXT, vigencia_ini TEXT, vigencia_fim TEXT, atualizado_em TEXT
        );
        CREATE TABLE IF NOT EXISTS avisos_lidos (id TEXT PRIMARY KEY, atualizado_em TEXT, lido_em TEXT NOT NULL);
      `);
      await db.execAsync('PRAGMA user_version = 12');
    });
  }
  if (v < 13) {
    // combos do painel (tela Desconto): condicao (itens, em JSON) + beneficio (brinde ou desconto)
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS combos (
          id TEXT PRIMARY KEY, nome TEXT NOT NULL, escopo TEXT NOT NULL DEFAULT 'geral', escopo_valor TEXT, beneficio TEXT NOT NULL,
          brinde_cod_produto TEXT, brinde_qtd REAL, desconto_pct REAL, desconto_extra_max_pct REAL NOT NULL DEFAULT 0,
          repete INTEGER NOT NULL DEFAULT 0, max_repeticoes INTEGER, itens TEXT NOT NULL DEFAULT '[]'
        );
      `);
      await db.execAsync('PRAGMA user_version = 13');
    });
  }
  if (v < 14) {
    // item do SAP: situacao (ex.: Atendido Parcialmente) e o que foi faturado de fato
    await db.withTransactionAsync(async () => {
      await db.execAsync('ALTER TABLE pedido_itens_sap ADD COLUMN situacao TEXT');
      await db.execAsync('ALTER TABLE pedido_itens_sap ADD COLUMN qtd_faturada REAL');
      await db.execAsync('ALTER TABLE pedido_itens_sap ADD COLUMN valor_faturado REAL');
      await db.execAsync('PRAGMA user_version = 14');
    });
  }
  if (v < 15) {
    // combos com faixas (beneficio por degrau de caixas), em JSON
    await db.withTransactionAsync(async () => {
      await db.execAsync("ALTER TABLE combos ADD COLUMN faixas TEXT NOT NULL DEFAULT '[]'");
      await db.execAsync('PRAGMA user_version = 15');
    });
  }
}
