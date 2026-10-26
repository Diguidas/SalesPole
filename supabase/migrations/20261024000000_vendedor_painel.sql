-- Vendedor no painel (computador): papel proprio, visita registrada sem GPS/foto e as consultas da tela "Hoje".
--  * papel 'vendedor': ve so a propria carteira (escopo = o vendedor e a rota dele; codigo SAP em usuarios_painel.cod_sap)
--  * visitas.origem: 'app' (check-in com GPS e foto) | 'painel' (registrada no computador, sem GPS nem foto)
--  * fn_meu_roteiro / fn_carteira_parada / fn_titulos_carteira / fn_entregas_dia: o que o app le do SQLite, agora no servidor

alter table usuarios_painel drop constraint if exists usuarios_painel_papel_check;
alter table usuarios_painel add constraint usuarios_painel_papel_check
  check (papel in ('admin','aprovador','consulta','supervisor','gerente','gerente_geral','vendedor'));

alter table visitas add column if not exists origem text not null default 'app' check (origem in ('app', 'painel'));

-- Clientes do roteiro de um dia da semana (1 = segunda ... 7 = domingo), com a situacao de cada um hoje.
create or replace function fn_meu_roteiro(p_rota text, p_dia integer, p_data date)
returns table (
  cod_cliente text, nome text, cidade text, uf text, sequencia integer,
  bloqueado boolean, pagamento_antecipado boolean, limite_disponivel numeric,
  ultima_compra date, dias_sem_comprar integer, vencido numeric,
  visita_id uuid, visita_status text, visita_resultado text, comprou_hoje boolean
)
language sql stable as $$
  select c.cod_cliente,
         coalesce(c.nome_fantasia, c.razao_social),
         c.endereco ->> 'cidade',
         c.endereco ->> 'uf',
         rc.sequencia,
         c.bloqueado,
         c.pagamento_antecipado,
         c.limite_disponivel,
         co.ultima,
         case when co.ultima is null then null else (p_data - co.ultima)::integer end,
         coalesce(ve.v, 0),
         vi.id, vi.status, vi.resultado,
         coalesce(co.hoje, false)
    from (select distinct on (cod_cliente) cod_cliente, sequencia
            from rota_clientes where rota = p_rota and dia_semana = p_dia
           order by cod_cliente, sequencia) rc
    join clientes c on c.cod_cliente = rc.cod_cliente
    left join lateral (
      select max(p.dt_criacao) as ultima, bool_or(p.dt_criacao = p_data) as hoje
        from pedidos_sap p
       where p.cod_cliente = c.cod_cliente and lower(coalesce(p.status, '')) <> 'recusado'
    ) co on true
    left join lateral (
      select sum(t.valor) as v from titulos t where t.cod_cliente = c.cod_cliente and t.status = 'Atrasado'
    ) ve on true
    left join lateral (
      select v.id, v.status, v.resultado
        from visitas v
       where v.cod_cliente = c.cod_cliente and v.data_visita = p_data
       order by (v.status = 'concluida') desc, v.checkin_em desc
       limit 1
    ) vi on true
   order by rc.sequencia, coalesce(c.nome_fantasia, c.razao_social)
$$;

-- Clientes da carteira sem compra ha mais de p_dias dias (ou que nunca compraram).
create or replace function fn_carteira_parada(p_rota text, p_dias integer)
returns table (
  cod_cliente text, nome text, cidade text, uf text, bloqueado boolean,
  ultima_compra date, dias integer, vencido numeric, dias_visita integer[]
)
language sql stable as $$
  with rc as (
    select cod_cliente, array_agg(distinct dia_semana::integer order by dia_semana::integer) as dias
      from rota_clientes where rota = p_rota group by cod_cliente
  )
  select c.cod_cliente,
         coalesce(c.nome_fantasia, c.razao_social),
         c.endereco ->> 'cidade',
         c.endereco ->> 'uf',
         c.bloqueado,
         co.ultima,
         case when co.ultima is null then null else (current_date - co.ultima)::integer end,
         coalesce(ve.v, 0),
         rc.dias
    from rc
    join clientes c on c.cod_cliente = rc.cod_cliente
    left join lateral (
      select max(p.dt_criacao) as ultima
        from pedidos_sap p
       where p.cod_cliente = c.cod_cliente and lower(coalesce(p.status, '')) <> 'recusado'
    ) co on true
    left join lateral (
      select sum(t.valor) as v from titulos t where t.cod_cliente = c.cod_cliente and t.status = 'Atrasado'
    ) ve on true
   where co.ultima is null or co.ultima < current_date - greatest(coalesce(p_dias, 30), 1)
   order by co.ultima nulls first, coalesce(c.nome_fantasia, c.razao_social)
$$;

-- Titulos dos clientes da carteira. p_filtro: 'abertos' (em aberto + atrasados) | 'atrasados' | 'todos' (ultimos 90 dias).
create or replace function fn_titulos_carteira(p_rota text, p_filtro text, p_limite integer default 500)
returns table (
  cod_cliente text, nome text, nfe text, parcela text, status text, valor numeric,
  vencimento date, dt_compensacao date, danfe_url text, boleto_url text, dias_atraso integer
)
language sql stable as $$
  select t.cod_cliente,
         coalesce(c.nome_fantasia, c.razao_social),
         t.nfe, t.parcela, t.status, t.valor, t.vencimento, t.dt_compensacao, t.danfe_url, t.boleto_url,
         case when t.status = 'Atrasado' then (current_date - t.vencimento)::integer else 0 end
    from titulos t
    join clientes c on c.cod_cliente = t.cod_cliente
   where t.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
     and case coalesce(p_filtro, 'abertos')
           when 'atrasados' then t.status = 'Atrasado'
           when 'todos' then t.vencimento >= current_date - 90 or t.status in ('Em aberto', 'Atrasado')
           else t.status in ('Em aberto', 'Atrasado')
         end
   order by t.vencimento, coalesce(c.nome_fantasia, c.razao_social)
   limit least(coalesce(p_limite, 500), 2000)
$$;

-- O que sai para entrega numa data: por cliente, quantas ordens/itens e se algum item foi confirmado a menos (corte).
create or replace function fn_entregas_dia(p_rota text, p_data date)
returns table (cod_cliente text, nome text, ordens bigint, itens bigint, com_corte boolean)
language sql stable as $$
  select r.cod_cliente,
         coalesce(c.nome_fantasia, c.razao_social),
         count(distinct r.ordem),
         count(*),
         coalesce(bool_or(r.quantidade_confirmada is not null and r.quantidade_pedida is not null
                          and r.quantidade_confirmada < r.quantidade_pedida), false)
    from remessas r
    left join clientes c on c.cod_cliente = r.cod_cliente
   where r.data_remessa = p_data
     and r.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
   group by r.cod_cliente, coalesce(c.nome_fantasia, c.razao_social)
   order by 2
$$;

-- Escritorios e canais dos clientes da carteira (os avisos por escritorio/canal valem para quem tem cliente neles).
create or replace function fn_carteira_areas(p_rota text)
returns table (tipo text, codigo text)
language sql stable as $$
  select distinct 'e'::text, a.value -> 'escritorio' ->> 'codigo'
    from clientes c, jsonb_array_elements(coalesce(c.areas, '[]'::jsonb)) a
   where c.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
     and a.value -> 'escritorio' ->> 'codigo' is not null
  union
  select distinct 'c'::text, a.value -> 'canal' ->> 'codigo'
    from clientes c, jsonb_array_elements(coalesce(c.areas, '[]'::jsonb)) a
   where c.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
     and a.value -> 'canal' ->> 'codigo' is not null
$$;
