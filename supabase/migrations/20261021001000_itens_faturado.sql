-- Item do pedido do SAP: situacao (BEZEI sem codigo de recusa, ex.: "Atendido Parcialmente") e o que foi
-- faturado de fato quando difere do pedido (ZSDT139: QTD_FATURADA e PRC_FATURADO / QTD_FATURADA).
-- "recusa" passa a ter texto SO quando ha codigo de recusa (ABGRU).
alter table pedido_itens_sap
  add column if not exists situacao       text,
  add column if not exists qtd_faturada   numeric(15,3),
  add column if not exists valor_faturado numeric(15,4);
