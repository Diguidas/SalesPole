-- Hierarquia comercial no painel: supervisor, gerente e gerente geral.
--   supervisor    : ve so os vendedores das equipes (escritorio + equipe) que supervisiona (supervisores.cod_supervisor)
--   gerente       : ve so os vendedores dos supervisores que ele gerencia (supervisores.cod_gerente)
--   gerente_geral : ve tudo, mas nao acessa cadastros nem sistema
-- cod_sap = codigo SAP (LIFNR sem zeros a esquerda) do supervisor/gerente; o admin informa ao cadastrar o usuario.
alter table usuarios_painel drop constraint if exists usuarios_painel_papel_check;
alter table usuarios_painel add constraint usuarios_painel_papel_check
  check (papel in ('admin','aprovador','consulta','supervisor','gerente','gerente_geral'));
alter table usuarios_painel add column if not exists cod_sap text;

-- As consultas ganham p_rotas (null = sem restricao): o escopo do usuario chega como a lista de rotas dos vendedores dele.
drop function if exists fn_pedidos_painel(date, date, text, text, text, boolean, boolean, integer, integer);
create or replace function fn_pedidos_painel(
  p_ini date, p_fim date, p_vendedor text, p_busca text, p_status text,
  p_antecipado boolean, p_pendentes boolean, p_limite integer, p_offset integer,
  p_rotas text[] default null
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
     and (p_rotas is null or rc.rota = any (p_rotas))
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

drop function if exists fn_clientes_painel(text, text, text, text, text, integer, integer);
create or replace function fn_clientes_painel(
  p_vendedor text, p_busca text, p_escritorio text, p_canal text, p_situacao text, p_limite integer, p_offset integer,
  p_rotas text[] default null
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
     where ($8::text[] is null or rc.rota = any ($8))
       and (coalesce($1, '') = '' or $1 = any (vend.cods))
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
  $q$ using p_vendedor, p_busca, p_escritorio, p_canal, p_situacao, p_limite, p_offset, p_rotas;
end
$fn$;

drop function if exists fn_indicadores_vendas_todas(date, date);
create or replace function fn_indicadores_vendas_todas(p_ini date, p_fim date, p_rotas text[] default null)
returns table (
  dim      text,
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
  pc as (
    select p.cod_cliente, to_char(p.dt_criacao, 'YYYY-MM') as mes, sum(coalesce(p.valor, 0)) as valor, count(*) as n
      from pedidos_sap p
     where p.dt_criacao between $1 and $2
       and lower(coalesce(p.status, '')) <> 'recusado'
     group by 1, 2
  ),
  base as materialized (
    select pc.cod_cliente, pc.valor, pc.n, pc.mes, rc.rota,
           coalesce(c.areas -> 0 -> 'escritorio' ->> 'codigo', '')    as esc_cod,
           coalesce(c.areas -> 0 -> 'escritorio' ->> 'descricao', '') as esc_desc,
           coalesce(c.areas -> 0 -> 'canal' ->> 'codigo', '')         as canal_cod,
           coalesce(c.areas -> 0 -> 'canal' ->> 'descricao', '')      as canal_desc
      from pc
      join rc on rc.cod_cliente = pc.cod_cliente and ($3::text[] is null or rc.rota = any ($3))
      left join clientes c on c.cod_cliente = pc.cod_cliente
  )
  select 'mes', mes, max(mes), sum(valor), sum(n)::bigint, count(distinct cod_cliente) from base group by mes
  union all
  select 'rota', rota, max(rota), sum(valor), sum(n)::bigint, count(distinct cod_cliente) from base group by rota
  union all
  select 'escritorio', esc_cod, max(esc_desc), sum(valor), sum(n)::bigint, count(distinct cod_cliente) from base group by esc_cod
  union all
  select 'canal', canal_cod, max(canal_desc), sum(valor), sum(n)::bigint, count(distinct cod_cliente) from base group by canal_cod
  $q$ using p_ini, p_fim, p_rotas;
end
$fn$;
