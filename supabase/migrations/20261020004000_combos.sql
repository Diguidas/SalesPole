-- Combos de desconto (tela "Desconto" do painel, ao lado do incentivo por quantidade).
-- Um combo tem uma CONDICAO (lista de itens que o pedido precisa ter, cada um com a quantidade minima em caixas)
-- e um BENEFICIO:
--   produto_gratis : o cliente ganha brinde_qtd caixas do produto brinde (vai ao SAP como item de preco zero)
--   desconto_pct   : desconto em % sobre os itens da condicao
-- repete = true: cada combo completo dentro do pedido repete o beneficio (ate max_repeticoes, se informado).
-- O vendedor pode ajustar o desconto ate desconto_extra_max_pct acima do que o combo da (mesma ideia do incentivo).
-- Escopo (quem recebe): igual ao do incentivo (geral | cliente | vendedor | canal | escritorio).

create table if not exists combos (
  id                     uuid primary key default gen_random_uuid(),
  nome                   text not null check (char_length(trim(nome)) between 3 and 80),
  escopo                 text not null default 'geral' check (escopo in ('geral', 'cliente', 'vendedor', 'canal', 'escritorio')),
  escopo_valor           text,
  beneficio              text not null check (beneficio in ('produto_gratis', 'desconto_pct')),
  brinde_cod_produto     text,
  brinde_qtd             numeric(12,3),
  desconto_pct           numeric(5,2),
  desconto_extra_max_pct numeric(5,2) not null default 0,
  repete                 boolean not null default false,
  max_repeticoes         integer check (max_repeticoes is null or max_repeticoes > 0),
  vigencia_ini           date,
  vigencia_fim           date,
  ativo                  boolean not null default true,
  updated_at             timestamptz not null default now(),
  check (escopo = 'geral' or char_length(trim(coalesce(escopo_valor, ''))) > 0),
  check (vigencia_ini is null or vigencia_fim is null or vigencia_fim >= vigencia_ini),
  check (beneficio <> 'produto_gratis' or (brinde_cod_produto is not null and brinde_qtd > 0)),
  check (beneficio <> 'desconto_pct' or (desconto_pct > 0 and desconto_pct <= 100))
);
alter table combos enable row level security;

create table if not exists combo_itens (
  id         uuid primary key default gen_random_uuid(),
  combo_id   uuid not null references combos (id) on delete cascade,
  alvo_tipo  text not null check (alvo_tipo in ('produto', 'linha', 'grupo', 'categoria', 'marca')),
  alvo_valor text not null check (char_length(trim(alvo_valor)) > 0),
  qtd_minima numeric(12,3) not null check (qtd_minima > 0)
);
create index if not exists combo_itens_combo_idx on combo_itens (combo_id);
alter table combo_itens enable row level security;
