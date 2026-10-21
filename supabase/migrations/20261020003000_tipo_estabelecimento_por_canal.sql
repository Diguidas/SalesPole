-- Quais tipos de estabelecimento ja existem em cada canal (pares vistos nos clientes do SAP): o formulario de cadastro
-- mostra so os tipos do canal escolhido.
create or replace function fn_tipos_por_canal()
returns table (canal text, tipo text)
language sql stable as $$
  select distinct a #>> '{canal,codigo}', a #>> '{tipo_estabelecimento,codigo}'
    from clientes c, jsonb_array_elements(c.areas) a
   where coalesce(a #>> '{canal,codigo}', '') <> '' and coalesce(a #>> '{tipo_estabelecimento,codigo}', '') <> ''
$$;
