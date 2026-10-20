-- Com ~280 mil pedidos, as 4 chamadas paralelas de fn_indicadores_vendas (mes, rota, escritorio, canal) se atrapalhavam
-- e chegavam perto do statement timeout. Esta funcao calcula as quatro visoes numa passada so.

create or replace function fn_indicadores_vendas_todas(p_ini date, p_fim date)
returns table (
  dim      text,
  chave    text,
  rotulo   text,
  valor    numeric,
  pedidos  bigint,
  clientes bigint
)
language plpgsql stable as $fn$
begin
  return query execute $q$
  with rc as (
    select cod_cliente, min(rota) as rota from rota_clientes group by cod_cliente
  ),
  pc as (
    select p.cod_cliente, to_char(p.dt_criacao, 'YYYY-MM') as mes, sum(coalesce(p.valor, 0)) as valor, count(*) as n
      from pedidos_sap p
     where p.dt_criacao between $1 and $2
       and lower(coalesce(p.status, '')) <> 'recusado'
     group by 1, 2
  ),
  base as materialized (
    select pc.cod_cliente, pc.valor, pc.n, pc.mes, rc.rota,
           coalesce(c.areas -> 0 -> 'escritorio' ->> 'codigo', '')    as esc_cod,
           coalesce(c.areas -> 0 -> 'escritorio' ->> 'descricao', '') as esc_desc,
           coalesce(c.areas -> 0 -> 'canal' ->> 'codigo', '')         as canal_cod,
           coalesce(c.areas -> 0 -> 'canal' ->> 'descricao', '')      as canal_desc
      from pc
      join rc on rc.cod_cliente = pc.cod_cliente
      left join clientes c on c.cod_cliente = pc.cod_cliente
  )
  select 'mes', mes, max(mes), sum(valor), sum(n)::bigint, count(distinct cod_cliente) from base group by mes
  union all
  select 'rota', rota, max(rota), sum(valor), sum(n)::bigint, count(distinct cod_cliente) from base group by rota
  union all
  select 'escritorio', esc_cod, max(esc_desc), sum(valor), sum(n)::bigint, count(distinct cod_cliente) from base group by esc_cod
  union all
  select 'canal', canal_cod, max(canal_desc), sum(valor), sum(n)::bigint, count(distinct cod_cliente) from base group by canal_cod
  $q$ using p_ini, p_fim;
end
$fn$;
