-- Indicadores da pagina inicial (KPIs, vendas por mes, vendedor, escritorio e canal) a partir do resumo mensal
-- (vendas_cliente_mes, ver 20261021007000): mesmo formato de fn_indicadores_vendas_todas, mas lendo uma linha por cliente e mes.
-- Meses inteiros de p_ini ate p_fim; so clientes com rota (e dentro do escopo p_rotas).

create or replace function fn_indicadores_resumo(p_ini date, p_fim date, p_rotas text[] default null)
returns table (dim text, chave text, rotulo text, valor numeric, pedidos bigint, clientes bigint)
language sql stable as $fn$
  with rc as (
    select cod_cliente, min(rota) as rota from rota_clientes group by cod_cliente
  ),
  base as materialized (
    select v.mes, v.cod_cliente, v.valor, v.pedidos, rc.rota,
           coalesce(c.areas -> 0 -> 'escritorio' ->> 'codigo', '')    as esc_cod,
           coalesce(c.areas -> 0 -> 'escritorio' ->> 'descricao', '') as esc_desc,
           coalesce(c.areas -> 0 -> 'canal' ->> 'codigo', '')         as canal_cod,
           coalesce(c.areas -> 0 -> 'canal' ->> 'descricao', '')      as canal_desc
      from vendas_cliente_mes v
      join rc on rc.cod_cliente = v.cod_cliente and (p_rotas is null or rc.rota = any (p_rotas))
      left join clientes c on c.cod_cliente = v.cod_cliente
     where v.mes >= date_trunc('month', p_ini)::date and v.mes <= p_fim
  )
  select 'mes', to_char(mes, 'YYYY-MM'), max(to_char(mes, 'YYYY-MM')), sum(valor), sum(pedidos)::bigint, count(distinct cod_cliente) from base group by mes
  union all
  select 'rota', rota, max(rota), sum(valor), sum(pedidos)::bigint, count(distinct cod_cliente) from base group by rota
  union all
  select 'escritorio', esc_cod, max(esc_desc), sum(valor), sum(pedidos)::bigint, count(distinct cod_cliente) from base group by esc_cod
  union all
  select 'canal', canal_cod, max(canal_desc), sum(valor), sum(pedidos)::bigint, count(distinct cod_cliente) from base group by canal_cod
$fn$;
