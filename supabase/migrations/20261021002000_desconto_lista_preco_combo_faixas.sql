-- 1) Descontos (incentivo por quantidade e combos) tambem por LISTA DE PRECO: escopo 'lista_preco',
--    escopo_valor = codigo da lista (PLTYP) do cliente, varios separados por virgula nos combos.
-- 2) Combos com FAIXAS: depois de cumprida a condicao, o beneficio sobe conforme o total de caixas dos itens da condicao
--    (ex.: 10 cx = 5%, 20 cx = 8%, 50 cx = 12%). Guardado em JSON: [{ "qtd_minima": 20, "desconto_pct": 8, "brinde_qtd": null }].
--    Faixa so vale em combo sem repeticao; sem faixa atingida vale o beneficio base do combo.
-- 3) A condicao aceita VARIOS materiais no mesmo item ("qualquer um destes"): alvo_valor com codigos separados por virgula.

alter table incentivos_desconto drop constraint if exists incentivos_desconto_escopo_check;
alter table incentivos_desconto
  add constraint incentivos_desconto_escopo_check
  check (escopo in ('geral','produto','cliente','vendedor','canal','escritorio','lista_preco'));

alter table combos drop constraint if exists combos_escopo_check;
alter table combos
  add constraint combos_escopo_check
  check (escopo in ('geral','cliente','vendedor','canal','escritorio','lista_preco'));

alter table combos add column if not exists faixas jsonb not null default '[]'::jsonb;

alter table combo_itens drop constraint if exists combo_itens_alvo_valor_check;
alter table combo_itens add constraint combo_itens_alvo_valor_check check (char_length(trim(alvo_valor)) > 0);
