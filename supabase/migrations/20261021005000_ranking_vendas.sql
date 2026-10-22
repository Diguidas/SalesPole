-- Rankings da pagina inicial do painel (top N por produto, vendedor, escritorio, canal, grupo, linha, categoria, marca, cliente).
-- Mesmo recorte dos indicadores: pedidos do SAP no periodo, sem os recusados, so clientes com rota (e dentro do escopo do usuario).
-- Dimensoes de produto usam os itens do pedido (quantidade x valor unitario, sem itens recusados) e a classificacao do produto.

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
    return query
    with rc as (
      select cod_cliente, min(rota) as rota from rota_clientes group by cod_cliente
    ),
    it as (
      select p.cod_cliente, p.ordem, i.cod_produto,
             coalesce(i.quantidade, 0) * coalesce(i.valor_unitario, 0) as v
        from pedidos_sap p
        join pedido_itens_sap i on i.ordem = p.ordem
       where p.dt_criacao between p_ini and p_fim
         and lower(coalesce(p.status, '')) <> 'recusado'
         and coalesce(i.recusa, '') = ''
    ),
    base as (
      select it.*, pr.descricao,
             pr.dados #>> '{classificacao,grupo_id}' as grupo_id,     pr.dados #>> '{classificacao,grupo}' as grupo_nome,
             pr.dados #>> '{classificacao,linha_id}' as linha_id,     pr.dados #>> '{classificacao,linha}' as linha_nome,
             pr.dados #>> '{classificacao,categoria_id}' as cat_id,   pr.dados #>> '{classificacao,categoria}' as cat_nome,
             pr.dados #>> '{classificacao,marca}' as marca
        from it
        join rc on rc.cod_cliente = it.cod_cliente and (p_rotas is null or rc.rota = any (p_rotas))
        left join produtos pr on pr.cod_produto = it.cod_produto
    )
    select t.chave, t.rotulo, t.valor, t.pedidos, t.clientes from (
      select b.cod_produto::text as chave, coalesce(max(b.descricao), b.cod_produto)::text as rotulo, sum(b.v) as valor, count(distinct b.ordem) as pedidos, count(distinct b.cod_cliente) as clientes
        from base b where p_dim = 'produto' and b.cod_produto is not null group by b.cod_produto
      union all
      select coalesce(b.grupo_id, '')::text, coalesce(max(b.grupo_nome), '')::text, sum(b.v), count(distinct b.ordem), count(distinct b.cod_cliente)
        from base b where p_dim = 'grupo' group by coalesce(b.grupo_id, '')
      union all
      select coalesce(b.linha_id, '')::text, coalesce(max(b.linha_nome), '')::text, sum(b.v), count(distinct b.ordem), count(distinct b.cod_cliente)
        from base b where p_dim = 'linha' group by coalesce(b.linha_id, '')
      union all
      select coalesce(b.cat_id, '')::text, coalesce(max(b.cat_nome), '')::text, sum(b.v), count(distinct b.ordem), count(distinct b.cod_cliente)
        from base b where p_dim = 'categoria' group by coalesce(b.cat_id, '')
      union all
      select coalesce(b.marca, '')::text, coalesce(b.marca, '')::text, sum(b.v), count(distinct b.ordem), count(distinct b.cod_cliente)
        from base b where p_dim = 'marca' group by coalesce(b.marca, '')
    ) t
    order by t.valor desc nulls last
    limit greatest(p_limite, 1);
  end if;
end
$fn$;
