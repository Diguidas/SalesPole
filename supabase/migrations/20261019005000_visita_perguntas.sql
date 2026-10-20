-- Perguntas da visita: cadastradas no painel, respondidas pelo vendedor no app durante a visita.
--  * escopo: geral (todos) | vendedor | escritorio | canal | cliente; escopo_valor aceita varios codigos separados por virgula
--  * obrigatoria: o app nao deixa concluir a visita sem responder
--  * tipo: texto | sim_nao | numero | opcoes (opcoes separadas por ";")
-- As respostas ficam em visitas.respostas (jsonb), com o texto da pergunta no momento da resposta
-- (mudar a pergunta depois nao muda o que o vendedor respondeu).

create table if not exists visita_perguntas (
  id           uuid primary key default gen_random_uuid(),
  texto        text not null check (char_length(trim(texto)) between 3 and 200),
  tipo         text not null default 'texto' check (tipo in ('texto', 'sim_nao', 'numero', 'opcoes')),
  opcoes       text,
  obrigatoria  boolean not null default false,
  escopo       text not null default 'geral' check (escopo in ('geral', 'vendedor', 'escritorio', 'canal', 'cliente')),
  escopo_valor text,
  ordem        integer not null default 0,
  ativo        boolean not null default true,
  updated_at   timestamptz not null default now(),
  check (escopo = 'geral' or char_length(trim(coalesce(escopo_valor, ''))) > 0),
  check (tipo <> 'opcoes' or char_length(trim(coalesce(opcoes, ''))) > 0)
);
alter table visita_perguntas enable row level security;

alter table visitas add column if not exists respostas jsonb not null default '[]';
