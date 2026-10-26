-- Alertas de pedido para o vendedor: o que o SAP cortou, recusou ou faturou a menos nos clientes da carteira dele.
--  * corte:           remessa futura (hoje em diante) em que a quantidade confirmada e menor que a pedida
--  * recusa:          item recusado pelo SAP (tem codigo de recusa) em pedido dos ultimos p_dias dias
--  * faturado_menos:  item faturado em quantidade menor que a pedida (sem recusa) em pedido dos ultimos p_dias dias
-- O vendedor avisa o cliente antes de ele ligar reclamando.

create or replace function fn_meu_alertas(p_rota text, p_dias integer default 7)
returns table (
  tipo text, cod_cliente text, nome text, telefone text, ordem text, item text,
  cod_produto text, denominacao text, unidade text,
  quantidade_pedida numeric, quantidade_confirmada numeric, data_ref date, motivo text, cod_motivo text
)
language sql stable as $$
  with carteira as (
    select distinct cod_cliente from rota_clientes where rota = p_rota
  ),
  corte as (
    select 'corte'::text as tipo, r.cod_cliente, r.ordem, r.item, r.cod_produto, r.denominacao, r.unidade_venda as unidade,
           r.quantidade_pedida, r.quantidade_confirmada, r.data_remessa as data_ref, null::text as motivo, null::text as cod_motivo
      from remessas r
     where r.cod_cliente in (select cod_cliente from carteira)
       and r.data_remessa >= current_date
       and r.quantidade_pedida is not null and r.quantidade_confirmada is not null
       and r.quantidade_confirmada < r.quantidade_pedida
  ),
  itens as (
    select i.ordem, i.item, i.cod_produto, i.denominacao, i.unidade_venda, i.quantidade, i.recusa, i.cod_recusa, i.situacao, i.qtd_faturada,
           p.cod_cliente, p.dt_criacao
      from pedido_itens_sap i
      join pedidos_sap p on p.ordem = i.ordem
     where p.cod_cliente in (select cod_cliente from carteira)
       and p.dt_criacao >= current_date - greatest(coalesce(p_dias, 7), 1)
  ),
  recusa as (
    select 'recusa'::text, cod_cliente, ordem, item, cod_produto, denominacao, unidade_venda, quantidade, null::numeric, dt_criacao, recusa, cod_recusa
      from itens
     where cod_recusa is not null or recusa is not null
  ),
  menos as (
    select 'faturado_menos'::text, cod_cliente, ordem, item, cod_produto, denominacao, unidade_venda, quantidade, qtd_faturada, dt_criacao, situacao, null::text
      from itens
     where cod_recusa is null and recusa is null
       and qtd_faturada is not null and quantidade is not null and qtd_faturada < quantidade
  ),
  todos as (
    select * from corte union all select * from recusa union all select * from menos
  )
  select t.tipo, t.cod_cliente, coalesce(c.nome_fantasia, c.razao_social), c.telefone, t.ordem, t.item,
         t.cod_produto, t.denominacao, t.unidade, t.quantidade_pedida, t.quantidade_confirmada, t.data_ref, t.motivo, t.cod_motivo
    from todos t
    left join clientes c on c.cod_cliente = t.cod_cliente
   order by coalesce(c.nome_fantasia, c.razao_social), t.ordem, t.item, t.tipo
$$;
