-- Pedido criado pelo painel em nome de um vendedor: guarda quem criou (auditoria).
-- null = pedido feito pelo proprio vendedor no app.
alter table pedidos_app add column if not exists criado_por_painel text;
