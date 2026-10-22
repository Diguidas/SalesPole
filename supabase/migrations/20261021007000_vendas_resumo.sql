-- Resumo de vendas por mes para os rankings da pagina inicial. Somar os itens de milhoes de linhas a cada clique estourava o
-- tempo do banco; agora os rankings leem estas tabelas pequenas (uma linha por mes, cliente e produto), que a API refaz mes a mes
-- (o mes atual com frequencia, os anteriores uma vez por dia).
--  vendas_cliente_mes : valor e pedidos do cliente no mes (pedidos do SAP, sem recusados)
--  vendas_produto_mes : valor do produto vendido ao cliente no mes (quantidade x valor unitario, sem itens recusados)

create table if not exists vendas_cliente_mes (
  mes         date    not null,
  cod_cliente text    not null,
  valor       numeric not null default 0,
  pedidos     integer not null default 0,
  primary key (mes, cod_cliente)
);
create table if not exists vendas_produto_mes (
  mes         date    not null,
  cod_cliente text    not null,
  cod_produto text    not null,
  valor       numeric not null default 0,
  primary key (mes, cod_cliente, cod_produto)
);
create index if not exists vendas_produto_mes_cliente_idx on vendas_produto_mes (cod_cliente);
create table if not exists vendas_resumo_estado (
  mes           date primary key,
  atualizado_em timestamptz not null default now(),
  linhas_cliente integer not null default 0,
  linhas_produto integer not null default 0
);
alter table vendas_cliente_mes   enable row level security;
alter table vendas_produto_mes   enable row level security;
alter table vendas_resumo_estado enable row level security;

-- Refaz UM mes (p_mes = dia 1). Chamada pela API, um mes por vez, para cada consulta ser curta.
create or replace function fn_vendas_resumo_mes(p_mes date)
returns void
language plpgsql as $fn$
declare
  v_ini date := date_trunc('month', p_mes)::date;
  v_fim date := (date_trunc('month', p_mes) + interval '1 month')::date;
  n_cli integer;
  n_prod integer;
begin
  perform set_config('statement_timeout', '180s', true);

  delete from vendas_cliente_mes where mes = v_ini;
  insert into vendas_cliente_mes (mes, cod_cliente, valor, pedidos)
  select v_ini, p.cod_cliente, sum(coalesce(p.valor, 0)), count(*)
    from pedidos_sap p
   where p.dt_criacao >= v_ini and p.dt_criacao < v_fim
     and lower(coalesce(p.status, '')) <> 'recusado'
     and p.cod_cliente is not null
   group by p.cod_cliente;
  get diagnostics n_cli = row_count;

  delete from vendas_produto_mes where mes = v_ini;
  insert into vendas_produto_mes (mes, cod_cliente, cod_produto, valor)
  select v_ini, p.cod_cliente, i.cod_produto, sum(coalesce(i.quantidade, 0) * coalesce(i.valor_unitario, 0))
    from pedidos_sap p
    join pedido_itens_sap i on i.ordem = p.ordem
   where p.dt_criacao >= v_ini and p.dt_criacao < v_fim
     and lower(coalesce(p.status, '')) <> 'recusado'
     and coalesce(i.recusa, '') = ''
     and p.cod_cliente is not null and i.cod_produto is not null
   group by p.cod_cliente, i.cod_produto;
  get diagnostics n_prod = row_count;

  insert into vendas_resumo_estado (mes, atualizado_em, linhas_cliente, linhas_produto)
  values (v_ini, now(), n_cli, n_prod)
  on conflict (mes) do update set atualizado_em = excluded.atualizado_em, linhas_cliente = excluded.linhas_cliente, linhas_produto = excluded.linhas_produto;
end
$fn$;

-- Ranking a partir do resumo: meses inteiros de p_ini ate p_fim, so clientes com rota (e dentro do escopo p_rotas).
create or replace function fn_ranking_resumo(p_ini date, p_fim date, p_dim text, p_rotas text[] default null, p_limite int default 10)
returns table (chave text, rotulo text, valor numeric)
language plpgsql stable as $fn$
declare
  v_ini date := date_trunc('month', p_ini)::date;
begin
  if p_dim in ('cliente', 'rota', 'escritorio', 'canal') then
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
             coalesce(c.areas -> 0 -> 'canal' ->> 'descricao', '')      as canal_desc
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
