-- Status do pedido (como o SAP devolve) cujos itens sao ATUALIZADOS a cada sincronizacao.
-- So esses pedidos pagam o custo de recalcular o ciclo no SAP (SUBMIT zsdr124); os demais so tem os itens buscados
-- uma vez (quando ainda nao existem). Antes a lista era fixa dentro de fn_ordens_para_itens.
insert into parametros (chave, valor, descricao) values
  ('status_atualizar_sync', '["A Faturar","Faturado Parcial","Aguardando Liberação","Liberado para faturamento"]',
   'Status do pedido do SAP cujos itens sao atualizados a cada sincronizacao (pedido ainda em andamento). Os demais so tem os itens buscados quando ainda nao existem. Vazio = todos os pedidos dos ultimos 15 dias, de qualquer status.')
on conflict (chave) do nothing;

-- Lista VAZIA = sem filtro por status: atualiza TODOS os pedidos dos ultimos 15 dias (qualquer status).
-- Passa a devolver tambem se a ordem deve ser ATUALIZADA (status marcado) ou so completada (ainda sem itens).
-- p_status: lista de status (sem diferenciar maiuscula/minuscula nem espacos nas pontas).
drop function if exists fn_ordens_para_itens(text, integer);
create or replace function fn_ordens_para_itens(
  p_rota text,
  p_dias integer default 90,
  p_status text[] default array['A Faturar', 'Faturado Parcial', 'Aguardando Liberação', 'Liberado para faturamento']
)
returns table (ordem text, atualizar boolean)
language sql stable as $$
  select p.ordem,
         (case
            when coalesce(cardinality(p_status), 0) = 0 then p.dt_criacao >= current_date - 15
            else lower(btrim(coalesce(p.status, ''))) in (select lower(btrim(s)) from unnest(p_status) s)
          end) as atualizar
  from pedidos_sap p
  where p.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
    and p.dt_criacao >= current_date - p_dias
    and (
      not exists (select 1 from pedido_itens_sap i where i.ordem = p.ordem)
      or (case
            when coalesce(cardinality(p_status), 0) = 0 then p.dt_criacao >= current_date - 15
            else lower(btrim(coalesce(p.status, ''))) in (select lower(btrim(s)) from unnest(p_status) s)
          end)
    );
$$;
