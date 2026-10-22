-- Paineis de BI (Power BI) que abrem dentro do painel e/ou do app. O link e cadastrado no painel (Cadastros > Paineis de BI).
create table if not exists bi_paineis (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (char_length(trim(nome)) between 1 and 60),
  url        text not null check (url ~* '^https://' and char_length(url) <= 1000),
  onde       text not null default 'painel' check (onde in ('painel', 'app', 'ambos')),
  ordem      integer not null default 0,
  ativo      boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table bi_paineis enable row level security;
