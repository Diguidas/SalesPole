-- Desconto por incentivo tambem por LINHA, GRUPO, CATEGORIA e MARCA do produto.
-- Os valores sao os textos do cadastro do produto (os mesmos que aparecem na ficha tecnica do app),
-- sem diferenciar maiuscula/minuscula. Preencher mais de um = o produto precisa bater em todos.
-- Alvo da regra (o que compra): cod_produto OU classificacao (linha/grupo/categoria/marca) OU nada (qualquer produto).
-- Continua valendo o escopo (quem compra): geral | cliente | vendedor | canal | escritorio.
alter table incentivos_desconto add column if not exists linha     text;
alter table incentivos_desconto add column if not exists grupo     text;
alter table incentivos_desconto add column if not exists categoria text;
alter table incentivos_desconto add column if not exists marca     text;

-- Quantidade minima 0 = SEM minimo: o desconto vale desde a primeira unidade (ex.: 'marca X tem 5%').
alter table incentivos_desconto drop constraint if exists incentivos_desconto_qtd_minima_check;
alter table incentivos_desconto add constraint incentivos_desconto_qtd_minima_check check (qtd_minima >= 0);
