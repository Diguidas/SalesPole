-- Solicitacoes de cadastro/alteracao/exclusao de cliente feitas no app. Por enquanto so ficam guardadas aqui
-- (o envio para a Salesforce vem depois): o painel lista e mostra o detalhe.
--  * cadastro_cliente : vendedor (formulario completo em dados)
--  * aumento_limite | alteracao_pagamento | agrupamento | exclusao : supervisor
-- Arquivos (comprovante de endereco da pessoa fisica) ficam no bucket PRIVADO 'solicitacoes-anexos', criado pela API.

create table if not exists solicitacoes (
  id                  uuid primary key default gen_random_uuid(),
  tipo                text not null check (tipo in ('cadastro_cliente', 'aumento_limite', 'alteracao_pagamento', 'agrupamento', 'exclusao')),
  status              text not null default 'recebida' check (status in ('recebida', 'enviada', 'erro')),
  dados               jsonb not null default '{}',
  documento           text,                 -- CNPJ/CPF so com digitos (cadastro_cliente)
  cod_cliente         text,                 -- cliente alvo (alteracao/exclusao)
  cod_vendedor        text,
  vendedor_nome       text,
  supervisor_nome     text,
  supervisor_email    text,
  criado_por          text not null,        -- e-mail do login que enviou
  comprovante_caminho text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists solicitacoes_tipo_idx on solicitacoes (tipo, created_at desc);
create index if not exists solicitacoes_vendedor_idx on solicitacoes (cod_vendedor);
create index if not exists solicitacoes_documento_idx on solicitacoes (documento) where documento is not null;
alter table solicitacoes enable row level security;

-- Listas editaveis no painel que alimentam os formularios (prazo de pagamento do cadastro, motivo de exclusao).
create table if not exists prazos_pagamento (
  id         uuid primary key default gen_random_uuid(),
  codigo     text,
  descricao  text not null check (char_length(trim(descricao)) between 1 and 80),
  ordem      integer not null default 0,
  ativo      boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table prazos_pagamento enable row level security;

create table if not exists motivos_exclusao (
  id         uuid primary key default gen_random_uuid(),
  descricao  text not null check (char_length(trim(descricao)) between 1 and 80),
  ordem      integer not null default 0,
  ativo      boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table motivos_exclusao enable row level security;

-- Valores distintos que ja existem nos clientes do SAP (organizacao de vendas, canal, tipo de estabelecimento, rede, escritorio).
create or replace function fn_opcoes_cliente()
returns table (campo text, codigo text, descricao text)
language sql stable as $$
  select distinct 'vkorg'::text, a->>'vkorg', a->>'vkorg'
    from clientes c, jsonb_array_elements(c.areas) a where coalesce(a->>'vkorg', '') <> ''
  union
  select distinct 'canal', a #>> '{canal,codigo}', coalesce(a #>> '{canal,descricao}', a #>> '{canal,codigo}')
    from clientes c, jsonb_array_elements(c.areas) a where coalesce(a #>> '{canal,codigo}', '') <> ''
  union
  select distinct 'tipo_estabelecimento', a #>> '{tipo_estabelecimento,codigo}', coalesce(a #>> '{tipo_estabelecimento,descricao}', a #>> '{tipo_estabelecimento,codigo}')
    from clientes c, jsonb_array_elements(c.areas) a where coalesce(a #>> '{tipo_estabelecimento,codigo}', '') <> ''
  union
  select distinct 'rede', a #>> '{rede,codigo}', coalesce(a #>> '{rede,descricao}', a #>> '{rede,codigo}')
    from clientes c, jsonb_array_elements(c.areas) a where coalesce(a #>> '{rede,codigo}', '') <> ''
$$;
