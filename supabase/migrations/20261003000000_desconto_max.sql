-- Desconto maximo (%) que o vendedor pode dar por item, vindo do SAP (MXWRT x ZSDT138). 0 = sem desconto.
alter table precos_lista add column if not exists desconto_max numeric(5,2) not null default 0;
alter table precos_grupo add column if not exists desconto_max numeric(5,2) not null default 0;
