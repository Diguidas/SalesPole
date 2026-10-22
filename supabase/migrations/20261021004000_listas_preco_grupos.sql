-- Listas de preco do painel: cada lista com seus GRUPOS de preco (grupo do cliente, KNVV-KDGRP), com quantos produtos
-- tem preco proprio para o grupo e quantos clientes estao na combinacao lista + grupo.
create or replace function fn_listas_grupos_painel()
returns table (pltyp text, kdgrp text, descricao text, produtos bigint, clientes bigint)
language sql stable as $$
  with pares as (
    select a -> 'lista_preco' ->> 'codigo' as pltyp,
           a -> 'rede' ->> 'codigo' as kdgrp,
           max(nullif(a -> 'rede' ->> 'descricao', '')) as descricao,
           count(distinct c.cod_cliente) filter (where not c.bloqueado) as clientes
      from clientes c, jsonb_array_elements(c.areas) a
     where coalesce(a -> 'lista_preco' ->> 'codigo', '') <> '' and coalesce(a -> 'rede' ->> 'codigo', '') <> ''
     group by 1, 2
  ),
  precos as (
    select g.pltyp, g.kdgrp, count(distinct g.cod_produto) as produtos
      from precos_grupo g where current_date between g.datab and g.datbi group by 1, 2
  )
  select coalesce(p.pltyp, x.pltyp), coalesce(p.kdgrp, x.kdgrp), p.descricao, coalesce(x.produtos, 0), coalesce(p.clientes, 0)
    from pares p full join precos x on x.pltyp = p.pltyp and x.kdgrp = p.kdgrp
$$;
