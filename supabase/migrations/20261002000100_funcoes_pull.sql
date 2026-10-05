-- =====================================================================
-- Funcoes de leitura por carteira (pull do app) e apoio ao sync.
-- A carteira de uma rota = clientes em rota_clientes. As funcoes fazem o
-- join no banco para nao mandar listas enormes de codigos pela URL.
-- Todas via rpc() do NestJS (service role).
-- =====================================================================

-- clientes: delta por updated_at
create or replace function fn_produtos_delta(p_since timestamptz default null)
returns setof produtos
language sql stable as $$
  select p.* from produtos p
  where p_since is null or p.updated_at > p_since;
$$;

-- pedidos dos ultimos 90 dias da carteira (delta)
create or replace function fn_pedidos_da_rota(p_rota text, p_since timestamptz default null)
returns setof pedidos_sap
language sql stable as $$
  select p.* from pedidos_sap p
  where p.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
    and p.dt_criacao >= current_date - 90
    and (p_since is null or p.updated_at > p_since);
$$;

create or replace function fn_itens_pedidos_da_rota(p_rota text, p_since timestamptz default null)
returns setof pedido_itens_sap
language sql stable as $$
  select i.* from pedido_itens_sap i
  join pedidos_sap p on p.ordem = i.ordem
  where p.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
    and p.dt_criacao >= current_date - 90
    and (p_since is null or i.updated_at > p_since);
$$;

-- titulos: em aberto/atrasados + compensados nos ultimos 90 dias (delta)
create or replace function fn_titulos_da_rota(p_rota text, p_since timestamptz default null)
returns setof titulos
language sql stable as $$
  select t.* from titulos t
  where t.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
    and (t.status <> 'Compensado' or t.dt_compensacao >= current_date - 90)
    and (p_since is null or t.updated_at > p_since);
$$;

-- estoque dos centros usados pela carteira (delta)
create or replace function fn_estoque_da_rota(p_rota text, p_since timestamptz default null)
returns setof estoque
language sql stable as $$
  select e.* from estoque e
  where e.centro in (
          select distinct a ->> 'centro'
          from clientes c
          cross join lateral jsonb_array_elements(c.areas) a
          where c.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
        )
    and (p_since is null or e.updated_at > p_since);
$$;

-- remessas abertas da carteira (conjunto COMPLETO: remessa entregue some)
create or replace function fn_remessas_da_rota(p_rota text)
returns setof remessas
language sql stable as $$
  select r.* from remessas r
  where r.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota);
$$;

-- precos vigentes das listas/grupos usados pela carteira (conjunto COMPLETO)
create or replace function fn_precos_lista_da_rota(p_rota text)
returns setof precos_lista
language sql stable as $$
  select p.* from precos_lista p
  where p.datbi >= current_date
    and p.pltyp in (
          select distinct a -> 'lista_preco' ->> 'codigo'
          from clientes c
          cross join lateral jsonb_array_elements(c.areas) a
          where c.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
        );
$$;

create or replace function fn_precos_grupo_da_rota(p_rota text)
returns setof precos_grupo
language sql stable as $$
  select p.* from precos_grupo p
  where p.datbi >= current_date
    and (p.pltyp, p.kdgrp) in (
          select distinct a -> 'lista_preco' ->> 'codigo', a -> 'rede' ->> 'codigo'
          from clientes c
          cross join lateral jsonb_array_elements(c.areas) a
          where c.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
        );
$$;

-- ---------------------------------------------------------------------
-- Apoio ao sync
-- ---------------------------------------------------------------------

-- ordens que precisam (re)buscar itens: ainda sem itens, ou com status que
-- ainda evolui (itens podem ser recusados/faturados)
create or replace function fn_ordens_para_itens(p_rota text)
returns table (ordem text)
language sql stable as $$
  select p.ordem
  from pedidos_sap p
  where p.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
    and p.dt_criacao >= current_date - 90
    and (
      not exists (select 1 from pedido_itens_sap i where i.ordem = p.ordem)
      or p.status in ('A Faturar', 'Faturado Parcial', 'Aguardando Liberação', 'Liberado para faturamento')
    );
$$;

-- remessa que o SAP nao devolveu mais (entregue/cancelada) sai da tabela
create or replace function fn_limpar_remessas(p_rota text, p_inicio timestamptz)
returns void
language sql as $$
  delete from remessas r
  where r.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
    and r.synced_at < p_inicio;
$$;
