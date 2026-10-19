-- Painel web: quem pode entrar e o que cada um pode fazer.
--   admin     : tudo (cadastros, parametros, usuarios)
--   aprovador : aprova/rejeita bonificacao
--   consulta  : so ve
create table usuarios_painel (
  email      text primary key check (email = lower(email)),
  nome       text,
  papel      text not null check (papel in ('admin','aprovador','consulta')),
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

-- quem decidiu a bonificacao e quando (auditoria)
alter table pedidos_app
  add column decidido_por text,
  add column decidido_em  timestamptz;

-- exemplo (rode com o seu e-mail Microsoft para o primeiro acesso):
-- insert into usuarios_painel (email, nome, papel) values ('guilherme.franklin@polealimentos.com.br', 'Guilherme', 'admin');
