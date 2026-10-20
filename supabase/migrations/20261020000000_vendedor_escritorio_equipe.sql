-- Escritorio e equipe de vendas do vendedor (SAP ZSDT005: VKBUR / VKGRP). Base da ligacao supervisor -> vendedor
-- (supervisor: ZSDT087, por escritorio + equipe).
alter table vendedores add column if not exists escritorio text;
alter table vendedores add column if not exists equipe     text;
create index if not exists vendedores_escritorio_equipe_idx on vendedores (escritorio, equipe);

-- Supervisores vigentes (SAP ZSDT087): um supervisor por escritorio + equipe de vendas, com o gerente dele.
-- vendedor -> (escritorio, equipe) -> supervisor -> gerente. Importada pelo painel junto com os vendedores.
create table if not exists supervisores (
  cod_supervisor text not null,
  escritorio     text not null,
  equipe         text not null,
  nome           text,
  cod_gerente    text,
  gerente_nome   text,
  dt_inicio      date,
  dt_fim         date,
  synced_at      timestamptz not null default now(),
  primary key (cod_supervisor, escritorio, equipe)
);
create index if not exists supervisores_escritorio_equipe_idx on supervisores (escritorio, equipe);
create index if not exists supervisores_gerente_idx on supervisores (cod_gerente);
alter table supervisores enable row level security;
