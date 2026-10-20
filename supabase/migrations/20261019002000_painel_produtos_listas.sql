-- Telas de Produtos e Listas de preco do painel.
--  * produtos.imagem_url: URL da foto (opcional; o painel mostra um marcador quando vazia).
--    A sincronizacao nao grava essa coluna, entao ela nao e sobrescrita.
--  * Produto ATIVO = tem preco vigente hoje em pelo menos uma lista (precos_lista ou precos_grupo).
--  * Lista de preco do cliente = clientes.areas[].lista_preco.codigo (igual ao pltyp das tabelas de preco).

alter table produtos add column if not exists imagem_url text;

create or replace function fn_produtos_painel(
  p_busca text, p_tipo text, p_situacao text, p_limite integer, p_offset integer
)
returns table (
  cod_produto text, descricao text, tipo_material text, unidade text, ean text, imagem_url text,
  ativo boolean, listas integer, total bigint
)
language plpgsql stable as $$
begin
  return query
  with vig as (
    select v.cod_produto, count(distinct v.pltyp)::int as listas from (
      select l.cod_produto, l.pltyp from precos_lista l where current_date between l.datab and l.datbi
      union all
      select g.cod_produto, g.pltyp from precos_grupo g where current_date between g.datab and g.datbi
    ) v group by v.cod_produto
  ),
  base as (
    select p.cod_produto, p.descricao, p.tipo_material, p.unidade, p.ean, p.imagem_url,
           (vig.cod_produto is not null) as ativo, coalesce(vig.listas, 0) as listas
      from produtos p
      left join vig on vig.cod_produto = p.cod_produto
     where (coalesce(p_busca, '') = ''
            or p.cod_produto ilike '%' || p_busca || '%'
            or coalesce(p.descricao, '') ilike '%' || p_busca || '%'
            or coalesce(p.ean, '') ilike '%' || p_busca || '%')
       and (coalesce(p_tipo, '') = '' or p.tipo_material = p_tipo)
       and (case coalesce(p_situacao, '')
              when 'ativos' then vig.cod_produto is not null
              when 'inativos' then vig.cod_produto is null
              else true end)
  )
  select b.cod_produto, b.descricao, b.tipo_material, b.unidade, b.ean, b.imagem_url, b.ativo, b.listas,
         count(*) over ()
    from base b
   order by b.ativo desc, coalesce(b.descricao, b.cod_produto)
   limit least(coalesce(p_limite, 48), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- Listas conhecidas (as que existem nos clientes ou nas tabelas de preco), com contagens.
create or replace function fn_listas_preco_painel()
returns table (
  pltyp text, descricao text, clientes bigint, produtos bigint, grupos bigint
)
language sql stable as $$
  with nomes as (
    select a -> 'lista_preco' ->> 'codigo' as pltyp,
           max(nullif(a -> 'lista_preco' ->> 'descricao', '')) as descricao,
           count(distinct c.cod_cliente) filter (where not c.bloqueado) as clientes
      from clientes c, jsonb_array_elements(c.areas) a
     where coalesce(a -> 'lista_preco' ->> 'codigo', '') <> ''
     group by 1
  ),
  precos as (
    select pltyp, count(distinct cod_produto) as produtos from (
      select l.pltyp, l.cod_produto from precos_lista l where current_date between l.datab and l.datbi
      union
      select g.pltyp, g.cod_produto from precos_grupo g where current_date between g.datab and g.datbi
    ) x group by pltyp
  ),
  grp as (
    select g.pltyp, count(distinct g.kdgrp) as grupos from precos_grupo g
     where current_date between g.datab and g.datbi group by g.pltyp
  )
  select coalesce(n.pltyp, p.pltyp), n.descricao, coalesce(n.clientes, 0), coalesce(p.produtos, 0), coalesce(g.grupos, 0)
    from nomes n
    full join precos p on p.pltyp = n.pltyp
    left join grp g on g.pltyp = coalesce(n.pltyp, p.pltyp)
   order by (coalesce(p.produtos, 0) > 0) desc, coalesce(n.pltyp, p.pltyp)
$$;

-- Clientes que usam uma lista (busca por nome/codigo/CNPJ, paginado).
create or replace function fn_clientes_da_lista(p_pltyp text, p_busca text, p_limite integer, p_offset integer)
returns table (
  cod_cliente text, nome text, razao_social text, cnpjcpf text, cidade text, uf text,
  bloqueado boolean, rede text, total bigint
)
language plpgsql stable as $$
begin
  return query
  select c.cod_cliente, coalesce(c.nome_fantasia, c.razao_social), c.razao_social, c.cnpjcpf,
         c.endereco ->> 'cidade', c.endereco ->> 'uf', c.bloqueado,
         (select nullif(a -> 'rede' ->> 'descricao', '') from jsonb_array_elements(c.areas) a
           where a -> 'lista_preco' ->> 'codigo' = p_pltyp limit 1),
         count(*) over ()
    from clientes c
   where exists (select 1 from jsonb_array_elements(c.areas) a where a -> 'lista_preco' ->> 'codigo' = p_pltyp)
     and (coalesce(p_busca, '') = ''
          or c.cod_cliente ilike '%' || p_busca || '%'
          or coalesce(c.nome_fantasia, '') ilike '%' || p_busca || '%'
          or coalesce(c.razao_social, '') ilike '%' || p_busca || '%'
          or coalesce(c.cnpjcpf, '') ilike '%' || p_busca || '%')
   order by c.bloqueado, coalesce(c.nome_fantasia, c.razao_social, c.cod_cliente)
   limit least(coalesce(p_limite, 50), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end
$$;
