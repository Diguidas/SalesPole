-- Vendas por rota e mes (modo equipe do app): valor dos pedidos do SAP (sem os recusados) dos clientes de cada rota.
-- p_rotas null = todas. p_ini = primeiro dia do periodo (o app pede os ultimos 3 meses).
create or replace function fn_equipe_vendas(p_ini date, p_rotas text[] default null)
returns table (rota text, mes text, valor numeric, pedidos bigint, clientes bigint)
language sql stable as $$
  with rc as (
    select cod_cliente, min(rota) as rota
      from rota_clientes
     where p_rotas is null or rota = any (p_rotas)
     group by cod_cliente
  )
  select rc.rota,
         to_char(p.dt_criacao, 'YYYY-MM'),
         sum(coalesce(p.valor, 0)),
         count(*)::bigint,
         count(distinct p.cod_cliente)::bigint
    from pedidos_sap p
    join rc on rc.cod_cliente = p.cod_cliente
   where p.dt_criacao >= p_ini
     and lower(coalesce(p.status, '')) <> 'recusado'
   group by 1, 2
$$;
