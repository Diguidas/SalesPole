-- Cliente com forma de pagamento so 'V' (KNB1-ZWELS) = pagamento ANTECIPADO: nao ha credito.
-- O SAP ja manda o limite disponivel zerado; este indicador deixa o app dizer o motivo ao vendedor.
alter table clientes add column if not exists pagamento_antecipado boolean not null default false;
