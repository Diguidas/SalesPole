-- Ranking de vendas (versao mais leve para as dimensoes de produto: uma passada so, sem extrair o JSON cinco vezes).

create or replace function fn_ranking_vendas(p_ini date, p_fim date, p_dim text, p_rotas text[] default null, p_limite int default 10)
returns table (chave text, rotulo text, valor numeric, pedidos bigint, clientes bigint)
language plpgsql stable as $fn$
begin
  if p_dim in ('cliente', 'rota', 'escritorio', 'canal') then
    return query
    with rc as (
      select cod_cliente, min(rota) as rota from rota_clientes group by cod_cliente
    ),
    pc as (
      select p.cod_cliente, sum(coalesce(p.valor, 0)) as valor, count(*) as n
        from pedidos_sap p
       where p.dt_criacao between p_ini and p_fim
         and lower(coalesce(p.status, '')) <> 'recusado'
       group by 1
    ),
    base as (
      select pc.cod_cliente, pc.valor, pc.n, rc.rota,
             coalesce(c.nome_fantasia, c.razao_social, pc.cod_cliente) as cliente_nome,
             coalesce(c.areas -> 0 -> 'escritorio' ->> 'codigo', '')    as esc_cod,
             coalesce(c.areas -> 0 -> 'escritorio' ->> 'descricao', '') as esc_desc,
             coalesce(c.areas -> 0 -> 'canal' ->> 'codigo', '')         as canal_cod,
             coalesce(c.areas -> 0 -> 'canal' ->> 'descricao', '')      as canal_desc
        from pc
        join rc on rc.cod_cliente = pc.cod_cliente and (p_rotas is null or rc.rota = any (p_rotas))
        left join clientes c on c.cod_cliente = pc.cod_cliente
    )
    select t.chave, t.rotulo, t.valor, t.pedidos, t.clientes from (
      select b.cod_cliente::text as chave, max(b.cliente_nome)::text as rotulo, sum(b.valor) as valor, sum(b.n)::bigint as pedidos, 1::bigint as clientes
        from base b where p_dim = 'cliente' group by b.cod_cliente
      union all
      select b.rota::text, b.rota::text, sum(b.valor), sum(b.n)::bigint, count(distinct b.cod_cliente)
        from base b where p_dim = 'rota' group by b.rota
      union all
      select b.esc_cod::text, max(b.esc_desc)::text, sum(b.valor), sum(b.n)::bigint, count(distinct b.cod_cliente)
        from base b where p_dim = 'escritorio' group by b.esc_cod
      union all
      select b.canal_cod::text, max(b.canal_desc)::text, sum(b.valor), sum(b.n)::bigint, count(distinct b.cod_cliente)
        from base b where p_dim = 'canal' group by b.canal_cod
    ) t
    order by t.valor desc nulls last
    limit greatest(p_limite, 1);

  elsif p_dim in ('produto', 'grupo', 'linha', 'categoria', 'marca') then
    -- uma passada so: a chave e o nome da dimensao saem de um CASE por linha (sem extrair o JSON do produto para as 5 dimensoes)
    return query
    with rc as (
      select cod_cliente, min(rota) as rota from rota_clientes group by cod_cliente
    ),
    it as (
      select p.cod_cliente, p.ordem, i.cod_produto,
             coalesce(i.quantidade, 0) * coalesce(i.valor_unitario, 0) as v
        from pedidos_sap p
        join pedido_itens_sap i on i.ordem = p.ordem
        join rc on rc.cod_cliente = p.cod_cliente and (p_rotas is null or rc.rota = any (p_rotas))
       where p.dt_criacao between p_ini and p_fim
         and lower(coalesce(p.status, '')) <> 'recusado'
         and coalesce(i.recusa, '') = ''
    ),
    chaves as (
      select it.cod_cliente, it.ordem, it.v,
             case p_dim
               when 'produto'   then it.cod_produto
               when 'grupo'     then coalesce(pr.dados #>> '{classificacao,grupo_id}', '')
               when 'linha'     then coalesce(pr.dados #>> '{classificacao,linha_id}', '')
               when 'categoria' then coalesce(pr.dados #>> '{classificacao,categoria_id}', '')
               else                  coalesce(pr.dados #>> '{classificacao,marca}', '')
             end as k,
             case p_dim
               when 'produto'   then pr.descricao
               when 'grupo'     then pr.dados #>> '{classificacao,grupo}'
               when 'linha'     then pr.dados #>> '{classificacao,linha}'
               when 'categoria' then pr.dados #>> '{classificacao,categoria}'
               else                  pr.dados #>> '{classificacao,marca}'
             end as nome
        from it
        left join produtos pr on pr.cod_produto = it.cod_produto
    )
    select c.k::text, coalesce(max(c.nome), c.k)::text, sum(c.v), count(distinct c.ordem), count(distinct c.cod_cliente)
      from chaves c
     where c.k is not null
     group by c.k
     order by sum(c.v) desc nulls last
     limit greatest(p_limite, 1);
  end if;
end
$fn$;
