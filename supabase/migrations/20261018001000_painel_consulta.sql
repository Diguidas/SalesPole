-- =====================================================================
-- Painel: consulta geral de pedidos e de clientes (com paginacao no banco)
--  * a rota de um cliente/pedido e a da carteira (rota_clientes); cliente em mais de uma rota fica na menor
--  * o vendedor e o(s) da rota (vendedores.rota)
--  * cada funcao devolve `total` (todas as linhas do filtro) junto com a pagina pedida
-- =====================================================================

-- quem cancelou o pedido (cancelamento feito pelo painel); null = pedido pelo proprio vendedor no app
alter table pedido_cancelamentos add column if not exists por text;

-- ---------------------------------------------------------------------
-- Pedidos do SAP
-- ---------------------------------------------------------------------
create or replace function fn_pedidos_painel(
  p_ini date, p_fim date, p_vendedor text, p_busca text, p_status text, p_limite integer, p_offset integer
)
returns table (
  ordem text, cod_cliente text, cliente text, rota text, vendedor text,
  dt_criacao date, dt_entrega date, valor numeric, status text, tp_ped text, plataforma text,
  pedido_externo text, notas integer, total bigint
)
language sql stable as $$
  with rc as (
    select cod_cliente, min(rota) as rota from rota_clientes group by cod_cliente
  ),
  vend as (
    select rota, string_agg(nome, ' / ' order by nome) as nome, array_agg(cod_vendedor) as cods
      from vendedores where rota is not null group by rota
  )
  select p.ordem,
         p.cod_cliente,
         coalesce(c.nome_fantasia, c.razao_social),
         rc.rota,
         vend.nome,
         p.dt_criacao,
         p.dt_entrega,
         p.valor,
         p.status,
         p.tp_ped,
         p.plataforma,
         p.pedido_externo,
         jsonb_array_length(coalesce(p.notas, '[]'::jsonb)),
         count(*) over ()
    from pedidos_sap p
    left join rc on rc.cod_cliente = p.cod_cliente
    left join vend on vend.rota = rc.rota
    left join clientes c on c.cod_cliente = p.cod_cliente
   where p.dt_criacao between p_ini and p_fim
     and (coalesce(p_vendedor, '') = '' or p_vendedor = any (vend.cods))
     and (coalesce(p_status, '') = '' or lower(coalesce(p.status, '')) = lower(p_status))
     and (coalesce(p_busca, '') = ''
          or p.ordem ilike '%' || p_busca || '%'
          or p.cod_cliente ilike '%' || p_busca || '%'
          or coalesce(c.nome_fantasia, '') ilike '%' || p_busca || '%'
          or coalesce(c.razao_social, '') ilike '%' || p_busca || '%'
          or coalesce(p.pedido_externo, '') ilike '%' || p_busca || '%')
   order by p.dt_criacao desc, p.ordem desc
   limit least(coalesce(p_limite, 50), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- ---------------------------------------------------------------------
-- Clientes (carteira): ultima compra, volume de 12 meses e titulo vencido
--  p_situacao: '' | 'bloqueados' | 'parados' (sem compra ha 90 dias) | 'vencidos' (titulo atrasado) | 'antecipado'
-- ---------------------------------------------------------------------
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
     and case coalesce(p_situacao, '')
           when 'bloqueados' then c.bloqueado
           when 'parados'    then compras.ultima is null or compras.ultima < current_date - 90
           when 'vencidos'   then coalesce(venc.v, 0) > 0
           when 'antecipado' then c.pagamento_antecipado
           else true
         end
   order by coalesce(c.nome_fantasia, c.razao_social, c.cod_cliente)
   limit least(coalesce(p_limite, 50), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Escritorios e canais existentes (para os filtros da tela de clientes)
create or replace function fn_clientes_filtros()
returns table (tipo text, codigo text, descricao text)
language sql stable as $$
  select distinct 'escritorio', areas -> 0 -> 'escritorio' ->> 'codigo', areas -> 0 -> 'escritorio' ->> 'descricao'
    from clientes where areas -> 0 -> 'escritorio' ->> 'codigo' is not null
  union
  select distinct 'canal', areas -> 0 -> 'canal' ->> 'codigo', areas -> 0 -> 'canal' ->> 'descricao'
    from clientes where areas -> 0 -> 'canal' ->> 'codigo' is not null
$$;
