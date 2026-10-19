-- =====================================================================
-- Bonificacao com aprovacao + tabelas que o painel web vai alimentar
--   * pedidos_app: tipo (venda | bonificacao), tipo/centro de custo/justificativa, aprovacao
--   * bonificacao_tipos, centros_custo: listas que o vendedor escolhe na bonificacao
--   * produto_destaques: destaques e lancamentos (aba Sugestao do app)
--   * incentivos_desconto: desconto por quantidade (por produto e por geral/cliente/vendedor/canal/escritorio)
-- Enquanto nao existe o painel, o cadastro e feito direto no Table Editor do Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pedido: tipo e fluxo de aprovacao
-- ---------------------------------------------------------------------
alter table pedidos_app add column if not exists tipo text not null default 'venda';
alter table pedidos_app add column if not exists tipo_bonificacao text;   -- codigo (ORD_REASON, 3 digitos)
alter table pedidos_app add column if not exists centro_custo text;       -- codigo (KOSTL)
alter table pedidos_app add column if not exists justificativa text;       -- so para quem aprova: NAO vai ao SAP
alter table pedidos_app add column if not exists motivo_rejeicao text;

alter table pedidos_app drop constraint if exists pedidos_app_tipo_check;
alter table pedidos_app add constraint pedidos_app_tipo_check check (tipo in ('venda', 'bonificacao'));

-- aguardando_aprovacao: bonificacao recebida, ainda NAO foi ao SAP
-- aprovado:             alguem aprovou (mudando o status): o job de envio pega em ate 1 minuto
-- rejeitado:            reprovado; preencher motivo_rejeicao (o vendedor ve no app)
alter table pedidos_app drop constraint if exists pedidos_app_status_check;
alter table pedidos_app add constraint pedidos_app_status_check
  check (status in ('recebido','enviando','enviado','erro','parcial','aguardando_aprovacao','aprovado','rejeitado'));

create index if not exists pedidos_app_aprovacao_idx on pedidos_app (status) where status = 'aguardando_aprovacao';

-- 'aprovado' entra na fila de envio como se fosse 'recebido'
create or replace function fn_pedido_reservar(p_id uuid, p_forcar boolean default false)
returns setof pedidos_app
language sql as $$
  update pedidos_app
     set status = 'enviando',
         tentativas = tentativas + 1,
         proxima_tentativa_em = null
   where id = p_id
     and (
          status in ('recebido', 'parcial', 'aprovado')
       or (p_forcar and status = 'erro')
       or (status = 'enviando' and updated_at < now() - interval '5 minutes')
     )
  returning *;
$$;

create or replace function fn_pedidos_pendentes(p_limite integer default 20)
returns setof pedidos_app
language sql stable as $$
  select *
    from pedidos_app
   where (
          status in ('recebido', 'parcial', 'aprovado')
      and (proxima_tentativa_em is null or proxima_tentativa_em <= now())
         )
      or (status = 'enviando' and updated_at < now() - interval '5 minutes')
   order by recebido_em
   limit p_limite;
$$;

-- (o trigger trg_touch de pedidos_app ja atualiza updated_at a cada UPDATE: mudar o status no
--  Table Editor faz o pedido voltar no proximo pull do app)

-- ---------------------------------------------------------------------
-- Cadastros do painel
-- ---------------------------------------------------------------------
create table if not exists bonificacao_tipos (
  codigo     text primary key,               -- ORD_REASON do SAP, ate 3 posicoes (ex.: 115). So o codigo vai ao SAP
  descricao  text not null,
  ativo      boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists centros_custo (
  codigo     text primary key,               -- KOSTL do SAP, ate 10 posicoes (ex.: 2001501007). So o codigo vai ao SAP
  descricao  text not null,
  ativo      boolean not null default true,
  updated_at timestamptz not null default now()
);

-- o codigo e enviado ao SAP do jeito que esta: precisa caber no campo de la
alter table bonificacao_tipos drop constraint if exists bonificacao_tipos_codigo_tamanho;
alter table bonificacao_tipos add constraint bonificacao_tipos_codigo_tamanho
  check (char_length(codigo) between 1 and 3);      -- VBAK-AUGRU (ORD_REASON) tem 3 posicoes
alter table centros_custo drop constraint if exists centros_custo_codigo_tamanho;
alter table centros_custo add constraint centros_custo_codigo_tamanho
  check (char_length(codigo) between 1 and 10);     -- VBAK-KOSTL tem 10 posicoes

create table if not exists produto_destaques (
  cod_produto text primary key,
  destaque    boolean not null default false,
  lancamento  boolean not null default false,
  ordem       integer not null default 0,
  ativo       boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- Desconto por incentivo: a partir de `qtd_minima` (na unidade do pedido, a caixa) o produto ganha
-- `desconto_pct`%; o vendedor ainda pode ir ate `desconto_extra_max_pct`% alem disso.
-- escopo: a quem vale. 'geral' = todos | 'cliente' (escopo_valor = codigo do cliente)
--         | 'vendedor' (codigo do vendedor) | 'canal' (codigo do canal, KNVV-VTWEG)
--         | 'escritorio' (escritorio de vendas, KNVV-VKBUR) | 'produto' (vale so para o cod_produto, para todos)
-- cod_produto vazio = vale para QUALQUER produto naquele escopo.
-- Se varias regras servirem, vence a de maior qtd_minima atingida; no empate, a mais especifica
-- (cliente > vendedor > escritorio > canal > produto > geral; com produto informado vence sem produto).
create table if not exists incentivos_desconto (
  id                     uuid primary key default gen_random_uuid(),
  cod_produto            text,
  escopo                 text not null default 'geral'
                         check (escopo in ('geral','produto','cliente','vendedor','canal','escritorio')),
  escopo_valor           text,
  qtd_minima             numeric(12,3) not null check (qtd_minima > 0),
  desconto_pct           numeric(5,2) not null check (desconto_pct >= 0 and desconto_pct <= 100),
  desconto_extra_max_pct numeric(5,2) not null default 0 check (desconto_extra_max_pct >= 0 and desconto_extra_max_pct <= 100),
  vigencia_ini           date,
  vigencia_fim           date,
  ativo                  boolean not null default true,
  updated_at             timestamptz not null default now(),
  check (escopo in ('geral','produto') or escopo_valor is not null),
  check (escopo <> 'produto' or cod_produto is not null)
);
create index if not exists incentivos_desconto_prod_idx on incentivos_desconto (cod_produto) where ativo;

-- so o servidor (service role) le e escreve nessas tabelas: o app so as enxerga pelo /sync/pull
alter table bonificacao_tipos  enable row level security;
alter table centros_custo      enable row level security;
alter table produto_destaques  enable row level security;
alter table incentivos_desconto enable row level security;
