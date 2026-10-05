-- =====================================================================
-- Push de pedidos: reserva atomica e fila de retentativa
-- =====================================================================

-- Reserva o pedido para envio ao SAP. Atomica: so um processo consegue.
--  * p_forcar = false: so pedidos 'recebido' ou 'parcial' (fluxo normal e cron)
--  * p_forcar = true : tambem 'erro' (vendedor pediu para reenviar)
--  * 'enviando' parado ha mais de 5 min conta como travado (o processo caiu):
--    pode ser reservado de novo, o que e seguro porque o SAP e idempotente.
-- Devolve a linha reservada, ou nenhuma se outro processo ja pegou / ja foi enviado.
create or replace function fn_pedido_reservar(p_id uuid, p_forcar boolean default false)
returns setof pedidos_app
language sql as $$
  update pedidos_app
     set status = 'enviando',
         tentativas = tentativas + 1,
         proxima_tentativa_em = null
   where id = p_id
     and (
          status in ('recebido', 'parcial')
       or (p_forcar and status = 'erro')
       or (status = 'enviando' and updated_at < now() - interval '5 minutes')
     )
  returning *;
$$;

-- Pedidos prontos para (re)tentar: na fila e com a proxima tentativa vencida,
-- mais os que ficaram travados em 'enviando'.
create or replace function fn_pedidos_pendentes(p_limite integer default 20)
returns setof pedidos_app
language sql stable as $$
  select *
    from pedidos_app
   where (
          status in ('recebido', 'parcial')
      and (proxima_tentativa_em is null or proxima_tentativa_em <= now())
         )
      or (status = 'enviando' and updated_at < now() - interval '5 minutes')
   order by recebido_em
   limit p_limite;
$$;
