-- Sincronizacao manual pedida pelo painel (Monitor): uma linha por carteira (rota) e pedido.
-- Guarda o andamento e o historico (quem pediu, quanto levou, o que deu erro).
create table if not exists sincronizacoes_painel (
  id            bigserial primary key,
  rota          text not null,
  cod_vendedor  text not null,
  nome          text,
  recursos      text[] not null,
  status        text not null default 'fila' check (status in ('fila', 'rodando', 'ok', 'erro')),
  etapa         text,
  etapas        jsonb not null default '[]'::jsonb,
  erro          text,
  pedido_por    text,
  criado_em     timestamptz not null default now(),
  iniciado_em   timestamptz,
  terminou_em   timestamptz
);
create index if not exists sincronizacoes_painel_criado_idx on sincronizacoes_painel (criado_em desc);
create index if not exists sincronizacoes_painel_status_idx on sincronizacoes_painel (status) where status in ('fila', 'rodando');
alter table sincronizacoes_painel enable row level security;
