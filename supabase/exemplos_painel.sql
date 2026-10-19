-- =====================================================================
-- Exemplos para operar o que o PAINEL WEB vai fazer no futuro.
-- NAO e migration (nao roda sozinho): copie os trechos no SQL Editor do Supabase quando precisar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Cadastros que o vendedor escolhe na BONIFICACAO
-- ---------------------------------------------------------------------
insert into bonificacao_tipos (codigo, descricao) values
  ('115', 'Bonificacao comercial'),
  ('120', 'Amostra / degustacao')
on conflict (codigo) do update set descricao = excluded.descricao, ativo = true;

insert into centros_custo (codigo, descricao) values
  ('2001501007', 'Comercial')
on conflict (codigo) do update set descricao = excluded.descricao, ativo = true;

-- ---------------------------------------------------------------------
-- 2) Aprovar / rejeitar bonificacao
-- ---------------------------------------------------------------------
-- Ver o que esta esperando:
select codigo, cod_vendedor, cod_cliente, tipo_bonificacao, centro_custo, justificativa, itens, recebido_em
  from pedidos_app
 where status = 'aguardando_aprovacao'
 order by recebido_em;

-- Aprovar (o servidor envia ao SAP em ate 1 minuto):
update pedidos_app set status = 'aprovado' where codigo = '0000123' and status = 'aguardando_aprovacao';

-- Rejeitar (o vendedor ve o motivo no app, na aba Analise):
update pedidos_app
   set status = 'rejeitado', motivo_rejeicao = 'Sem verba no centro de custo'
 where codigo = '0000123' and status = 'aguardando_aprovacao';

-- ---------------------------------------------------------------------
-- 3) Destaques e lancamentos (aba Sugestao do pedido)
-- ---------------------------------------------------------------------
insert into produto_destaques (cod_produto, destaque, lancamento, ordem) values
  ('300000', true,  false, 1),
  ('300001', false, true,  2)
on conflict (cod_produto) do update
  set destaque = excluded.destaque, lancamento = excluded.lancamento, ordem = excluded.ordem, ativo = true;

-- ---------------------------------------------------------------------
-- 4) Desconto por incentivo (a partir de X caixas, Y% automatico + ate Z% extra do vendedor)
-- ---------------------------------------------------------------------
-- geral: vale para todos os clientes, so para este produto
insert into incentivos_desconto (cod_produto, escopo, qtd_minima, desconto_pct, desconto_extra_max_pct) values
  ('300000', 'geral', 10, 3, 1),
  ('300000', 'geral', 30, 5, 2);

-- so para um cliente / vendedor / canal / escritorio (escopo_valor = codigo)
insert into incentivos_desconto (cod_produto, escopo, escopo_valor, qtd_minima, desconto_pct, desconto_extra_max_pct) values
  ('300000', 'cliente',    '1048753', 5,  6, 0),
  ('300000', 'vendedor',   '1400065', 20, 4, 1),
  ('300000', 'canal',      '10',      15, 4, 0),
  ('300000', 'escritorio', 'E100',    15, 4, 0);

-- cod_produto vazio = vale para QUALQUER produto naquele escopo (ex.: campanha do canal)
insert into incentivos_desconto (cod_produto, escopo, escopo_valor, qtd_minima, desconto_pct) values
  (null, 'canal', '10', 50, 2);

-- por LINHA, GRUPO e/ou CATEGORIA (use o ID do cadastro: ZSDT131, ZSDT132, ZSDT130; zeros a esquerda nao importam)
-- e/ou MARCA (texto, igual ao do cadastro do produto; maiuscula/minuscula nao importa).
-- Mais de um criterio preenchido = o produto precisa bater em todos. cod_produto fica vazio.
insert into incentivos_desconto (cod_produto, escopo, qtd_minima, desconto_pct, desconto_extra_max_pct, linha_id) values
  (null, 'geral', 10, 3, 1, '3');                                -- toda a linha de ID 3, para todos os clientes

insert into incentivos_desconto (cod_produto, escopo, qtd_minima, desconto_pct, grupo_id, marca) values
  (null, 'geral', 20, 4, '12', 'Pole');                          -- grupo de ID 12 E marca Pole

insert into incentivos_desconto (cod_produto, escopo, escopo_valor, qtd_minima, desconto_pct, categoria_id) values
  (null, 'canal', '10', 15, 2, '7');                             -- categoria de ID 7, so no canal 10

-- SEM quantidade minima (qtd_minima = 0): o desconto vale desde a primeira unidade.
insert into incentivos_desconto (cod_produto, escopo, qtd_minima, desconto_pct, marca) values
  (null, 'geral', 0, 5, 'Pole');                                 -- marca Pole tem 5% sempre

insert into incentivos_desconto (cod_produto, escopo, escopo_valor, qtd_minima, desconto_pct, desconto_extra_max_pct) values
  ('300000', 'escritorio', 'E100', 0, 5, 2);                     -- no escritorio E100, o produto 300000 tem 5% (+ ate 2% extra)

-- vigencia opcional:  vigencia_ini / vigencia_fim (datas). Desligar: update ... set ativo = false.

-- ---------------------------------------------------------------------
-- 5) Feriados (a entrega nunca cai em feriado) e corte das 17h
-- ---------------------------------------------------------------------
-- Ja vem cadastrados os feriados nacionais de 2026 e 2027. uf/cidade vazios = nacional.
insert into feriados (data, descricao) values ('2026-02-17', 'Terça de Carnaval (ponto facultativo)');            -- nacional
insert into feriados (data, descricao, uf) values ('2026-07-09', 'Revolução Constitucionalista', 'SP');          -- estadual
insert into feriados (data, descricao, uf, cidade) values ('2026-10-24', 'Aniversario de Goiania', 'GO', 'Goiânia'); -- municipal (cidade como no endereco do cliente no SAP)

-- Desativar um feriado:  update feriados set ativo = false where data = '2026-02-17';
-- O corte das 17h (horario de Sao Paulo) fica na API: variavel de ambiente HORA_CORTE_PEDIDO (padrao 17).

-- ---------------------------------------------------------------------
-- 6) Visitas: ver e validar (as fotos ficam no bucket privado 'visitas-fotos' por FOTO_VISITA_DIAS dias)
-- ---------------------------------------------------------------------
-- Visitas de hoje, com o que merece atencao (fora do raio, sem fachada, GPS falso, relogio diferente do servidor):
select v.data_visita, v.cod_vendedor, v.cod_cliente, v.status, v.resultado, v.motivo_nao_venda,
       v.distancia_m, v.fora_do_raio, v.sem_referencia, v.checkin_gps_falso,
       round(extract(epoch from (v.checkin_recebido_em - v.checkin_em)) / 60) as minutos_de_diferenca_do_relogio,
       exists (select 1 from visita_fotos f where f.visita_id = v.id and f.tipo = 'fachada' and f.enviada_em is not null) as tem_fachada,
       v.validacao
  from visitas v
 where v.data_visita = current_date
 order by v.fora_do_raio desc, v.checkin_em;

-- Fotos de uma visita (o caminho abre no Storage > visitas-fotos; so existe ate a retencao apagar):
select tipo, caminho, tirada_em, enviada_em, removida_em from visita_fotos where visita_id = '<id da visita>';

-- Validar / recusar (o vendedor ve o resultado no app):
update visitas set validacao = 'validada', validada_por = 'gestor', validada_em = now() where id = '<id da visita>';
update visitas set validacao = 'recusada', validada_por = 'gestor', validada_em = now(), validacao_obs = 'Foto nao e da fachada'
 where id = '<id da visita>';

-- Visitas que ainda esperam validacao:
select data_visita, cod_vendedor, cod_cliente, resultado from visitas where validacao = 'pendente' order by data_visita desc;

-- ---------------------------------------------------------------------
-- 7) Cancelamento de pedido pelo app: o painel decide em quais status do SAP o vendedor pode cancelar
-- ---------------------------------------------------------------------
-- Vazio ([]) = desligado. Use os textos EXATOS que o SAP devolve no status do pedido (caixa e espacos nas pontas nao importam):
update parametros set valor = '["A Faturar", "Aguardando Liberação"]', updated_at = now() where chave = 'status_cancelaveis';
-- Desligar:
update parametros set valor = '[]', updated_at = now() where chave = 'status_cancelaveis';

-- Quem cancelou o que (toda tentativa fica registrada, inclusive as recusadas pelo SAP):
select criado_em, ordem, cod_vendedor, status_antes, resultado, http, motivo, mensagens
  from pedido_cancelamentos order by criado_em desc limit 50;

-- ---------------------------------------------------------------------
-- 8) Historico de 12 meses (carga unica no terminal da API, NAO no SQL):
--      npm run historico:vendedor -- 1400065        (12 meses; ate 1100 dias: ... -- 1400065 540)
--    Leva alguns minutos e pode rodar de novo. Depois o app traz so os totais no proximo sincronizar.
-- Conferir o que o app vai receber:
-- ---------------------------------------------------------------------
select * from fn_historico_cliente_mes('<rota>', 12) order by cod_cliente, mes;
select * from fn_historico_cliente_produto('<rota>', 12) order by cod_cliente, ultima_compra desc;
