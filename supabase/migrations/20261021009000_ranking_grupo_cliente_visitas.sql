-- Ranking por grupo de cliente (rede, KNVV-KDGRP) e visitas por vendedor para a pagina inicial.

create or replace function fn_ranking_resumo(p_ini date, p_fim date, p_dim text, p_rotas text[] default null, p_limite int default 10)
returns table (chave text, rotulo text, valor numeric)
language plpgsql stable as $fn$
declare
  v_ini date := date_trunc('month', p_ini)::date;
begin
  if p_dim in ('cliente', 'rota', 'escritorio', 'canal', 'rede') then
    return query
    with rc as (select cod_cliente, min(rota) as rota from rota_clientes group by cod_cliente),
    s as (
      select v.cod_cliente, sum(v.valor) as valor
        from vendas_cliente_mes v
        join rc on rc.cod_cliente = v.cod_cliente and (p_rotas is null or rc.rota = any (p_rotas))
       where v.mes >= v_ini and v.mes <= p_fim
       group by v.cod_cliente
    ),
    b as (
      select s.cod_cliente, s.valor, rc.rota,
             coalesce(c.nome_fantasia, c.razao_social, s.cod_cliente) as cliente_nome,
             coalesce(c.areas -> 0 -> 'escritorio' ->> 'codigo', '')    as esc_cod,
             coalesce(c.areas -> 0 -> 'escritorio' ->> 'descricao', '') as esc_desc,
             coalesce(c.areas -> 0 -> 'canal' ->> 'codigo', '')         as canal_cod,
             coalesce(c.areas -> 0 -> 'canal' ->> 'descricao', '')      as canal_desc,
             coalesce(c.areas -> 0 -> 'rede' ->> 'codigo', '')          as rede_cod,
             coalesce(c.areas -> 0 -> 'rede' ->> 'descricao', '')       as rede_desc
        from s join rc on rc.cod_cliente = s.cod_cliente
        left join clientes c on c.cod_cliente = s.cod_cliente
    )
    select t.chave, t.rotulo, t.valor from (
      select b.cod_cliente::text as chave, b.cliente_nome::text as rotulo, b.valor from b where p_dim = 'cliente'
      union all
      select b.rota::text, b.rota::text, sum(b.valor) from b where p_dim = 'rota' group by b.rota
      union all
      select b.esc_cod::text, max(b.esc_desc)::text, sum(b.valor) from b where p_dim = 'escritorio' group by b.esc_cod
      union all
      select b.canal_cod::text, max(b.canal_desc)::text, sum(b.valor) from b where p_dim = 'canal' group by b.canal_cod
      union all
      select b.rede_cod::text, max(b.rede_desc)::text, sum(b.valor) from b where p_dim = 'rede' group by b.rede_cod
    ) t
    order by t.valor desc nulls last
    limit greatest(p_limite, 1);

  elsif p_dim in ('produto', 'grupo', 'linha', 'categoria', 'marca') then
    return query
    with rc as (select cod_cliente, min(rota) as rota from rota_clientes group by cod_cliente),
    s as (
      select v.cod_produto, sum(v.valor) as valor
        from vendas_produto_mes v
        join rc on rc.cod_cliente = v.cod_cliente and (p_rotas is null or rc.rota = any (p_rotas))
       where v.mes >= v_ini and v.mes <= p_fim
       group by v.cod_produto
    ),
    k as (
      select s.valor,
             case p_dim
               when 'produto'   then s.cod_produto
               when 'grupo'     then coalesce(pr.dados #>> '{classificacao,grupo_id}', '')
               when 'linha'     then coalesce(pr.dados #>> '{classificacao,linha_id}', '')
               when 'categoria' then coalesce(pr.dados #>> '{classificacao,categoria_id}', '')
               else                  coalesce(pr.dados #>> '{classificacao,marca}', '')
             end as chave,
             case p_dim
               when 'produto'   then pr.descricao
               when 'grupo'     then pr.dados #>> '{classificacao,grupo}'
               when 'linha'     then pr.dados #>> '{classificacao,linha}'
               when 'categoria' then pr.dados #>> '{classificacao,categoria}'
               else                  pr.dados #>> '{classificacao,marca}'
             end as nome
        from s left join produtos pr on pr.cod_produto = s.cod_produto
    )
    select k.chave::text, coalesce(max(k.nome), k.chave)::text, sum(k.valor)
      from k where k.chave is not null
     group by k.chave
     order by sum(k.valor) desc nulls last
     limit greatest(p_limite, 1);
  end if;
end
$fn$;

-- Visitas do periodo por vendedor (a tabela e pequena: consulta direta, sem resumo).
create or replace function fn_visitas_resumo(p_ini date, p_fim date, p_vendedores text[] default null)
returns table (cod_vendedor text, visitas bigint, concluidas bigint, vendeu bigint, fora_do_raio bigint, pendentes bigint, recusadas bigint)
language sql stable as $fn$
  select v.cod_vendedor,
         count(*),
         count(*) filter (where v.status = 'concluida'),
         count(*) filter (where v.resultado = 'vendeu'),
         count(*) filter (where v.fora_do_raio),
         count(*) filter (where v.status = 'concluida' and v.validacao = 'pendente'),
         count(*) filter (where v.validacao = 'recusada')
    from visitas v
   where v.data_visita between p_ini and p_fim
     and (p_vendedores is null or v.cod_vendedor = any (p_vendedores))
   group by v.cod_vendedor
$fn$;
