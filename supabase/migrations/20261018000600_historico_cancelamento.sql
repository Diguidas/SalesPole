-- =====================================================================
-- 1) Historico longo (12 meses) SEM pesar o sync do app:
--    * a carga unica (npm run historico:vendedor) traz os pedidos antigos do SAP para o Supabase;
--    * o app NAO baixa pedidos antigos: baixa so totais prontos (por cliente/mes e por cliente/produto).
-- 2) Cancelamento de pedido pelo app: o painel decide em quais status do SAP pode cancelar
--    (tabela parametros, chave 'status_cancelaveis') e toda tentativa fica auditada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Janela de itens: a carga historica busca os itens de pedidos mais antigos que 90 dias
-- ---------------------------------------------------------------------
drop function if exists fn_ordens_para_itens(text);
create or replace function fn_ordens_para_itens(p_rota text, p_dias integer default 90)
returns table (ordem text)
language sql stable as $$
  select p.ordem
  from pedidos_sap p
  where p.cod_cliente in (select cod_cliente from rota_clientes where rota = p_rota)
    and p.dt_criacao >= current_date - p_dias
    and (
      not exists (select 1 from pedido_itens_sap i where i.ordem = p.ordem)
      or p.status in ('A Faturar', 'Faturado Parcial', 'Aguardando Liberação', 'Liberado para faturamento')
    );
$$;

-- ---------------------------------------------------------------------
-- Totais para o app (pedidos recusados nao entram)
-- ---------------------------------------------------------------------
-- vendas por cliente e por mes: graficos de 12 meses e positivacao
create or replace function fn_historico_cliente_mes(p_rota text, p_meses integer default 12)
returns table (cod_cliente text, mes text, valor numeric, pedidos integer)
language sql stable as $$
  select p.cod_cliente,
         to_char(p.dt_criacao, 'YYYY-MM') as mes,
         coalesce(sum(p.valor), 0) as valor,
         count(*)::integer as pedidos
    from pedidos_sap p
   where p.cod_cliente in (select r.cod_cliente from rota_clientes r where r.rota = p_rota)
     and p.dt_criacao >= (date_trunc('month', current_date) - make_interval(months => greatest(p_meses, 1) - 1))::date
     and coalesce(p.status, '') <> 'Recusado'
   group by p.cod_cliente, to_char(p.dt_criacao, 'YYYY-MM');
$$;

-- o que cada cliente compra: ultima compra, quantos pedidos, quantidade e em quantos meses (sem giro, mix, ultimos comprados)
create or replace function fn_historico_cliente_produto(p_rota text, p_meses integer default 12)
returns table (cod_cliente text, cod_produto text, denominacao text, ultima_compra date, pedidos integer,
               quantidade numeric, unidade text, meses_com_compra integer)
language sql stable as $$
  select p.cod_cliente,
         i.cod_produto,
         max(i.denominacao) as denominacao,
         max(p.dt_criacao) as ultima_compra,
         count(distinct i.ordem)::integer as pedidos,
         coalesce(sum(i.quantidade), 0) as quantidade,
         max(i.unidade_venda) as unidade,
         count(distinct to_char(p.dt_criacao, 'YYYY-MM'))::integer as meses_com_compra
    from pedido_itens_sap i
    join pedidos_sap p on p.ordem = i.ordem
   where p.cod_cliente in (select r.cod_cliente from rota_clientes r where r.rota = p_rota)
     and p.dt_criacao >= (date_trunc('month', current_date) - make_interval(months => greatest(p_meses, 1) - 1))::date
     and coalesce(p.status, '') <> 'Recusado'
     and coalesce(i.recusa, '') = ''
     and i.cod_produto is not null
   group by p.cod_cliente, i.cod_produto;
$$;

-- ---------------------------------------------------------------------
-- Parametros do painel (chave -> valor json)
-- ---------------------------------------------------------------------
create table if not exists parametros (
  chave      text primary key,
  valor      jsonb not null,
  descricao  text,
  updated_at timestamptz not null default now()
);
alter table parametros enable row level security;

-- status do pedido (como o SAP devolve) em que o vendedor pode cancelar pelo app. Vazio = cancelamento desligado.
-- Ex.: update parametros set valor = '["A Faturar","Aguardando Liberação"]' where chave = 'status_cancelaveis';
insert into parametros (chave, valor, descricao) values
  ('status_cancelaveis', '[]', 'Status do pedido do SAP em que o vendedor pode cancelar pelo app. Ex.: ["A Faturar","Aguardando Liberação"]. Vazio = cancelamento desligado.')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- Auditoria dos cancelamentos pedidos pelo app
-- ---------------------------------------------------------------------
create table if not exists pedido_cancelamentos (
  id            bigserial primary key,
  ordem         text not null,
  cod_vendedor  text not null,
  status_antes  text,
  motivo        text,
  resultado     text not null check (resultado in ('cancelado', 'recusado', 'erro')),
  http          integer,
  mensagens     jsonb,
  criado_em     timestamptz not null default now()
);
create index if not exists pedido_cancelamentos_ordem_idx on pedido_cancelamentos (ordem, criado_em desc);
alter table pedido_cancelamentos enable row level security;
