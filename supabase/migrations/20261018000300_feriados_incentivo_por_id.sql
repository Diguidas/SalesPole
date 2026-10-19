-- =====================================================================
-- 1) Incentivo por LINHA / GRUPO / CATEGORIA usa o ID do cadastro (ZSDT130, ZSDT131, ZSDT132);
--    a marca continua sendo o texto (MARA-NORMT, nao tem ID).
-- 2) Feriados: a entrega nunca cai em feriado (o painel web vai manter esta tabela).
-- 3) Limpeza: cliente que o SAP deixou de mandar (ex.: tabela de preco 33/63) sai do Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) incentivos: ids no lugar dos nomes
-- ---------------------------------------------------------------------
alter table incentivos_desconto add column if not exists linha_id     text;
alter table incentivos_desconto add column if not exists grupo_id     text;
alter table incentivos_desconto add column if not exists categoria_id text;
-- os textos da migration anterior (...0200) saem: o painel cadastra pelo ID
alter table incentivos_desconto drop column if exists linha;
alter table incentivos_desconto drop column if exists grupo;
alter table incentivos_desconto drop column if exists categoria;
-- (marca continua como texto, sem diferenciar maiuscula/minuscula)

-- ---------------------------------------------------------------------
-- 2) feriados
-- ---------------------------------------------------------------------
-- uf e cidade vazios = feriado NACIONAL; uf preenchido = estadual; uf + cidade = municipal.
-- cidade e comparada sem diferenciar maiuscula/minuscula, com o texto do endereco do cliente no SAP.
create table if not exists feriados (
  id         uuid primary key default gen_random_uuid(),
  data       date not null,
  descricao  text not null,
  uf         text,
  cidade     text,
  ativo      boolean not null default true,
  updated_at timestamptz not null default now(),
  check (cidade is null or uf is not null)
);
create unique index if not exists feriados_unico on feriados (data, coalesce(uf, ''), coalesce(lower(cidade), ''));
alter table feriados enable row level security;

-- nacionais de 2026 e 2027 (Sexta-feira Santa incluida; Carnaval e Corpus Christi sao ponto facultativo:
-- cadastre pelo painel se a operacao parar nesses dias)
insert into feriados (data, descricao) values
  ('2026-01-01', 'Confraternização Universal'),
  ('2026-04-03', 'Sexta-feira Santa'),
  ('2026-04-21', 'Tiradentes'),
  ('2026-05-01', 'Dia do Trabalho'),
  ('2026-09-07', 'Independência do Brasil'),
  ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'),
  ('2026-11-15', 'Proclamação da República'),
  ('2026-11-20', 'Consciência Negra'),
  ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'),
  ('2027-03-26', 'Sexta-feira Santa'),
  ('2027-04-21', 'Tiradentes'),
  ('2027-05-01', 'Dia do Trabalho'),
  ('2027-09-07', 'Independência do Brasil'),
  ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'),
  ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Consciência Negra'),
  ('2027-12-25', 'Natal')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3) limpeza de clientes que sairam do retorno do SAP
-- ---------------------------------------------------------------------
-- Apaga, da carteira da rota, os clientes que NAO foram atualizados nesta sincronizacao (synced_at < p_inicio).
-- A API so chama quando o SAP devolveu clientes (nunca com a lista vazia, para uma falha nao apagar tudo).
create or replace function fn_limpar_clientes_rota(p_rota text, p_inicio timestamptz)
returns integer
language sql as $$
  with apagados as (
    delete from clientes c
     where c.synced_at < p_inicio
       and c.cod_cliente in (select r.cod_cliente from rota_clientes r where r.rota = p_rota)
    returning 1
  )
  select count(*)::integer from apagados;
$$;
