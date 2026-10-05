-- =====================================================================
-- Sales Pole - schema inicial
--
-- Acesso: SOMENTE o NestJS, com a service role key. Todas as tabelas
-- ficam com RLS ligada e sem policies, entao anon/authenticated nao leem
-- nada diretamente. A regra de carteira (vendedor so ve os clientes dele)
-- e aplicada no NestJS.
--
-- Tabelas espelho do SAP tem updated_at mantido por trigger apenas quando
-- o conteudo realmente muda; assim o "pull ?since=" do app so traz delta
-- de verdade, mesmo com o sync fazendo upsert de tudo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Trigger de updated_at (so avanca se algo mudou)
-- ---------------------------------------------------------------------
create or replace function fn_touch_updated_at() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'synced_at')
     is distinct from (to_jsonb(old) - 'updated_at' - 'synced_at') then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Vendedores e vinculo com o login Microsoft (Azure)
-- ---------------------------------------------------------------------
create table vendedores (
  cod_vendedor text primary key,
  nome         text,
  documento    text,
  rota         text,
  synced_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- vinculo e-mail (Azure) -> codigo do vendedor; cadastrado pelo painel.
-- Sem FK em vendedores: o vendedor so aparece la depois do primeiro sync.
create table usuarios_vendedor (
  email        text primary key check (email = lower(email)),
  cod_vendedor text not null,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now()
);
create index on usuarios_vendedor (cod_vendedor);

-- carteira: cliente x dia da semana (1=seg..7=dom) x sequencia de visita
create table rota_clientes (
  rota        text not null,
  cod_cliente text not null,
  dia_semana  smallint not null,
  sequencia   integer not null,
  synced_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (rota, cod_cliente, dia_semana)
);
create index on rota_clientes (cod_cliente);

-- ---------------------------------------------------------------------
-- Espelho do SAP
-- ---------------------------------------------------------------------
create table clientes (
  cod_cliente        text primary key,
  nome_fantasia      text,
  razao_social       text,
  cnpjcpf            text,
  telefone           text,
  bloqueado          boolean not null default false,
  endereco           jsonb,                 -- logradouro, bairro, cidade, uf, cep
  limite_total       numeric(15,2),
  limite_disponivel  numeric(15,2),
  agrupado           boolean not null default false,
  dias_entrega       smallint[] not null default '{1,2,3,4,5,6}',  -- 1=seg..7=dom
  classe_risco       jsonb,                 -- {codigo, descricao}
  areas              jsonb not null default '[]',  -- por org de vendas: tipo_material, centro, lista_preco, rede, cond_pagamento...
  synced_at          timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table produtos (
  cod_produto   text primary key,
  descricao     text,
  tipo          text,
  unidade       text,
  ean           text,
  ncm           text,
  validade      text,
  tipo_material text,                       -- FERT | HAWA | ZVAR
  dados         jsonb not null default '{}', -- estoque/peso/pedido/classificacao como veio do SAP
  synced_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- A913: lista de preco x material
create table precos_lista (
  pltyp      text not null,
  cod_produto text not null,
  datab      date not null,
  datbi      date not null,
  kbetr      numeric(15,2),
  kpein      numeric,
  kmein      text,
  konwa      text,
  krech      text,
  preco_kg   numeric(15,4),
  synced_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (pltyp, cod_produto, datab)
);

-- A912: lista de preco x grupo de cliente x material (tem prioridade sobre A913)
create table precos_grupo (
  pltyp      text not null,
  kdgrp      text not null,
  cod_produto text not null,
  datab      date not null,
  datbi      date not null,
  kbetr      numeric(15,2),
  kpein      numeric,
  kmein      text,
  konwa      text,
  krech      text,
  preco_kg   numeric(15,4),
  synced_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (pltyp, kdgrp, cod_produto, datab)
);

-- MARD-LABST do deposito CD por centro
create table estoque (
  centro       text not null,
  cod_produto  text not null,
  quantidade   numeric(15,3) not null,
  unidade_base text,
  synced_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (centro, cod_produto)
);

-- pedidos como existem no SAP (ordens de venda)
create table pedidos_sap (
  ordem          text primary key,
  cod_cliente    text not null,
  tp_ped         text,
  dt_criacao     date,
  dt_entrega     date,
  valor          numeric(15,2),
  status         text,
  refaturado     text,
  pedido_externo text,                      -- codigo interno do app quando a ordem veio dele
  plataforma     text,
  notas          jsonb not null default '[]',
  synced_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on pedidos_sap (cod_cliente, dt_criacao desc);
create index on pedidos_sap (pedido_externo) where pedido_externo is not null;

create table pedido_itens_sap (
  ordem          text not null references pedidos_sap (ordem) on delete cascade,
  item           text not null,
  cod_produto    text,
  denominacao    text,
  grupo          text,
  quantidade     numeric(15,3),
  unidade_venda  text,
  valor_unitario numeric(15,4),
  recusa         text,
  cod_recusa     text,
  synced_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (ordem, item)
);

create table titulos (
  cod_cliente    text not null,
  nfe            text not null,
  parcela        text not null,
  status         text,                      -- Em aberto | Atrasado | Compensado
  valor          numeric(15,2),
  vencimento     date,
  dt_compensacao date,
  ordem          text,
  danfe_url      text,
  boleto_url     text,
  synced_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (cod_cliente, nfe, parcela)
);
create index on titulos (cod_cliente, vencimento);

-- o que vai ser entregue (linhas de remessa abertas)
create table remessas (
  ordem                 text not null,
  item                  text not null,
  data_remessa          date not null,
  cod_cliente           text not null,
  tp_ped                text,
  cod_produto           text,
  denominacao           text,
  unidade_venda         text,
  quantidade_pedida     numeric(15,3),
  quantidade_confirmada numeric(15,3),
  peso                  numeric(15,3),
  synced_at             timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (ordem, item, data_remessa)
);
create index on remessas (cod_cliente, data_remessa);

-- ---------------------------------------------------------------------
-- Pedidos criados no app
-- ---------------------------------------------------------------------
-- Sequencial global atribuido SO no servidor (nao ha numero offline).
create sequence pedido_codigo_seq start 1;

create table pedidos_app (
  id               uuid primary key,        -- gerado no celular: chave de idempotencia
  codigo_interno   bigint not null unique default nextval('pedido_codigo_seq'),
  codigo           text generated always as (lpad(codigo_interno::text, 7, '0')) stored,
  cod_vendedor     text not null,
  cod_cliente      text not null,
  criado_no_app_em timestamptz not null,    -- relogio do aparelho (informativo)
  dt_entrega       date,
  cond_pagamento   text,
  ordem_compra_cliente text,
  endereco_entrega text,
  observacao       text,
  itens            jsonb not null,          -- [{produto, unidade, quantidade, preco}]
  itens_hash       text not null,           -- cliente + itens normalizados (detecta duplicidade)
  duplicado_de     uuid references pedidos_app (id),  -- botao "duplicar pedido"
  status           text not null default 'recebido'
                   check (status in ('recebido','enviando','enviado','erro','parcial')),
  ordens_sap       jsonb not null default '[]',  -- [{ordem, tipo_material, vkorg}]
  erro             text,
  tentativas       integer not null default 0,
  proxima_tentativa_em timestamptz,
  recebido_em      timestamptz not null default now(),   -- carimbado pelo servidor
  enviado_sap_em   timestamptz,                          -- carimbado pelo servidor
  updated_at       timestamptz not null default now()
);
create index on pedidos_app (cod_vendedor, recebido_em desc);
create index on pedidos_app (cod_cliente, recebido_em desc);
create index on pedidos_app (status, proxima_tentativa_em) where status in ('recebido','erro','parcial');
create index on pedidos_app (itens_hash);

create table pedido_eventos (
  id         bigserial primary key,
  pedido_id  uuid not null references pedidos_app (id) on delete cascade,
  tipo       text not null,                 -- recebido | tentativa_sap | sucesso | erro | ...
  detalhe    jsonb,
  criado_em  timestamptz not null default now()
);
create index on pedido_eventos (pedido_id, criado_em);

-- Painel web: possiveis duplicidades = mesmo cliente + mesmos itens em < 24h
-- sem vinculo "duplicado_de" (duplicacao consciente fica marcada).
create view v_pedidos_possivel_duplicidade as
select a.id            as pedido_a,
       a.codigo        as codigo_a,
       b.id            as pedido_b,
       b.codigo        as codigo_b,
       a.cod_cliente,
       a.cod_vendedor,
       b.recebido_em - a.recebido_em as intervalo,
       (b.duplicado_de = a.id or a.duplicado_de = b.id) as duplicacao_consciente
from pedidos_app a
join pedidos_app b
  on  b.cod_cliente = a.cod_cliente
  and b.itens_hash  = a.itens_hash
  and b.recebido_em > a.recebido_em
  and b.recebido_em - a.recebido_em < interval '24 hours';

-- ---------------------------------------------------------------------
-- Estado dos jobs de sincronizacao
-- ---------------------------------------------------------------------
create table sync_estado (
  recurso        text not null,
  escopo         text not null default '*',  -- ex.: rota
  ultimo_sucesso timestamptz,
  ultimo_erro    text,
  ultimo_erro_em timestamptz,
  primary key (recurso, escopo)
);

-- ---------------------------------------------------------------------
-- Triggers de updated_at nas tabelas espelho
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'vendedores','rota_clientes','clientes','produtos','precos_lista',
    'precos_grupo','estoque','pedidos_sap','pedido_itens_sap','titulos','remessas'
  ] loop
    execute format(
      'create trigger trg_touch before update on %I
         for each row execute function fn_touch_updated_at()', t);
  end loop;
end $$;

create or replace function fn_touch_updated_at_simples() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_touch before update on pedidos_app
  for each row execute function fn_touch_updated_at_simples();

-- ---------------------------------------------------------------------
-- Consultas de pull (carteira por rota) - o NestJS chama via rpc()
-- ---------------------------------------------------------------------
create or replace function fn_clientes_da_rota(p_rota text, p_since timestamptz default null)
returns setof clientes
language sql stable as $$
  select c.*
  from clientes c
  where c.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
    and (p_since is null or c.updated_at > p_since);
$$;

-- Cursor do pull: hora do banco menos uma margem (transacoes em voo que
-- commitam depois nao ficam de fora; repetir linha no pull e inofensivo).
create or replace function fn_cursor_pull() returns timestamptz
language sql stable as $$
  select now() - interval '5 seconds';
$$;

-- ---------------------------------------------------------------------
-- RLS: ligada em tudo, sem policies (so service role acessa)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
