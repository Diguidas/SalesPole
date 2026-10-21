import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prazoProducao, previsaoEntrega, proximaEntrega } from './entrega';
import { avaliarCombos, comBrindes, type Combo } from './combo';
import { avaliarCheckin, distanciaM, RAIO_VISITA_M, textoDistancia } from './geo';
import { ajustarDescontos, descontoTotalMax, faixasDoProduto, incentivoAplicavel, maxManual, type ContextoIncentivo, type Incentivo } from './incentivo';
import { htmlPedido, montarDocPedido } from './pedidoPdf';
import { arredondar } from './numero';
import {
  adicionarItem, aplicarDesconto, definirDesconto, definirQuantidade, estimarTotal, lerDesconto, precoParaEnvio, precoUnitarioFinal, removerItem, validarDesconto,
  type ItemPedido,
} from './pedido';
import {
  areaDoGrupo, converterPreco, escolherPreco, estoqueEmUnidade, fatorBase, grupoDoMaterial, lerConversoes, LinhaPreco,
  precoNaUnidade, precoUnitario, rotuloUnidade, unidadeInterna, type Conversoes,
} from './preco';
import { formatarQuantidade, lerQuantidade, lerRegra, regraNaUnidade, validarQuantidade } from './quantidade';

const linha = (o: Partial<LinhaPreco>): LinhaPreco => ({ kbetr: 10, kpein: 1, kmein: 'KG', datab: '2026-01-01', datbi: '2026-12-31', origem: 'lista', ...o });

test('FERT vai para FERT; HAWA e ZVAR vao juntos; outros nao tem area', () => {
  assert.equal(grupoDoMaterial('FERT'), 'FERT');
  assert.equal(grupoDoMaterial('HAWA'), 'HAWA');
  assert.equal(grupoDoMaterial('ZVAR'), 'HAWA');
  assert.equal(grupoDoMaterial('ROH'), null);
  assert.equal(grupoDoMaterial(null), null);
});

test('area do cliente: cliente sem area HAWA nao compra HAWA/ZVAR', () => {
  const areas = [{ vkorg: '2100', tipo_material: 'FERT', centro: '2100' }];
  assert.equal(areaDoGrupo(areas, 'FERT')?.centro, '2100');
  assert.equal(areaDoGrupo(areas, 'HAWA'), null);
  assert.equal(areaDoGrupo(areas, null), null);
});

test('preco: grupo (A912) vence lista (A913) mesmo sendo mais caro', () => {
  const p = escolherPreco([linha({ kbetr: 99, origem: 'grupo' })], [linha({ kbetr: 5 })], '2026-10-03');
  assert.equal(p?.origem, 'grupo');
  assert.equal(p?.kbetr, 99);
});

test('preco: sem grupo vigente cai para a lista', () => {
  const p = escolherPreco([linha({ origem: 'grupo', datbi: '2026-09-30' })], [linha({ kbetr: 5 })], '2026-10-03');
  assert.equal(p?.origem, 'lista');
});

test('preco: ignora vigencia futura/vencida e valor zero; pega a vigencia mais recente', () => {
  const hoje = '2026-10-03';
  assert.equal(escolherPreco([], [linha({ datab: '2026-11-01' })], hoje), null);
  assert.equal(escolherPreco([], [linha({ datbi: '2026-10-02' })], hoje), null);
  assert.equal(escolherPreco([], [linha({ kbetr: 0 })], hoje), null);
  const p = escolherPreco([], [linha({ kbetr: 1, datab: '2026-01-01' }), linha({ kbetr: 2, datab: '2026-09-01' })], hoje);
  assert.equal(p?.kbetr, 2);
});

test('preco unitario respeita a unidade de preco (por 10)', () => {
  assert.deepEqual(precoUnitario(linha({ kbetr: 50, kpein: 10, kmein: 'CX' })), { valor: 5, unidade: 'CX', origem: 'lista' });
  assert.equal(precoUnitario(null), null);
  assert.equal(precoUnitario(linha({ kbetr: 0 })), null);
});

test('entrega: sabado com entrega seg/sex -> segunda; sexta com so sexta -> sexta da semana seguinte', () => {
  assert.equal(proximaEntrega([1, 5], new Date(2026, 9, 3)), '2026-10-05'); // sabado 03/10
  assert.equal(proximaEntrega([5], new Date(2026, 9, 2)), '2026-10-09'); // sexta 02/10 -> nunca o proprio dia
  assert.equal(proximaEntrega([], new Date(2026, 9, 3)), '2026-10-05'); // sem cadastro: seg-sab
  assert.equal(proximaEntrega([], new Date(2026, 9, 2)), '2026-10-03'); // sexta -> sabado
  assert.equal(proximaEntrega([7], new Date(2026, 9, 3)), '2026-10-04'); // domingo
});

test('entrega: virada de mes e ano', () => {
  assert.equal(proximaEntrega([1], new Date(2026, 11, 31)), '2027-01-04'); // quinta 31/12 -> segunda 04/01
});

test('quantidade: virgula, 3 casas, rejeita zero/negativo/lixo', () => {
  assert.equal(lerQuantidade('10'), 10);
  assert.equal(lerQuantidade('10,5'), 10.5);
  assert.equal(lerQuantidade(' 2.250 '), 2.25);
  for (const ruim of ['0', '-1', 'abc', '1,2345', '', '1e3', '10,']) assert.equal(lerQuantidade(ruim), null, ruim);
  assert.equal(formatarQuantidade(10.5), '10.5');
  assert.equal(formatarQuantidade(10), '10');
});

test('regra do produto: minimo e multiplo', () => {
  const regra = lerRegra({ pedido: { quantidademinima: '6.000', multiplo: '6' } });
  assert.deepEqual(regra, { minimo: 6, multiplo: 6 });
  assert.equal(validarQuantidade(12, regra), null);
  assert.match(validarQuantidade(3, regra)!, /mínima/);
  assert.match(validarQuantidade(7, regra)!, /múltipla/);
  assert.equal(validarQuantidade(5, lerRegra({ pedido: { quantidademinima: '0', multiplo: '0' } })), null); // 0 = sem regra
  assert.equal(validarQuantidade(0.3, { minimo: null, multiplo: 0.1 }), null); // ponto flutuante nao atrapalha
});

test('carrinho: mesmo produto na mesma unidade soma; unidade diferente e outro item', () => {
  let itens = adicionarItem([], { produto: '10', unidade: 'CX', quantidade: '2' });
  itens = adicionarItem(itens, { produto: '10', unidade: 'CX', quantidade: '1.5' });
  itens = adicionarItem(itens, { produto: '10', unidade: 'UN', quantidade: '4' });
  assert.deepEqual(itens, [
    { produto: '10', unidade: 'CX', quantidade: '3.5' },
    { produto: '10', unidade: 'UN', quantidade: '4' },
  ]);
  itens = definirQuantidade(itens, '10', 'UN', 8);
  assert.equal(itens[1].quantidade, '8');
  assert.deepEqual(removerItem(itens, '10', 'CX').map((i) => i.unidade), ['UN']);
});

test('total estimado: so conta quando a unidade do preco e a de venda', () => {
  const itens = [
    { produto: '1', unidade: 'CX', quantidade: '2' },
    { produto: '2', unidade: 'CX', quantidade: '1' }, // preco por KG: nao da para estimar
    { produto: '3', unidade: 'CX', quantidade: '1' }, // sem preco
  ];
  const r = estimarTotal(itens, { '1': { valor: 12.5, unidade: 'CX' }, '2': { valor: 9, unidade: 'KG' } });
  assert.deepEqual(r, { total: 25, semEstimativa: 2 });
});


// A CAIXA neste SAP e a unidade KI (texto "CX"). 1 KI = 10 KG; base = KG
const KG: Conversoes = { base: 'KG', fatores: { KI: 10 }, textos: { KI: 'CX', KG: 'KG' } };
// 1 KI = 12 UN; base = UN
const UN: Conversoes = { base: 'UN', fatores: { KI: 12, DP: 6 }, textos: { KI: 'CX' } };

test('conversao: fator em unidades base', () => {
  assert.equal(fatorBase('KG', KG), 1); // a propria base
  assert.equal(fatorBase('KI', KG), 10);
  assert.equal(fatorBase('CX', KG), null); // "CX" e so o TEXTO: nao e codigo de unidade
  assert.equal(fatorBase('PEC', KG), null); // desconhecida
  assert.equal(fatorBase(null, KG), null);
});

test('preco por KG vira preco por CAIXA (KI); por UN tambem; mesma unidade nao converte', () => {
  assert.equal(converterPreco(12, 'KG', 'KI', KG), 120);
  assert.equal(converterPreco(3, 'UN', 'KI', UN), 36);
  assert.equal(converterPreco(36, 'KI', 'UN', UN), 3); // e de volta
  assert.equal(converterPreco(50, 'KI', 'KI', KG), 50);
  assert.equal(converterPreco(12, 'KG', 'PEC', KG), null); // sem conversao conhecida
  assert.equal(converterPreco(12, null, 'KI', KG), null);
  assert.equal(converterPreco(5, 'KI', 'DP', UN), 2.5); // entre duas unidades alternativas
});

test('preco na unidade do pedido: guarda o preco da tabela quando converte', () => {
  const p = precoNaUnidade(linha({ kbetr: 12, kpein: 1, kmein: 'KG' }), 'KI', KG);
  assert.deepEqual(p, { valor: 120, unidade: 'KI', origem: 'lista', tabela: { valor: 12, unidade: 'KG' } });
  // por 10 KG: R$ 100 / 10 = R$ 10/KG -> R$ 100/KI
  assert.equal(precoNaUnidade(linha({ kbetr: 100, kpein: 10, kmein: 'KG' }), 'KI', KG)?.valor, 100);
  // lista de precos JA em caixa (o caso real: KMEIN = KI): nada a converter
  assert.deepEqual(precoNaUnidade(linha({ kbetr: 135.6, kpein: 1, kmein: 'KI' }), 'KI', KG), { valor: 135.6, unidade: 'KI', origem: 'lista' });
  // sem conversao: devolve na unidade da tabela (referencia)
  assert.deepEqual(precoNaUnidade(linha({ kbetr: 9, kmein: 'PEC' }), 'KI', KG), { valor: 9, unidade: 'PEC', origem: 'lista' });
  assert.equal(precoNaUnidade(null, 'KI', KG), null);
});

test('estoque na unidade base vira estoque em caixas', () => {
  assert.equal(estoqueEmUnidade(55, 'KI', KG), 5.5);
  assert.equal(estoqueEmUnidade(6, 'KI', UN), 0.5); // 6 UN nao fecha 1 caixa de 12
  assert.equal(estoqueEmUnidade(100, 'KI', { base: 'KI', fatores: {}, textos: {} }), 100);
  assert.equal(estoqueEmUnidade(10, 'PEC', KG), null);
});

test('minimo e multiplo do cadastro estao em KG: viram CAIXAS (12 KG com 12 KG por caixa = multiplo 1)', () => {
  const caixa12: Conversoes = { base: 'KG', fatores: { KI: 12 }, textos: {} };
  assert.deepEqual(regraNaUnidade({ minimo: null, multiplo: 12 }, 'KI', caixa12), { minimo: null, multiplo: 1 });
  assert.deepEqual(regraNaUnidade({ minimo: 24, multiplo: 12 }, 'KI', caixa12), { minimo: 2, multiplo: 1 });
  // o caso real do 300554: caixa de 7 KG
  assert.deepEqual(regraNaUnidade({ minimo: null, multiplo: 7 }, 'KI', { base: 'KG', fatores: { KI: 7 }, textos: {} }), { minimo: null, multiplo: 1 });
  // na propria unidade base ou sem conversao: nao mexe
  assert.deepEqual(regraNaUnidade({ minimo: 5, multiplo: 5 }, 'KG', caixa12), { minimo: 5, multiplo: 5 });
  assert.deepEqual(regraNaUnidade({ minimo: 5, multiplo: 5 }, 'PEC', caixa12), { minimo: 5, multiplo: 5 });
  // valor minusculo vira "sem regra", nunca zero
  assert.deepEqual(regraNaUnidade({ minimo: 0.001, multiplo: null }, 'KI', caixa12), { minimo: null, multiplo: null });
  // e a validacao passa a funcionar em caixas
  assert.equal(validarQuantidade(3, regraNaUnidade({ minimo: null, multiplo: 12 }, 'KI', caixa12)), null); // 3 caixas
  assert.match(validarQuantidade(1.5, regraNaUnidade({ minimo: null, multiplo: 12 }, 'KI', caixa12))!, /múltipla/);
});

test('dados do SAP: codigo, texto e conversoes (formato real do 300517)', () => {
  const c = lerConversoes({
    unidade_base: 'KG', unidade_base_texto: 'KG', unidade_venda: 'KI', unidade_venda_texto: 'CX',
    conversoes: [{ unidade: 'KG', texto: 'KG', fator: 1 }, { unidade: 'KI', texto: 'CX', fator: 12 }, { unidade: 'UN', texto: 'UN', fator: 0.2 }],
  });
  assert.equal(c.base, 'KG');
  assert.deepEqual(c.fatores, { KG: 1, KI: 12, UN: 0.2 });
  assert.equal(rotuloUnidade('KI', c), 'CX'); // o vendedor le CX
  assert.equal(rotuloUnidade('KG', c), 'KG');
  assert.equal(rotuloUnidade('XX', c), 'XX'); // desconhecida: mostra o codigo
  assert.equal(rotuloUnidade(null, c), 'un');
  assert.equal(rotuloUnidade('KI', lerConversoes({})), 'CX'); // dados antigos: padrao da caixa
  assert.deepEqual(lerConversoes({}).fatores, {});
});

test('codigo interno a partir do texto: o SAP devolve "CX" nos itens, o pedido novo precisa de "KI"', () => {
  const c = lerConversoes({ unidade_base: 'KG', unidade_base_texto: 'KG', unidade_venda: 'KI', unidade_venda_texto: 'CX', conversoes: [{ unidade: 'KI', texto: 'CX', fator: 12 }] });
  assert.equal(unidadeInterna('CX', c), 'KI');
  assert.equal(unidadeInterna('KI', c), 'KI'); // ja e codigo
  assert.equal(unidadeInterna('KG', c), 'KG');
  assert.equal(unidadeInterna('ZZZ', c), 'ZZZ');
});


test('preco para o SAP (ZPR2): por caixa, com 2 casas; so quando o preco esta na unidade do pedido', () => {
  assert.equal(precoParaEnvio({ valor: 90.93, unidade: 'KI' }, 'KI'), '90.93'); // o caso real: lista em caixa
  assert.equal(precoParaEnvio({ valor: 76.585, unidade: 'KI' }, 'KI'), '76.59'); // arredonda
  assert.equal(precoParaEnvio({ valor: 120, unidade: 'KI' }, 'KI'), '120.00');
  // preco por KG que nao deu para converter NAO pode ir como se fosse por caixa
  assert.equal(precoParaEnvio({ valor: 12, unidade: 'KG' }, 'KI'), null);
  assert.equal(precoParaEnvio(undefined, 'KI'), null); // sem preco: o SAP usa a lista
  assert.equal(precoParaEnvio({ valor: 0, unidade: 'KI' }, 'KI'), null);
});

test('arredondamento decimal exato (nao pode perder centavo no preco que vai ao SAP)', () => {
  assert.equal(arredondar(76.585, 2), 76.59); // 76.585 * 100 = 7658.4999... em ponto flutuante
  assert.equal(arredondar(1.005, 2), 1.01);
  assert.equal(arredondar(2.675, 2), 2.68);
  assert.equal(arredondar(90.93, 2), 90.93);
  assert.equal(arredondar(0.5, 0), 1);
  assert.equal(arredondar(1 / 3, 3), 0.333);
  assert.equal(arredondar(1e-7, 2), 0); // notacao cientifica nao quebra
  // e o preco enviado ao SAP herda isso
  assert.equal(precoParaEnvio({ valor: 1.005, unidade: 'KI' }, 'KI'), '1.01');
});

test('o preco do item sobrevive a mudar a quantidade e a somar o mesmo produto', () => {
  let itens: ItemPedido[] = [{ produto: '1', unidade: 'KI', quantidade: '2', preco: '90.93' }];
  itens = definirQuantidade(itens, '1', 'KI', 5);
  assert.equal(itens[0].preco, '90.93');
  itens = adicionarItem(itens, { produto: '1', unidade: 'KI', quantidade: '1' });
  assert.deepEqual(itens, [{ produto: '1', unidade: 'KI', quantidade: '6', preco: '90.93' }]);
});

test('desconto: leitura do que o vendedor digita', () => {
  assert.equal(lerDesconto(''), 0);
  assert.equal(lerDesconto('5'), 5);
  assert.equal(lerDesconto('5,5'), 5.5);
  assert.equal(lerDesconto('2.25'), 2.25);
  assert.equal(lerDesconto('2,255'), null); // so 2 casas
  assert.equal(lerDesconto('abc'), null);
  assert.equal(lerDesconto('-1'), null);
  assert.equal(lerDesconto('101'), null);
});

test('desconto: respeita o maximo da lista (sem maximo = nao pode)', () => {
  assert.equal(validarDesconto(0, undefined), null); // sem desconto e sempre valido
  assert.equal(validarDesconto(3, 5), null);
  assert.equal(validarDesconto(5, 5), null); // no limite pode
  assert.match(validarDesconto(5.01, 5) ?? '', /m[aá]ximo: 5%/i);
  assert.match(validarDesconto(1, undefined) ?? '', /n[aã]o permite/i);
  assert.match(validarDesconto(1, 0) ?? '', /n[aã]o permite/i);
});

test('desconto: preco enviado = tabela x (1 - desconto), 2 casas', () => {
  assert.equal(aplicarDesconto(100, 5), 95);
  assert.equal(aplicarDesconto(83.65, 3), 81.14); // 81.1405
  assert.equal(aplicarDesconto(100, null), 100);
  assert.equal(precoParaEnvio({ valor: 125.88, unidade: 'KI', descontoMax: 4 }, 'KI', 2), '123.36'); // 123.3624
  assert.equal(precoParaEnvio({ valor: 125.88, unidade: 'KI', descontoMax: 4 }, 'KI', 0), '125.88');
  assert.equal(precoParaEnvio({ valor: 125.88, unidade: 'KI', descontoMax: 4 }, 'KI', null), '125.88');
  // defesa: desconto acima do maximo (ou lista sem desconto) e ignorado, nunca enviado
  assert.equal(precoParaEnvio({ valor: 125.88, unidade: 'KI', descontoMax: 4 }, 'KI', 10), '125.88');
  assert.equal(precoParaEnvio({ valor: 125.88, unidade: 'KI' }, 'KI', 2), '125.88');
});

test('desconto: fica no item, soma no carrinho e entra no total estimado', () => {
  let itens: ItemPedido[] = [{ produto: '1', unidade: 'KI', quantidade: '2', desconto: 5 }];
  itens = adicionarItem(itens, { produto: '1', unidade: 'KI', quantidade: '1' });
  assert.equal(itens[0].quantidade, '3');
  assert.equal(itens[0].desconto, 5); // adicionar sem desconto nao apaga o que ja tinha
  itens = definirDesconto(itens, '1', 'KI', 0);
  assert.equal(itens[0].desconto, null);
  itens = definirDesconto(itens, '1', 'KI', 2);
  const r = estimarTotal(itens, { '1': { valor: 100, unidade: 'KI', descontoMax: 5 } });
  assert.equal(r.total, 294); // 3 x 98
});

// ---- prazo de producao na entrega ----
test('entrega respeita o prazo de producao: cliente entrega ter+qui, compra na segunda', () => {
  const seg = new Date(2026, 9, 19); // segunda 19/10/2026
  assert.equal(proximaEntrega([2, 4], seg), '2026-10-20'); // prazo 1 (padrao): amanha
  assert.equal(proximaEntrega([2, 4], seg, 1), '2026-10-20');
  assert.equal(proximaEntrega([2, 4], seg, 2), '2026-10-22'); // terca ja nao da tempo de produzir
  assert.equal(proximaEntrega([2], seg, 2), '2026-10-27');
  assert.equal(proximaEntrega([], seg, 2), '2026-10-21'); // sem cadastro: seg-sab
});

test('prazo de producao do cadastro: ausente/invalido = 1', () => {
  assert.equal(prazoProducao('2'), 2);
  assert.equal(prazoProducao(1), 1);
  assert.equal(prazoProducao(''), 1);
  assert.equal(prazoProducao(undefined), 1);
  assert.equal(prazoProducao('0'), 1);
  assert.equal(prazoProducao('abc'), 1);
});

// ---- desconto por incentivo ----
const ctx: ContextoIncentivo = { codCliente: '100', codVendedor: 'V1', canais: ['10'], escritorios: ['E1'] };
const inc = (o: Partial<Incentivo>): Incentivo => ({
  id: 'x', cod_produto: 'P1', escopo: 'geral', escopo_valor: null, qtd_minima: 10, desconto_pct: 4, desconto_extra_max_pct: 2, ...o,
});

test('incentivo so vale a partir da quantidade minima e escolhe a maior faixa atingida', () => {
  const rows = [inc({ id: 'a', qtd_minima: 10, desconto_pct: 4 }), inc({ id: 'b', qtd_minima: 20, desconto_pct: 7 })];
  assert.equal(incentivoAplicavel(rows, 'P1', 9, ctx), null);
  assert.equal(incentivoAplicavel(rows, 'P1', 10, ctx)?.id, 'a');
  assert.equal(incentivoAplicavel(rows, 'P1', 25, ctx)?.id, 'b');
  assert.equal(incentivoAplicavel(rows, 'OUTRO', 25, ctx), null);
});

test('incentivo por escopo: cliente, vendedor, canal e escritorio so valem para quem e do escopo', () => {
  const rows = [
    inc({ id: 'cli', escopo: 'cliente', escopo_valor: '999' }),
    inc({ id: 'ven', escopo: 'vendedor', escopo_valor: 'V2' }),
    inc({ id: 'can', escopo: 'canal', escopo_valor: '20' }),
    inc({ id: 'esc', escopo: 'escritorio', escopo_valor: 'E9' }),
  ];
  assert.equal(incentivoAplicavel(rows, 'P1', 50, ctx), null);
  rows.push(inc({ id: 'canok', escopo: 'canal', escopo_valor: '10' }));
  assert.equal(incentivoAplicavel(rows, 'P1', 50, ctx)?.id, 'canok');
});

test('incentivo: na mesma faixa vence o escopo mais especifico, e o com produto vence o sem produto', () => {
  const rows = [
    inc({ id: 'geral', escopo: 'geral' }),
    inc({ id: 'canal', escopo: 'canal', escopo_valor: '10' }),
    inc({ id: 'cliente', escopo: 'cliente', escopo_valor: '100' }),
    inc({ id: 'semProduto', escopo: 'cliente', escopo_valor: '100', cod_produto: null }),
  ];
  assert.equal(incentivoAplicavel(rows, 'P1', 10, ctx)?.id, 'cliente');
  assert.equal(incentivoAplicavel(rows.filter((r) => r.id !== 'cliente'), 'P1', 10, ctx)?.id, 'semProduto');
  assert.deepEqual(faixasDoProduto(rows, 'P1', ctx).length, 4);
});

test('tetos: vendedor = lista + extra; total = lista + incentivo + extra', () => {
  assert.equal(maxManual(3, null), 3);
  assert.equal(maxManual(3, inc({})), 5); // 3 + 2 extra
  assert.equal(descontoTotalMax(3, inc({})), 9); // 3 + 2 + 4
  assert.equal(descontoTotalMax(0, null), 0);
});

test('ajustarDescontos: soma incentivo + parte do vendedor e respeita o teto na quantidade atual', () => {
  const rows = [inc({ qtd_minima: 10, desconto_pct: 4, desconto_extra_max_pct: 2 })];
  const item = (q: string, manual?: number): ItemPedido => ({ produto: 'P1', unidade: 'KI', quantidade: q, descontoManual: manual ?? null });
  // lista permite 3%: com 10 caixas, incentivo 4% + vendedor 3% = 7%
  const a = ajustarDescontos([item('10', 3)], { P1: 3 }, rows, ctx)[0];
  assert.equal(a.desconto, 7); assert.equal(a.descontoManual, 3); assert.equal(a.descontoLiberado, 9);
  // vendedor quer 10%: limitado a 3 + 2 = 5% -> total 9%
  assert.equal(ajustarDescontos([item('10', 10)], { P1: 3 }, rows, ctx)[0].desconto, 9);
  // baixou a quantidade: perde o incentivo; o vendedor volta ao maximo da lista (3%)
  const b = ajustarDescontos([item('9', 5)], { P1: 3 }, rows, ctx)[0];
  assert.equal(b.desconto, 3); assert.equal(b.descontoLiberado, 3);
  // item antigo (so `desconto`): vira a parte do vendedor
  assert.equal(ajustarDescontos([{ produto: 'P1', unidade: 'KI', quantidade: '1', desconto: 2 }], { P1: 3 }, rows, ctx)[0].descontoManual, 2);
  // lista sem desconto e sem incentivo: tudo zera
  const c = ajustarDescontos([item('1', 5)], { P1: 0 }, rows, ctx)[0];
  assert.equal(c.desconto, null); assert.equal(c.descontoManual, null);
});

test('preco final aceita o desconto liberado pelo incentivo, mesmo acima do maximo da lista', () => {
  const rows = [inc({ qtd_minima: 10, desconto_pct: 4, desconto_extra_max_pct: 2 })];
  const [i] = ajustarDescontos([{ produto: 'P1', unidade: 'KI', quantidade: '10', descontoManual: 2 }], { P1: 0 }, rows, ctx);
  assert.equal(i.desconto, 6); // 4% incentivo + 2% extra, com lista sem desconto
  assert.equal(precoUnitarioFinal({ valor: 100, unidade: 'KI', descontoMax: 0 }, i), 94);
  // sem o teto liberado o desconto seria ignorado (defesa)
  assert.equal(precoUnitarioFinal({ valor: 100, unidade: 'KI', descontoMax: 0 }, { ...i, descontoLiberado: null }), 100);
});

test('incentivo por classificacao: ID da linha/grupo/categoria e marca (todos os preenchidos precisam bater; zeros a esquerda do ID nao importam)', () => {
  const cls = { linha_id: '0003', grupo_id: '12', categoria_id: '0007', marca: 'Pole' };
  const porLinha = inc({ id: 'linha', cod_produto: null, linha_id: '3' });
  assert.equal(incentivoAplicavel([porLinha], 'PX', 10, ctx, cls)?.id, 'linha'); // '3' = '0003'
  assert.equal(incentivoAplicavel([porLinha], 'PX', 10, ctx, { ...cls, linha_id: '4' }), null);
  assert.equal(incentivoAplicavel([porLinha], 'PX', 10, ctx), null); // produto sem classificacao nao bate
  // varios criterios juntos: todos precisam bater
  const linhaEMarca = inc({ id: 'lm', cod_produto: null, linha_id: '0003', marca: 'POLE' });
  assert.equal(incentivoAplicavel([linhaEMarca], 'PX', 10, ctx, cls)?.id, 'lm'); // marca sem diferenciar caixa
  assert.equal(incentivoAplicavel([linhaEMarca], 'PX', 10, ctx, { ...cls, marca: 'Outra' }), null);
  // cada dimensao sozinha
  for (const campo of ['grupo_id', 'categoria_id', 'marca'] as const) {
    const r = inc({ id: campo, cod_produto: null, [campo]: cls[campo] });
    assert.equal(incentivoAplicavel([r], 'PX', 10, ctx, cls)?.id, campo);
    assert.equal(incentivoAplicavel([r], 'PX', 10, ctx, { ...cls, [campo]: '999' }), null);
  }
  // o NOME da linha nao e criterio: so o ID
  assert.equal(incentivoAplicavel([inc({ cod_produto: null, linha_id: '3' })], 'PX', 10, ctx, { linha: 'Premium' }), null);
});

test('incentivo: no empate, produto especifico > mais criterios de classificacao > menos criterios > qualquer produto', () => {
  const cls = { linha_id: '3', grupo_id: '12' };
  const rows = [
    inc({ id: 'qualquer', cod_produto: null }),
    inc({ id: 'linha', cod_produto: null, linha_id: '3' }),
    inc({ id: 'linhaGrupo', cod_produto: null, linha_id: '3', grupo_id: '12' }),
  ];
  assert.equal(incentivoAplicavel(rows, 'PX', 10, ctx, cls)?.id, 'linhaGrupo');
  assert.equal(incentivoAplicavel(rows.slice(0, 2), 'PX', 10, ctx, cls)?.id, 'linha');
  assert.equal(incentivoAplicavel(rows.slice(0, 1), 'PX', 10, ctx, cls)?.id, 'qualquer');
  rows.push(inc({ id: 'codigo', cod_produto: 'PX' }));
  assert.equal(incentivoAplicavel(rows, 'PX', 10, ctx, cls)?.id, 'codigo');
  // o escopo (quem compra) ainda manda mais que o alvo: regra do cliente vence a de produto especifico
  rows.push(inc({ id: 'cli', cod_produto: null, escopo: 'cliente', escopo_valor: '100' }));
  assert.equal(incentivoAplicavel(rows, 'PX', 10, ctx, cls)?.id, 'cli');
  // quantidade minima maior vence tudo
  rows.push(inc({ id: 'maior', cod_produto: null, qtd_minima: 50, desconto_pct: 1 }));
  assert.equal(incentivoAplicavel(rows, 'PX', 60, ctx, cls)?.id, 'maior');
});

test('ajustarDescontos usa a classificacao de cada produto', () => {
  const rows = [inc({ cod_produto: null, linha_id: '3', qtd_minima: 5, desconto_pct: 3, desconto_extra_max_pct: 0 })];
  const itens: ItemPedido[] = [
    { produto: 'A', unidade: 'KI', quantidade: '5' },
    { produto: 'B', unidade: 'KI', quantidade: '5' },
  ];
  const r = ajustarDescontos(itens, {}, rows, ctx, { A: { linha_id: '0003' }, B: { linha_id: '4' } });
  assert.equal(r[0].desconto, 3);
  assert.equal(r[1].desconto, null);
});

test('incentivo sem quantidade minima (0): vale desde a primeira unidade; faixa maior ainda vence quando atingida', () => {
  const fixo = inc({ id: 'fixo', cod_produto: null, marca: 'Pole', qtd_minima: 0, desconto_pct: 5, desconto_extra_max_pct: 0 });
  const faixa = inc({ id: 'faixa', cod_produto: null, marca: 'Pole', qtd_minima: 20, desconto_pct: 8 });
  const cls = { marca: 'Pole' };
  assert.equal(incentivoAplicavel([fixo, faixa], 'PX', 1, ctx, cls)?.id, 'fixo');
  assert.equal(incentivoAplicavel([fixo, faixa], 'PX', 0.5, ctx, cls)?.id, 'fixo');
  assert.equal(incentivoAplicavel([fixo, faixa], 'PX', 20, ctx, cls)?.id, 'faixa');
  assert.equal(incentivoAplicavel([fixo], 'PX', 1, ctx, { marca: 'Outra' }), null);
  // escritorio + produto especifico, sem quantidade minima
  const esc = inc({ id: 'esc', cod_produto: 'P1', escopo: 'escritorio', escopo_valor: 'E1', qtd_minima: 0, desconto_pct: 5, desconto_extra_max_pct: 2 });
  assert.equal(incentivoAplicavel([esc], 'P1', 1, ctx)?.id, 'esc'); // ctx.escritorios = ['E1']
  assert.equal(incentivoAplicavel([esc], 'P2', 1, ctx), null);
  assert.equal(incentivoAplicavel([{ ...esc, escopo_valor: 'E9' }], 'P1', 1, ctx), null);
});

test('entrega: pedido depois das 17h conta como de amanha (corte)', () => {
  const dias = [1, 2, 3, 4, 5, 6];
  const seg10h = new Date(2026, 9, 19, 10, 0); // segunda 19/10/2026 10:00
  const seg1659 = new Date(2026, 9, 19, 16, 59);
  const seg17h = new Date(2026, 9, 19, 17, 0);
  const seg18h = new Date(2026, 9, 19, 18, 30);
  assert.deepEqual(previsaoEntrega(dias, seg10h), { data: '2026-10-20', aposCorte: false, feriadosPulados: [] });
  assert.equal(previsaoEntrega(dias, seg1659).aposCorte, false);
  assert.equal(previsaoEntrega(dias, seg17h).aposCorte, true); // 17:00 em ponto ja e depois do corte
  assert.equal(previsaoEntrega(dias, seg18h).data, '2026-10-21'); // conta como terca: entrega na quarta
  assert.equal(previsaoEntrega(dias, seg18h).aposCorte, true);
  // sexta depois das 17h: conta como sabado; sabado e dia de entrega -> segunda? (sabado + 1 = domingo, sem entrega) -> segunda
  const sex18h = new Date(2026, 9, 23, 18, 0);
  assert.equal(previsaoEntrega(dias, sex18h).data, '2026-10-26');
  // corte somado ao prazo de producao de 2 dias
  assert.equal(previsaoEntrega(dias, seg18h, 2).data, '2026-10-22');
});

test('entrega: feriado nunca recebe entrega e e avisado', () => {
  const dias = [1, 2, 3, 4, 5, 6];
  const seg = new Date(2026, 10, 2, 10, 0); // segunda 02/11/2026 (Finados), 10h
  // amanha (03/11) nao e feriado
  assert.equal(previsaoEntrega(dias, seg).data, '2026-11-03');
  // quinta 12/11 10h: amanha sexta 13 ok; mas se 13/11 for feriado vai para sabado 14
  const quinta = new Date(2026, 10, 12, 10, 0);
  const r = previsaoEntrega(dias, quinta, 1, new Set(['2026-11-13']));
  assert.deepEqual(r, { data: '2026-11-14', aposCorte: false, feriadosPulados: ['2026-11-13'] });
  // cliente entrega so ter e qui; quinta (feriado) pula para a terca seguinte
  const seg19 = new Date(2026, 9, 19, 10, 0);
  assert.equal(previsaoEntrega([2, 4], seg19, 2, new Set(['2026-10-22'])).data, '2026-10-27');
  assert.deepEqual(previsaoEntrega([2, 4], seg19, 2, new Set(['2026-10-22'])).feriadosPulados, ['2026-10-22']);
  // feriado em dia que o cliente nem recebe nao e "pulado" (nao interfere nem avisa)
  assert.deepEqual(previsaoEntrega([2, 4], seg19, 1, new Set(['2026-10-21'])).feriadosPulados, []);
  // proximaEntrega (sem corte) tambem respeita feriados
  assert.equal(proximaEntrega(dias, new Date(2026, 9, 19), 1, new Set(['2026-10-20'])), '2026-10-21');
});

test('geo: distancia entre pontos (haversine) e texto', () => {
  assert.equal(distanciaM(-16.6869, -49.2648, -16.6869, -49.2648), 0);
  const cem = distanciaM(-16.6869, -49.2648, -16.6869 + 0.0009, -49.2648); // 0,0009 grau de latitude ~ 100 m
  assert.ok(cem > 95 && cem < 105, String(cem));
  const umKm = distanciaM(-23.55, -46.63, -23.55, -46.63 + 0.0098); // ~1 km em Sao Paulo
  assert.ok(umKm > 950 && umKm < 1050, String(umKm));
  assert.equal(textoDistancia(85), '85 m');
  assert.equal(textoDistancia(1234), '1,2 km');
  assert.equal(textoDistancia(null), '—');
});

test('geo: check-in avalia o raio de 150 m (so avisa) e cliente sem coordenada fica sem referencia', () => {
  assert.equal(RAIO_VISITA_M, 150);
  const cliente = { lat: -16.6869, lng: -49.2648 };
  const perto = avaliarCheckin({ lat: -16.6869 + 0.0009, lng: -49.2648 }, cliente); // ~100 m
  assert.equal(perto.foraDoRaio, false);
  assert.equal(perto.semReferencia, false);
  const longe = avaliarCheckin({ lat: -16.6869 + 0.0045, lng: -49.2648 }, cliente); // ~500 m
  assert.equal(longe.foraDoRaio, true);
  assert.ok(longe.distanciaM! > 450 && longe.distanciaM! < 550);
  const limite = avaliarCheckin({ lat: -16.6869 + 0.00135, lng: -49.2648 }, cliente); // ~150 m
  assert.ok(limite.distanciaM! >= 148 && limite.distanciaM! <= 152, String(limite.distanciaM));
  assert.deepEqual(avaliarCheckin({ lat: 1, lng: 1 }, { lat: null, lng: null }), { distanciaM: null, foraDoRaio: false, semReferencia: true });
});

// ---------------------------------------------------------------- combos

const ctxCombo: ContextoIncentivo = { codCliente: '100', codVendedor: '7', canais: ['10'], escritorios: ['E1'] };
const itemQ = (produto: string, q: string): ItemPedido => ({ produto, unidade: 'KI', quantidade: q });
const comboBase = (o: Partial<Combo>): Combo => ({
  id: 'c1', nome: 'X e Y ganha Z', escopo: 'geral', escopo_valor: null, beneficio: 'produto_gratis', brinde_cod_produto: 'Z', brinde_qtd: 1,
  desconto_pct: null, desconto_extra_max_pct: 0, repete: false, max_repeticoes: null,
  itens: [{ alvo_tipo: 'produto', alvo_valor: 'X', qtd_minima: 10 }, { alvo_tipo: 'produto', alvo_valor: 'Y', qtd_minima: 5 }], ...o,
});

test('combo: compro X e Y, ganho Z (so quando os dois atingem o minimo)', () => {
  const c = comboBase({});
  assert.equal(avaliarCombos([c], [itemQ('X', '10'), itemQ('Y', '5')], ctxCombo).brindes[0].quantidade, 1);
  const parcial = avaliarCombos([c], [itemQ('X', '10'), itemQ('Y', '4')], ctxCombo);
  assert.equal(parcial.brindes.length, 0);
  assert.equal(parcial.incompletos[0].faltas[0].falta, 1);
  assert.equal(avaliarCombos([c], [itemQ('X', '30')], ctxCombo).brindes.length, 0);
});

test('combo: repete a cada condicao completa, respeitando o maximo', () => {
  const itens = [itemQ('X', '30'), itemQ('Y', '10')];
  assert.equal(avaliarCombos([comboBase({ repete: true })], itens, ctxCombo).brindes[0].quantidade, 2);
  assert.equal(avaliarCombos([comboBase({ repete: true, max_repeticoes: 1 })], itens, ctxCombo).brindes[0].quantidade, 1);
  assert.equal(avaliarCombos([comboBase({ repete: false })], itens, ctxCombo).brindes[0].quantidade, 1);
});

test('combo: condicao por marca/linha usa a classificacao e nao conta a mesma quantidade duas vezes', () => {
  const c = comboBase({ itens: [{ alvo_tipo: 'marca', alvo_valor: 'Pole', qtd_minima: 10 }, { alvo_tipo: 'produto', alvo_valor: 'X', qtd_minima: 6 }] });
  const cls = { X: { marca: 'Pole' }, W: { marca: 'Pole' } };
  // X (6) vai para o item de produto; sobra W (5) para a marca: 5 < 10, nao fecha
  assert.equal(avaliarCombos([c], [itemQ('X', '6'), itemQ('W', '5')], ctxCombo, cls).brindes.length, 0);
  assert.equal(avaliarCombos([c], [itemQ('X', '6'), itemQ('W', '10')], ctxCombo, cls).brindes.length, 1);
});

test('combo: escopo (cliente/canal/escritorio) e brinde nao entra na condicao', () => {
  const itens = [itemQ('X', '10'), itemQ('Y', '5')];
  assert.equal(avaliarCombos([comboBase({ escopo: 'cliente', escopo_valor: '999' })], itens, ctxCombo).brindes.length, 0);
  assert.equal(avaliarCombos([comboBase({ escopo: 'canal', escopo_valor: '10' })], itens, ctxCombo).brindes.length, 1);
  assert.equal(avaliarCombos([comboBase({ escopo: 'escritorio', escopo_valor: 'E2,E1' })], itens, ctxCombo).brindes.length, 1);
  const comBrinde = [itemQ('X', '10'), { ...itemQ('Y', '5'), brinde: true }];
  assert.equal(avaliarCombos([comboBase({})], comBrinde, ctxCombo).brindes.length, 0);
});

test('combo: desconto % nos itens da condicao; vence o maior entre combo e incentivo; brinde fica sem desconto', () => {
  const c = comboBase({ beneficio: 'desconto_pct', brinde_cod_produto: null, brinde_qtd: null, desconto_pct: 5, desconto_extra_max_pct: 2 });
  const itens = [itemQ('X', '10'), itemQ('Y', '5'), itemQ('W', '1')];
  const r = avaliarCombos([c], itens, ctxCombo);
  assert.deepEqual(r.descontoPorProduto, { X: { pct: 5, extra: 2 }, Y: { pct: 5, extra: 2 } });
  const inc: Incentivo = { id: 'i', cod_produto: 'X', escopo: 'geral', escopo_valor: null, qtd_minima: 0, desconto_pct: 3, desconto_extra_max_pct: 1 };
  const aj = ajustarDescontos(itens, {}, [inc], ctxCombo, {}, r.descontoPorProduto);
  assert.equal(aj[0].desconto, 5);
  assert.equal(aj[0].descontoLiberado, 7);
  assert.equal(aj[2].desconto, null);
  const incMaior: Incentivo = { ...inc, desconto_pct: 8, desconto_extra_max_pct: 0 };
  assert.equal(ajustarDescontos(itens, {}, [incMaior], ctxCombo, {}, r.descontoPorProduto)[0].desconto, 8);
  const brinde = comBrindes(itens, [{ produto: 'Z', quantidade: 2, comboId: 'c1', comboNome: 'n' }], { Z: 'CX' });
  assert.equal(brinde[brinde.length - 1].unidade, 'CX');
  assert.equal(ajustarDescontos(brinde, {}, [], ctxCombo)[brinde.length - 1].desconto, null);
  assert.equal(estimarTotal(brinde, {}).semEstimativa, 3); // o brinde nao entra nem como "sem estimativa"
});

// ---------------------------------------------------------------- PDF com brinde de combo

test('PDF: brinde de combo sai com desconto total (combo), preco final zero, e entra nos descontos concedidos', () => {
  const doc = montarDocPedido({
    pedido: {
      id: 'p1', codigo: '1', criado_em: '2026-10-20T12:00:00Z', dt_entrega: null, status: 'enviado', tipo: 'venda', cond_pagamento: null,
      ordem_compra_cliente: null, endereco_entrega: null, observacao: null, ordens_sap: [],
      itens: [
        { produto: 'X', unidade: 'KI', quantidade: '10', preco: '100.00', preco_tabela: '100.00', desconto: null },
        { produto: 'Z', unidade: 'KI', quantidade: '2', preco: null, preco_tabela: '50.00', desconto: 100, brinde: true },
      ],
    },
    cliente: null, vendedor: null, tipo_bonificacao: null, fotos_url: '', gerado_em: '2026-10-20T12:00:00Z',
    produtos: { X: { descricao: 'Produto X', tipo_material: 'FERT' }, Z: { descricao: 'Produto Z', tipo_material: 'FERT' } },
  });
  const itens = doc.folhas.flatMap((f) => f.itens);
  const z = itens.find((i) => i.produto === 'Z')!;
  assert.equal(z.brinde, true);
  assert.equal(z.precoFinal, 0);
  assert.equal(z.total, 0);
  assert.equal(z.descontoPct, 100);
  assert.equal(z.totalTabela, 100);
  const html = htmlPedido(doc);
  assert.ok(html.includes('Desconto total'));
  assert.ok(html.includes('BRINDE DO COMBO'));
});

test('carrinho: comprar o mesmo produto do brinde pagando cria outra linha; o brinde nao e tocado', () => {
  const brinde: ItemPedido = { produto: 'Z', unidade: 'KI', quantidade: '1', brinde: true, comboId: 'c1' };
  let itens = adicionarItem([itemQ('X', '10'), brinde], itemQ('Z', '2'));
  assert.equal(itens.length, 3);
  assert.equal(itens.find((i) => i.produto === 'Z' && !i.brinde)?.quantidade, '2');
  itens = definirQuantidade(itens, 'Z', 'KI', 5);
  assert.equal(itens.find((i) => i.brinde)?.quantidade, '1');
  assert.equal(itens.find((i) => i.produto === 'Z' && !i.brinde)?.quantidade, '5');
  assert.equal(removerItem(itens, 'Z', 'KI').filter((i) => i.produto === 'Z').length, 1); // so o brinde sobra (o combo o recalcula)
});
