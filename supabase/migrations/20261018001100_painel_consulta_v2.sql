-- =====================================================================
-- Painel, ajustes na consulta:
--  * pedidos: filtro "clientes V" (pagamento antecipado) e "so nao faturados"; devolve se o cliente e V,
--    se o pedido ja foi faturado (nota ou status "Faturado...") e ha quantos dias foi criado.
--    (junta a antiga tela "Pedidos V" na lista de pedidos)
--  * clientes: os bloqueados so aparecem quando o filtro "bloqueados" e escolhido.
-- =====================================================================

-- a assinatura muda (novos parametros): remove a anterior para nao ficar uma sobrecarga velha
drop function if exists fn_pedidos_painel(date, date, text, text, text, integer, integer);

create or replace function fn_pedidos_painel(
  p_ini date, p_fim date, p_vendedor text, p_busca text, p_status text,
  p_antecipado boolean, p_pendentes boolean, p_limite integer, p_offset integer
)
returns table (
  ordem text, cod_cliente text, cliente text, rota text, vendedor text,
  dt_criacao date, dt_entrega date, valor numeric, status text, tp_ped text, plataforma text,
  pedido_externo text, notas integer, antecipado boolean, faturado boolean, dias integer, total bigint
)
language sql stable as $$
  with rc as (
    select cod_cliente, min(rota) as rota from rota_clientes group by cod_cliente
  ),
  vend as (
    select rota, string_agg(nome, ' / ' order by nome) as nome, array_agg(cod_vendedor) as cods
      from vendedores where rota is not null group by rota
  ),
  base as (
    select p.*,
           jsonb_array_length(coalesce(p.notas, '[]'::jsonb)) as n_notas,
           (jsonb_array_length(coalesce(p.notas, '[]'::jsonb)) > 0 or lower(coalesce(p.status, '')) like 'faturado%') as fat
      from pedidos_sap p
  )
  select b.ordem,
         b.cod_cliente,
         coalesce(c.nome_fantasia, c.razao_social),
         rc.rota,
         vend.nome,
         b.dt_criacao,
         b.dt_entrega,
         b.valor,
         b.status,
         b.tp_ped,
         b.plataforma,
         b.pedido_externo,
         b.n_notas,
         coalesce(c.pagamento_antecipado, false),
         b.fat,
         (current_date - b.dt_criacao),
         count(*) over ()
    from base b
    left join rc on rc.cod_cliente = b.cod_cliente
    left join vend on vend.rota = rc.rota
    left join clientes c on c.cod_cliente = b.cod_cliente
   where b.dt_criacao between p_ini and p_fim
     and (coalesce(p_vendedor, '') = '' or p_vendedor = any (vend.cods))
     and (coalesce(p_status, '') = '' or lower(coalesce(b.status, '')) = lower(p_status))
     and (not coalesce(p_antecipado, false) or coalesce(c.pagamento_antecipado, false))
     and (not coalesce(p_pendentes, false) or (not b.fat and lower(coalesce(b.status, '')) <> 'recusado'))
     and (coalesce(p_busca, '') = ''
          or b.ordem ilike '%' || p_busca || '%'
          or b.cod_cliente ilike '%' || p_busca || '%'
          or coalesce(c.nome_fantasia, '') ilike '%' || p_busca || '%'
          or coalesce(c.razao_social, '') ilike '%' || p_busca || '%'
          or coalesce(b.pedido_externo, '') ilike '%' || p_busca || '%')
   order by b.dt_criacao desc, b.ordem desc
   limit least(coalesce(p_limite, 50), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Clientes: mesma funcao, agora SEM os bloqueados (a nao ser que p_situacao = 'bloqueados')
create or replace function fn_clientes_painel(
  p_vendedor text, p_busca text, p_escritorio text, p_canal text, p_situacao text, p_limite integer, p_offset integer
)
returns table (
  cod_cliente text, nome text, razao_social text, cnpjcpf text, cidade text, uf text,
  bloqueado boolean, pagamento_antecipado boolean, rota text, vendedor text,
  escritorio text, canal text, ultima_compra date, valor_12m numeric, vencido numeric, total bigint
)
language sql stable as $$
  with rc as (
    select cod_cliente, min(rota) as rota from rota_clientes group by cod_cliente
  ),
  vend as (
    select rota, string_agg(nome, ' / ' order by nome) as nome, array_agg(cod_vendedor) as cods
      from vendedores where rota is not null group by rota
  ),
  compras as (
    select cod_cliente,
           max(dt_criacao) as ultima,
           sum(valor) filter (where dt_criacao >= current_date - 365) as v12
      from pedidos_sap
     where lower(coalesce(status, '')) <> 'recusado'
     group by cod_cliente
  ),
  venc as (
    select cod_cliente, sum(valor) as v from titulos where status = 'Atrasado' group by cod_cliente
  )
  select c.cod_cliente,
         coalesce(c.nome_fantasia, c.razao_social),
         c.razao_social,
         c.cnpjcpf,
         c.endereco ->> 'cidade',
         c.endereco ->> 'uf',
         c.bloqueado,
         c.pagamento_antecipado,
         rc.rota,
         vend.nome,
         c.areas -> 0 -> 'escritorio' ->> 'descricao',
         c.areas -> 0 -> 'canal' ->> 'descricao',
         compras.ultima,
         coalesce(compras.v12, 0),
         coalesce(venc.v, 0),
         count(*) over ()
    from clientes c
    left join rc on rc.cod_cliente = c.cod_cliente
    left join vend on vend.rota = rc.rota
    left join compras on compras.cod_cliente = c.cod_cliente
    left join venc on venc.cod_cliente = c.cod_cliente
   where (coalesce(p_vendedor, '') = '' or p_vendedor = any (vend.cods))
     and (coalesce(p_escritorio, '') = '' or c.areas -> 0 -> 'escritorio' ->> 'codigo' = p_escritorio)
     and (coalesce(p_canal, '') = '' or c.areas -> 0 -> 'canal' ->> 'codigo' = p_canal)
     and (coalesce(p_busca, '') = ''
          or c.cod_cliente ilike '%' || p_busca || '%'
          or coalesce(c.nome_fantasia, '') ilike '%' || p_busca || '%'
          or coalesce(c.razao_social, '') ilike '%' || p_busca || '%'
          or coalesce(c.cnpjcpf, '') ilike '%' || p_busca || '%')
     -- bloqueados so aparecem no filtro proprio
     and (case when coalesce(p_situacao, '') = 'bloqueados' then c.bloqueado else not c.bloqueado end)
     and case coalesce(p_situacao, '')
           when 'parados'    then compras.ultima is null or compras.ultima < current_date - 90
           when 'vencidos'   then coalesce(venc.v, 0) > 0
           when 'antecipado' then c.pagamento_antecipado
           else true
         end
   order by coalesce(c.nome_fantasia, c.razao_social, c.cod_cliente)
   limit least(coalesce(p_limite, 50), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;
