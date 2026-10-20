-- fn_clientes_painel estourava o statement timeout: agregava TODOS os pedidos e titulos
-- antes de paginar. Agora filtra/ordena/pagina os clientes primeiro e so calcula
-- compras e vencido (via indices por cod_cliente) para os clientes da pagina.
-- Os filtros 'parados' e 'vencidos' usam exists/subconsulta apenas quando pedidos.

create or replace function fn_clientes_painel(
  p_vendedor text, p_busca text, p_escritorio text, p_canal text, p_situacao text, p_limite integer, p_offset integer
)
returns table (
  cod_cliente text, nome text, razao_social text, cnpjcpf text, cidade text, uf text,
  bloqueado boolean, pagamento_antecipado boolean, rota text, vendedor text,
  escritorio text, canal text, ultima_compra date, valor_12m numeric, vencido numeric, total bigint
)
language plpgsql stable as $fn$
begin
  -- EXECUTE USING: o plano e feito com os valores reais; o plano generico de funcao SQL estourava o timeout
  return query execute $q$
  with rc as (
    select cod_cliente, min(rota) as rota from rota_clientes group by cod_cliente
  ),
  vend as (
    select rota, string_agg(nome, ' / ' order by nome) as nome, array_agg(cod_vendedor) as cods
      from vendedores where rota is not null group by rota
  ),
  base as (
    select c.cod_cliente, c.nome_fantasia, c.razao_social, c.cnpjcpf, c.endereco, c.bloqueado,
           c.pagamento_antecipado, c.areas, rc.rota, vend.nome as vendedor
      from clientes c
      left join rc on rc.cod_cliente = c.cod_cliente
      left join vend on vend.rota = rc.rota
     where (coalesce($1, '') = '' or $1 = any (vend.cods))
       and (coalesce($3, '') = '' or c.areas -> 0 -> 'escritorio' ->> 'codigo' = $3)
       and (coalesce($4, '') = '' or c.areas -> 0 -> 'canal' ->> 'codigo' = $4)
       and (coalesce($2, '') = ''
            or c.cod_cliente ilike '%' || $2 || '%'
            or coalesce(c.nome_fantasia, '') ilike '%' || $2 || '%'
            or coalesce(c.razao_social, '') ilike '%' || $2 || '%'
            or coalesce(c.cnpjcpf, '') ilike '%' || $2 || '%')
       -- bloqueados so aparecem no filtro proprio
       and (case when coalesce($5, '') = 'bloqueados' then c.bloqueado else not c.bloqueado end)
       and (coalesce($5, '') <> 'antecipado' or c.pagamento_antecipado)
       and (coalesce($5, '') <> 'vencidos'
            or exists (select 1 from titulos t where t.cod_cliente = c.cod_cliente and t.status = 'Atrasado'))
       and (coalesce($5, '') <> 'parados'
            or not exists (select 1 from pedidos_sap p
                            where p.cod_cliente = c.cod_cliente
                              and lower(coalesce(p.status, '')) <> 'recusado'
                              and p.dt_criacao >= current_date - 90))
  ),
  pagina as (
    select b.*, count(*) over () as total
      from base b
     order by coalesce(b.nome_fantasia, b.razao_social, b.cod_cliente)
     limit least(coalesce($6, 50), 200)
    offset greatest(coalesce($7, 0), 0)
  )
  select g.cod_cliente,
         coalesce(g.nome_fantasia, g.razao_social),
         g.razao_social,
         g.cnpjcpf,
         g.endereco ->> 'cidade',
         g.endereco ->> 'uf',
         g.bloqueado,
         g.pagamento_antecipado,
         g.rota,
         g.vendedor,
         g.areas -> 0 -> 'escritorio' ->> 'descricao',
         g.areas -> 0 -> 'canal' ->> 'descricao',
         co.ultima,
         coalesce(co.v12, 0),
         coalesce(ve.v, 0),
         g.total
    from pagina g
    left join lateral (
      select max(p.dt_criacao) as ultima,
             sum(p.valor) filter (where p.dt_criacao >= current_date - 365) as v12
        from pedidos_sap p
       where p.cod_cliente = g.cod_cliente and lower(coalesce(p.status, '')) <> 'recusado'
    ) co on true
    left join lateral (
      select sum(t.valor) as v from titulos t where t.cod_cliente = g.cod_cliente and t.status = 'Atrasado'
    ) ve on true
   order by coalesce(g.nome_fantasia, g.razao_social, g.cod_cliente)
  $q$ using p_vendedor, p_busca, p_escritorio, p_canal, p_situacao, p_limite, p_offset;
end
$fn$;
