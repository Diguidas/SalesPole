-- Tamanho da carteira de cada vendedor (modo equipe do app): tela de clientes que comeca pelos vendedores.
create or replace function fn_equipe_carteiras(p_vendedores text[] default null)
returns table (cod_vendedor text, nome text, rota text, clientes bigint)
language sql stable as $$
  select v.cod_vendedor, v.nome, v.rota,
         (select count(distinct rc.cod_cliente) from rota_clientes rc where rc.rota = v.rota)
    from vendedores v
   where v.rota is not null
     and (p_vendedores is null or v.cod_vendedor = any (p_vendedores))
   order by v.nome
$$;
