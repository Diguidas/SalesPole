-- =====================================================================
-- Indicadores gerenciais (painel): vendedores que entram so para indicadores (sem usar o app)
-- e as consultas que somam as vendas por mes, rota (vendedor), escritorio e canal.
-- =====================================================================

-- O painel importa do SAP a lista de todos os vendedores (metodo salespole_vendedores) e o administrador
-- marca quais entram nos indicadores. O cron sincroniza a carteira e os pedidos desses vendedores 2x por dia.
alter table vendedores add column if not exists indicadores boolean not null default false;

-- ---------------------------------------------------------------------
-- Vendas somadas por UMA dimensao: 'mes' | 'rota' | 'escritorio' | 'canal' (pedidos do SAP, sem os recusados)
--  * a rota do pedido e a da carteira do cliente (rota_clientes); cliente em mais de uma rota fica na menor
--  * escritorio e canal vem do cadastro do cliente (primeira area de vendas)
--  * valor em R$ (valor do pedido no SAP); `clientes` = clientes distintos que compraram no periodo (positivacao)
--  * uma consulta por dimensao evita devolver milhares de linhas (a API do Supabase corta em 1000)
-- ---------------------------------------------------------------------
create or replace function fn_indicadores_vendas(p_ini date, p_fim date, p_dim text)
returns table (
  chave    text,
  rotulo   text,
  valor    numeric,
  pedidos  bigint,
  clientes bigint
)
language sql stable as $$
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
  base as (
    select p.cod_cliente,
           coalesce(p.valor, 0) as valor,
           to_char(p.dt_criacao, 'YYYY-MM') as mes,
           rc.rota,
           coalesce(cli.esc_cod, '')    as esc_cod,
           coalesce(cli.esc_desc, '')   as esc_desc,
           coalesce(cli.canal_cod, '')  as canal_cod,
           coalesce(cli.canal_desc, '') as canal_desc
      from pedidos_sap p
      join rc on rc.cod_cliente = p.cod_cliente
      left join cli on cli.cod_cliente = p.cod_cliente
     where p.dt_criacao between p_ini and p_fim
       and lower(coalesce(p.status, '')) <> 'recusado'
  )
  select case p_dim when 'mes' then mes when 'rota' then rota when 'escritorio' then esc_cod when 'canal' then canal_cod end,
         max(case p_dim when 'mes' then mes when 'rota' then rota when 'escritorio' then esc_desc when 'canal' then canal_desc end),
         sum(valor),
         count(*),
         count(distinct cod_cliente)
    from base
   where p_dim in ('mes', 'rota', 'escritorio', 'canal')
   group by 1
$$;

-- Tamanho da carteira por rota (para a positivacao: clientes que compraram / clientes da carteira)
create or replace function fn_indicadores_carteira()
returns table (rota text, clientes bigint)
language sql stable as $$
  select rota, count(distinct cod_cliente) from rota_clientes group by rota
$$;
