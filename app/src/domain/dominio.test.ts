import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proximaEntrega } from './entrega';
import { arredondar } from './numero';
import {
  adicionarItem, aplicarDesconto, definirDesconto, definirQuantidade, estimarTotal, lerDesconto, precoParaEnvio, removerItem, validarDesconto,
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
