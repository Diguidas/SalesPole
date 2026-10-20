-- Avisos do painel para os vendedores: aparecem num pop-up quando o vendedor abre o app.
--  * escopo: geral (todos) | vendedor | escritorio | canal; escopo_valor aceita varios codigos separados por virgula
--    (escritorio e canal valem para o vendedor que tem cliente naquele escritorio/canal)
--  * nivel: info | importante | urgente (muda a cor e o icone do pop-up)
--  * vigencia: o aviso so aparece de vigencia_ini ate vigencia_fim (vazio = sem limite)

create table if not exists avisos (
  id           uuid primary key default gen_random_uuid(),
  titulo       text not null check (char_length(trim(titulo)) between 3 and 80),
  mensagem     text not null check (char_length(trim(mensagem)) between 3 and 1000),
  nivel        text not null default 'info' check (nivel in ('info', 'importante', 'urgente')),
  escopo       text not null default 'geral' check (escopo in ('geral', 'vendedor', 'escritorio', 'canal')),
  escopo_valor text,
  vigencia_ini date,
  vigencia_fim date,
  ativo        boolean not null default true,
  criado_por   text,
  updated_at   timestamptz not null default now(),
  check (escopo = 'geral' or char_length(trim(coalesce(escopo_valor, ''))) > 0),
  check (vigencia_ini is null or vigencia_fim is null or vigencia_fim >= vigencia_ini)
);
alter table avisos enable row level security;
