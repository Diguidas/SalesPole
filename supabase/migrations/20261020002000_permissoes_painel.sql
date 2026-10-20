-- Permissoes por usuario do painel (flexiveis): o papel traz um conjunto padrao e o admin liga/desliga cada uma por pessoa.
-- Guarda so o que difere do padrao do papel, ex.: {"comunicados": true, "cancelar_pedido": false}.
alter table usuarios_painel add column if not exists permissoes jsonb not null default '{}';
