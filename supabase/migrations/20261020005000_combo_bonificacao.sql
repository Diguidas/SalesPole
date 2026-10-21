-- Brinde de combo = ORDEM DE BONIFICACAO (Z011) do mesmo pedido, criada no SAP logo depois da venda (como FERT/HAWA:
-- um pedido do app, varias ordens no SAP). O tipo (ORD_REASON) e o centro de custo vem do combo, dos cadastros
-- "Tipos de bonificacao" e "Centros de custo" do painel (obrigatorios para combo de produto gratis; a API valida ao salvar).

alter table combos add column if not exists tipo_bonificacao text;
alter table combos add column if not exists centro_custo     text;
