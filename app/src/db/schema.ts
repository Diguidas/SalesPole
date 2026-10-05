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
] as const;

export async function migrar(db: SQLiteDatabase): Promise<void> {
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
}
