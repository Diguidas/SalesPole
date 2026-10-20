-- fn_indicadores_vendas estourava o statement timeout quando chamada pela API (parametros): o plano
-- generico lia pedidos_sap inteiro de forma ruim. Em plpgsql com EXECUTE ... USING o plano e feito com os
-- valores reais (mesmo que rodar a consulta direto: ~1 s com 250 mil pedidos). Mesmo resultado de antes.

create or replace function fn_indicadores_vendas(p_ini date, p_fim date, p_dim text)
returns table (
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
  cli as (
    select cod_cliente,
           areas -> 0 -> 'escritorio' ->> 'codigo'    as esc_cod,
           areas -> 0 -> 'escritorio' ->> 'descricao' as esc_desc,
           areas -> 0 -> 'canal'      ->> 'codigo'    as canal_cod,
           areas -> 0 -> 'canal'      ->> 'descricao' as canal_desc
      from clientes
  ),
  pc as (
    -- primeiro soma por cliente e mes (poucas linhas), depois cruza com rota e cadastro
    select p.cod_cliente, to_char(p.dt_criacao, 'YYYY-MM') as mes, sum(coalesce(p.valor, 0)) as valor, count(*) as n
      from pedidos_sap p
     where p.dt_criacao between $1 and $2
       and lower(coalesce(p.status, '')) <> 'recusado'
     group by 1, 2
  ),
  base as (
    select pc.cod_cliente, pc.valor, pc.n, pc.mes, rc.rota,
           coalesce(cli.esc_cod, '')    as esc_cod,
           coalesce(cli.esc_desc, '')   as esc_desc,
           coalesce(cli.canal_cod, '')  as canal_cod,
           coalesce(cli.canal_desc, '') as canal_desc
      from pc
      join rc on rc.cod_cliente = pc.cod_cliente
      left join cli on cli.cod_cliente = pc.cod_cliente
  )
  select case $3 when 'mes' then mes when 'rota' then rota when 'escritorio' then esc_cod when 'canal' then canal_cod end,
         max(case $3 when 'mes' then mes when 'rota' then rota when 'escritorio' then esc_desc when 'canal' then canal_desc end),
         sum(valor),
         sum(n)::bigint,
         count(distinct cod_cliente)
    from base
   where $3 in ('mes', 'rota', 'escritorio', 'canal')
   group by 1
  $q$ using p_ini, p_fim, p_dim;
end
$fn$;
