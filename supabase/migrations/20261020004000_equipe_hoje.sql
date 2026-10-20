-- Resumo do dia por vendedor (modo equipe do app): quantas visitas o roteiro de hoje tem e quantas ja foram feitas.
-- p_dia: 1 = segunda ... 7 = domingo (padrao do SAP/app). p_vendedores null = todos os que tem rota.
create or replace function fn_equipe_hoje(p_dia integer, p_data date, p_vendedores text[] default null)
returns table (
  cod_vendedor text, nome text, escritorio text, equipe text,
  planejadas integer, realizadas integer, em_andamento integer, com_venda integer
)
language sql stable as $$
  select v.cod_vendedor,
         v.nome,
         v.escritorio,
         v.equipe,
         coalesce(p.n, 0)::integer,
         coalesce(r.feitas, 0)::integer,
         coalesce(r.andamento, 0)::integer,
         coalesce(r.vendeu, 0)::integer
    from vendedores v
    left join lateral (
      select count(distinct rc.cod_cliente) as n
        from rota_clientes rc
       where rc.rota = v.rota and rc.dia_semana = p_dia
    ) p on true
    left join lateral (
      -- so conta clientes do roteiro de hoje (como na tela do vendedor)
      select count(distinct vi.cod_cliente) filter (where vi.status = 'concluida') as feitas,
             count(distinct vi.cod_cliente) filter (where vi.status = 'em_andamento') as andamento,
             count(distinct vi.cod_cliente) filter (where vi.status = 'concluida' and vi.resultado = 'vendeu') as vendeu
        from visitas vi
       where vi.cod_vendedor = v.cod_vendedor
         and vi.data_visita = p_data
         and exists (select 1 from rota_clientes rc where rc.rota = v.rota and rc.dia_semana = p_dia and rc.cod_cliente = vi.cod_cliente)
    ) r on true
   where v.rota is not null
     and (p_vendedores is null or v.cod_vendedor = any (p_vendedores))
   order by v.nome
$$;
