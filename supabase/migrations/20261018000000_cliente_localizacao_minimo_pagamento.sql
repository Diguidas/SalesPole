-- Dados novos do cadastro de clientes vindos do SAP (ZSDT015, ZSDT136, KNB1/T042Z).
alter table clientes add column if not exists latitude numeric(10,7);
alter table clientes add column if not exists longitude numeric(10,7);
alter table clientes add column if not exists pedido_minimo numeric(15,2);
alter table clientes add column if not exists formas_pagamento jsonb not null default '[]';  -- [{codigo, descricao}]
