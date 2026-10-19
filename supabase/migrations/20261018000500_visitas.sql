-- =====================================================================
-- Roteiro de visita: check-in com GPS + foto de fachada + resultado (vendeu / nao vendeu + motivo)
--  * visitas:      uma visita por cliente do roteiro do dia
--  * visita_fotos: fotos da visita (arquivo no bucket PRIVADO 'visitas-fotos', criado pela API)
-- Validacao (painel): 'pendente' -> 'validada' | 'recusada', com quem validou e a observacao.
-- As fotos sao apagadas do bucket depois de FOTO_VISITA_DIAS (padrao 30): o registro da visita e a
-- validacao ficam; so o arquivo some (visita_fotos.removida_em).
-- =====================================================================

create table if not exists visitas (
  id                   uuid primary key,                 -- gerado no celular (idempotencia do envio)
  cod_vendedor         text not null,
  cod_cliente          text not null,
  data_visita          date not null,                    -- dia do roteiro (data local do celular no check-in)
  status               text not null default 'em_andamento'
                       check (status in ('em_andamento', 'concluida')),

  -- check-in
  checkin_em           timestamptz not null,             -- relogio do aparelho
  checkin_recebido_em  timestamptz not null default now(),  -- relogio do SERVIDOR (detecta relogio adulterado)
  checkin_lat          numeric(10,7),
  checkin_lng          numeric(10,7),
  checkin_precisao_m   numeric(8,1),                     -- precisao do GPS informada pelo aparelho
  checkin_gps_falso    boolean not null default false,   -- o Android avisou que a posicao e simulada
  distancia_m          integer,                          -- do check-in ate o cliente (calculada AQUI); null = sem referencia
  fora_do_raio         boolean not null default false,   -- distancia_m acima do raio (so avisa, nao bloqueia)
  sem_referencia       boolean not null default false,   -- cliente sem latitude/longitude no cadastro

  -- check-out
  checkout_em          timestamptz,
  resultado            text check (resultado in ('vendeu', 'nao_vendeu')),
  motivo_nao_venda     text,                             -- digitado pelo vendedor
  observacao           text,
  pedido_id            uuid,                             -- pedido feito na visita (pedidos_app.id), quando vendeu

  -- validacao (painel)
  validacao            text not null default 'pendente'
                       check (validacao in ('pendente', 'validada', 'recusada')),
  validada_por         text,
  validada_em          timestamptz,
  validacao_obs        text,

  recebido_em          timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  check (status <> 'concluida' or resultado is not null),
  check (resultado is distinct from 'nao_vendeu' or char_length(trim(coalesce(motivo_nao_venda, ''))) >= 3)
);
create index if not exists visitas_vendedor_dia_idx on visitas (cod_vendedor, data_visita desc);
create index if not exists visitas_cliente_dia_idx on visitas (cod_cliente, data_visita desc);
create index if not exists visitas_validacao_idx on visitas (validacao) where validacao = 'pendente';

drop trigger if exists trg_touch on visitas;
create trigger trg_touch before update on visitas
  for each row execute function fn_touch_updated_at_simples();

create table if not exists visita_fotos (
  id             uuid primary key,                       -- gerado no celular
  visita_id      uuid not null references visitas (id) on delete cascade,
  tipo           text not null default 'fachada' check (tipo in ('fachada', 'outra')),
  caminho        text not null,                          -- caminho no bucket 'visitas-fotos'
  tirada_em      timestamptz not null,
  lat            numeric(10,7),
  lng            numeric(10,7),
  tamanho_bytes  integer,
  enviada_em     timestamptz,                            -- null = o arquivo ainda nao subiu
  removida_em    timestamptz,                            -- arquivo apagado pela retencao
  created_at     timestamptz not null default now()
);
create index if not exists visita_fotos_visita_idx on visita_fotos (visita_id);
create index if not exists visita_fotos_retencao_idx on visita_fotos (enviada_em) where removida_em is null;

-- so o servidor (service role) le e escreve; o painel e o app passam pela API
alter table visitas      enable row level security;
alter table visita_fotos enable row level security;
