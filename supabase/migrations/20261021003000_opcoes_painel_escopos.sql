-- Opcoes para o painel escolher em vez de digitar (escritorio, canal, equipe, tipo de estabelecimento, grupo de preco,
-- linha, grupo, categoria, marca) e novos escopos de desconto: equipe do vendedor e tipo de estabelecimento do cliente.

create or replace function fn_opcoes_painel()
returns table (campo text, codigo text, descricao text, extra text)
language sql stable as $$
  select distinct 'escritorio'::text, a #>> '{escritorio,codigo}', coalesce(nullif(a #>> '{escritorio,descricao}', ''), a #>> '{escritorio,codigo}'), null::text
    from clientes c, jsonb_array_elements(c.areas) a where coalesce(a #>> '{escritorio,codigo}', '') <> ''
  union
  select distinct 'canal', a #>> '{canal,codigo}', coalesce(nullif(a #>> '{canal,descricao}', ''), a #>> '{canal,codigo}'), null
    from clientes c, jsonb_array_elements(c.areas) a where coalesce(a #>> '{canal,codigo}', '') <> ''
  union
  select distinct 'tipo_estabelecimento', a #>> '{tipo_estabelecimento,codigo}', coalesce(nullif(a #>> '{tipo_estabelecimento,descricao}', ''), a #>> '{tipo_estabelecimento,codigo}'), null
    from clientes c, jsonb_array_elements(c.areas) a where coalesce(a #>> '{tipo_estabelecimento,codigo}', '') <> ''
  union
  select distinct 'grupo_preco', a #>> '{rede,codigo}', coalesce(nullif(a #>> '{rede,descricao}', ''), a #>> '{rede,codigo}'), null
    from clientes c, jsonb_array_elements(c.areas) a where coalesce(a #>> '{rede,codigo}', '') <> ''
  union
  select distinct 'equipe', equipe, equipe, escritorio from vendedores where coalesce(equipe, '') <> ''
  union
  select distinct 'linha', dados #>> '{classificacao,linha_id}', coalesce(nullif(dados #>> '{classificacao,linha}', ''), dados #>> '{classificacao,linha_id}'), null
    from produtos where coalesce(dados #>> '{classificacao,linha_id}', '') <> ''
  union
  select distinct 'grupo', dados #>> '{classificacao,grupo_id}', coalesce(nullif(dados #>> '{classificacao,grupo}', ''), dados #>> '{classificacao,grupo_id}'), null
    from produtos where coalesce(dados #>> '{classificacao,grupo_id}', '') <> ''
  union
  select distinct 'categoria', dados #>> '{classificacao,categoria_id}', coalesce(nullif(dados #>> '{classificacao,categoria}', ''), dados #>> '{classificacao,categoria_id}'), null
    from produtos where coalesce(dados #>> '{classificacao,categoria_id}', '') <> ''
  union
  select distinct 'marca', dados #>> '{classificacao,marca}', dados #>> '{classificacao,marca}', null
    from produtos where coalesce(dados #>> '{classificacao,marca}', '') <> ''
  union
  select distinct 'lista_grupo', pltyp, kdgrp, null from precos_grupo where coalesce(kdgrp, '') <> ''
$$;

alter table incentivos_desconto drop constraint if exists incentivos_desconto_escopo_check;
alter table incentivos_desconto
  add constraint incentivos_desconto_escopo_check
  check (escopo in ('geral','produto','cliente','vendedor','canal','escritorio','lista_preco','equipe','tipo_estabelecimento'));

alter table combos drop constraint if exists combos_escopo_check;
alter table combos
  add constraint combos_escopo_check
  check (escopo in ('geral','cliente','vendedor','canal','escritorio','lista_preco','equipe','tipo_estabelecimento'));

