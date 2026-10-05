// Testes da camada de dados do app contra um SQLite REAL (node:sqlite). Rodar: npm run test:db
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { before, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';
import { buscarProdutos, infoProdutos, rotulo } from '@/db/catalogo';
import {
  aplicarResultado, confirmarPedido, descartarPedido, duplicarPedidoApp, duplicarPedidoSap, lerPedidoApp,
  listarRascunhos, obterOuCriarRascunho, pendentesDeEnvio, salvarCampos, salvarItens,
} from '@/db/pedidos';
import { enviarPendentes } from '@/db/push';
import {
  clientesDoDia, contarFila, itensDoPedidoSap, listarClientes, listarPedidos, listarTitulos, obterCliente,
  obterPedidoSap, pedidosDoCliente, remessasDoDia, titulosDoCliente,
} from '@/db/queries';
import { migrar } from '@/db/schema';
import { aplicarPull, lerMeta, limparBancoLocal, type PullResposta } from '@/db/sync';

// ---- adaptador: a API assincrona do expo-sqlite sobre o node:sqlite ----
function abrirBanco(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  const args = (p: unknown[]) =>
    ((p.length === 1 && Array.isArray(p[0]) ? p[0] : p) as unknown[]).map((v) => (v === undefined ? null : v)) as never[];
  const adaptador = {
    execAsync: async (sql: string) => void raw.exec(sql),
    getAllAsync: async (sql: string, ...p: unknown[]) => raw.prepare(sql).all(...args(p)),
    getFirstAsync: async (sql: string, ...p: unknown[]) => raw.prepare(sql).get(...args(p)) ?? null,
    runAsync: async (sql: string, ...p: unknown[]) => {
      const r = raw.prepare(sql).run(...args(p));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await fn();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    prepareAsync: async (sql: string) => {
      const st = raw.prepare(sql);
      return { executeAsync: async (p: unknown[]) => void st.run(...args([p])), finalizeAsync: async () => undefined };
    },
  };
  return adaptador as unknown as SQLiteDatabase;
}

const HOJE = '2026-10-03';
const FERT = { vkorg: '2100', tipo_material: 'FERT', centro: '2100', lista_preco: { codigo: '01' }, rede: { codigo: '10' } };
const HAWA = { vkorg: '2014', tipo_material: 'HAWA', centro: '2014', lista_preco: { codigo: '02' }, rede: { codigo: '11' } };

/** Resposta de GET /sync/pull no formato real da API (snake_case, jsonb ja convertido). */
function pullBase(): PullResposta {
  return {
    cursor: '2026-10-03T12:00:00.000Z',
    rota: '000159',
    vendedor: { cod: '100409', nome: 'Janser', email: 'a@b.c' },
    carteira: [
      { cod_cliente: 'C1', dia_semana: 1, sequencia: 1 },
      { cod_cliente: 'C2', dia_semana: 1, sequencia: 2 },
      { cod_cliente: 'C1', dia_semana: 5, sequencia: 1 },
      { cod_cliente: 'C3', dia_semana: 2, sequencia: 1 },
    ],
    clientes: [
      { cod_cliente: 'C1', nome_fantasia: 'Mercado Alfa', razao_social: 'Alfa Ltda', cnpjcpf: '10736964000156', telefone: '1133334444', bloqueado: false, endereco: { logradouro: 'Rua A, 10', cidade: 'Goiania', uf: 'GO' }, limite_total: 5000, limite_disponivel: 3200.5, agrupado: false, dias_entrega: [1, 5], classe_risco: { codigo: 'A', descricao: 'Baixo' }, areas: [FERT, HAWA] },
      { cod_cliente: 'C2', nome_fantasia: 'Padaria Beta', razao_social: 'Beta ME', cnpjcpf: '11433800000112', telefone: null, bloqueado: false, endereco: null, limite_total: 1000, limite_disponivel: 0, agrupado: true, dias_entrega: [], classe_risco: null, areas: [FERT] },
      { cod_cliente: 'C3', nome_fantasia: 'Bar Gama', razao_social: 'Gama', cnpjcpf: null, telefone: null, bloqueado: true, endereco: null, limite_total: null, limite_disponivel: null, agrupado: false, dias_entrega: [2], classe_risco: null, areas: [FERT] },
    ],
    produtos: [
      // base KG; 1 caixa (KI, texto CX) = 6 KG. Cadastro: minimo 12 KG (= 2 caixas), multiplo 6 KG (= 1 caixa)
      { cod_produto: 'P1', descricao: 'Queijo Mussarela', tipo: 'A', unidade: 'UN', ean: '789001', ncm: '0406', validade: '90', tipo_material: 'FERT', dados: { pedido: { quantidademinima: '12.000', multiplo: '6.000' }, unidade_base: 'KG', unidade_base_texto: 'KG', unidade_venda: 'KI', unidade_venda_texto: 'CX', conversoes: [{ unidade: 'KI', texto: 'CX', fator: 6 }] } },
      // HAWA: base UN, 1 caixa = 12 UN
      { cod_produto: 'P2', descricao: 'Presunto Fatiado', tipo: 'A', unidade: 'UN', ean: '789002', ncm: '1602', validade: '60', tipo_material: 'HAWA', dados: { unidade_base: 'UN', unidade_base_texto: 'UN', unidade_venda: 'KI', unidade_venda_texto: 'CX', conversoes: [{ unidade: 'KI', texto: 'CX', fator: 12 }] } },
      // ZVAR (vai junto com HAWA): base KG, 1 caixa = 10 KG
      { cod_produto: 'P3', descricao: 'Carne Variavel', tipo: 'A', unidade: 'KG', ean: null, ncm: null, validade: null, tipo_material: 'ZVAR', dados: { unidade_base: 'KG', unidade_base_texto: 'KG', unidade_venda: 'KI', unidade_venda_texto: 'CX', conversoes: [{ unidade: 'KI', texto: 'CX', fator: 10 }] } },
      // dados ANTIGOS (sem unidade_venda/conversoes): cai no padrao da caixa (KI)
      { cod_produto: 'P4', descricao: 'Produto sem preco', tipo: 'A', unidade: 'UN', ean: null, ncm: null, validade: null, tipo_material: 'FERT', dados: null },
      // FERT com 2 KG em estoque = 0,4 caixa (1 caixa = 5 KG): nao aparece
      { cod_produto: 'P5', descricao: 'Produto esgotado', tipo: 'A', unidade: 'UN', ean: null, ncm: null, validade: null, tipo_material: 'FERT', dados: { unidade_base: 'KG', unidade_base_texto: 'KG', unidade_venda: 'KI', unidade_venda_texto: 'CX', conversoes: [{ unidade: 'KI', texto: 'CX', fator: 5 }] } },
      // HAWA: 999 UN no centro ERRADO (2100) e so 6 UN (= 0,5 caixa) no centro certo (2014): nao aparece
      { cod_produto: 'P6', descricao: 'Revenda quase sem estoque', tipo: 'A', unidade: 'UN', ean: null, ncm: null, validade: null, tipo_material: 'HAWA', dados: { unidade_base: 'UN', unidade_base_texto: 'UN', unidade_venda: 'KI', unidade_venda_texto: 'CX', conversoes: [{ unidade: 'KI', texto: 'CX', fator: 12 }] } },
    ],
    estoque: [
      { centro: '2100', cod_produto: 'P1', quantidade: 600, unidade_base: 'KG' }, // 100 caixas
      { centro: '2100', cod_produto: 'P2', quantidade: 999, unidade_base: 'UN' }, // centro ERRADO para HAWA
      { centro: '2100', cod_produto: 'P4', quantidade: 5, unidade_base: 'KG' },
      { centro: '2100', cod_produto: 'P5', quantidade: 2, unidade_base: 'KG' }, // 0,4 caixa
      { centro: '2100', cod_produto: 'P6', quantidade: 999, unidade_base: 'UN' }, // centro ERRADO para HAWA
      { centro: '2014', cod_produto: 'P2', quantidade: 30, unidade_base: 'UN' }, // 2,5 caixas
      { centro: '2014', cod_produto: 'P3', quantidade: 55, unidade_base: 'KG' }, // 5,5 caixas
      { centro: '2014', cod_produto: 'P6', quantidade: 6, unidade_base: 'UN' }, // 0,5 caixa
    ],
    pedidos: [
      { ordem: 'O1', cod_cliente: 'C1', tp_ped: 'Z001', dt_criacao: '2026-10-01', dt_entrega: '2026-10-05', valor: 480, status: 'A Faturar', refaturado: '', pedido_externo: '0000007', plataforma: 'Z010', notas: [{ nota_fiscal: '123', serie: '1', danfe_url: 'http://x/danfe', boleto_url: null }] },
      { ordem: 'O2', cod_cliente: 'C2', tp_ped: 'Z001', dt_criacao: '2026-09-20', dt_entrega: '2026-09-22', valor: 90, status: 'Faturado', refaturado: '', pedido_externo: null, plataforma: null, notas: [] },
    ],
    pedido_itens: [
      { ordem: 'O1', item: '10', cod_produto: 'P1', denominacao: 'Queijo Mussarela', grupo: 'Queijos', quantidade: 12, unidade_venda: 'CX', valor_unitario: 40, recusa: null, cod_recusa: null },
      { ordem: 'O1', item: '20', cod_produto: 'P4', denominacao: 'Produto sem preco', grupo: null, quantidade: 3, unidade_venda: 'CX', valor_unitario: null, recusa: 'Sem estoque', cod_recusa: 'Z1' },
    ],
    pedidos_app: [
      { id: 'a1111111-0000-4000-8000-000000000001', codigo: '0000007', cod_cliente: 'C1', status: 'enviado', recebido_em: '2026-10-01T10:00:00.000Z', dt_entrega: '2026-10-05', ordens_sap: [{ ordem: 'O1', tipo_material: 'FERT', vkorg: '2100' }], erro: null, tentativas: 1, enviado_sap_em: '2026-10-01T10:00:05.000Z', duplicado_de: null, updated_at: '2026-10-01T10:00:05.000Z' },
      { id: 'a2222222-0000-4000-8000-000000000002', codigo: '0000008', cod_cliente: 'C1', status: 'recebido', recebido_em: '2026-10-02T09:00:00.000Z', dt_entrega: null, ordens_sap: [], erro: 'SAP fora do ar', tentativas: 1, enviado_sap_em: null, duplicado_de: null, updated_at: '2026-10-02T09:00:00.000Z' },
    ],
    titulos: [
      { cod_cliente: 'C1', nfe: '100', parcela: '1', status: 'Atrasado', valor: 100, vencimento: '2026-09-20', dt_compensacao: null, ordem: 'O1', danfe_url: null, boleto_url: 'http://x/boleto' },
      { cod_cliente: 'C1', nfe: '101', parcela: '1', status: 'Em aberto', valor: 250, vencimento: '2026-10-20', dt_compensacao: null, ordem: null, danfe_url: null, boleto_url: null },
      { cod_cliente: 'C1', nfe: '099', parcela: '1', status: 'Compensado', valor: 80, vencimento: '2026-09-01', dt_compensacao: '2026-09-02', ordem: null, danfe_url: null, boleto_url: null },
      { cod_cliente: 'C2', nfe: '200', parcela: '1', status: 'Atrasado', valor: 60, vencimento: '2026-09-25', dt_compensacao: null, ordem: null, danfe_url: null, boleto_url: null },
    ],
    precos_lista: [
      { pltyp: '01', cod_produto: 'P1', datab: '2026-01-01', datbi: '2026-12-31', kbetr: 50, kpein: 10, kmein: 'KI', konwa: 'BRL', krech: 'C', preco_kg: null },
      { pltyp: '02', cod_produto: 'P2', datab: '2026-01-01', datbi: '2026-12-31', kbetr: 3, kpein: 1, kmein: 'UN', konwa: 'BRL', krech: 'C', preco_kg: null },
      { pltyp: '02', cod_produto: 'P3', datab: '2026-01-01', datbi: '2026-12-31', kbetr: 12, kpein: 1, kmein: 'KG', konwa: 'BRL', krech: 'C', preco_kg: 12 },
      // P5 e P6 TEM preco: so o estoque os esconde. P4 nao tem preco de proposito.
      { pltyp: '01', cod_produto: 'P5', datab: '2026-01-01', datbi: '2026-12-31', kbetr: 30, kpein: 1, kmein: 'KI', konwa: 'BRL', krech: 'C', preco_kg: null },
      { pltyp: '02', cod_produto: 'P6', datab: '2026-01-01', datbi: '2026-12-31', kbetr: 2, kpein: 1, kmein: 'UN', konwa: 'BRL', krech: 'C', preco_kg: null },
    ],
    precos_grupo: [
      { pltyp: '01', kdgrp: '10', cod_produto: 'P1', datab: '2026-01-01', datbi: '2026-12-31', kbetr: 40, kpein: 1, kmein: 'KI', konwa: 'BRL', krech: 'C', preco_kg: null },
    ],
    remessas: [
      { ordem: 'O1', item: '10', data_remessa: '2026-10-05', cod_cliente: 'C1', tp_ped: 'Z001', cod_produto: 'P1', denominacao: 'Queijo', unidade_venda: 'CX', quantidade_pedida: 12, quantidade_confirmada: 12, peso: 60 },
      { ordem: 'O1', item: '20', data_remessa: '2026-10-05', cod_cliente: 'C1', tp_ped: 'Z001', cod_produto: 'P4', denominacao: 'Outro', unidade_venda: 'CX', quantidade_pedida: 3, quantidade_confirmada: 3, peso: 9 },
      { ordem: 'O9', item: '10', data_remessa: '2026-10-06', cod_cliente: 'C2', tp_ped: 'Z001', cod_produto: 'P1', denominacao: 'Queijo', unidade_venda: 'CX', quantidade_pedida: 6, quantidade_confirmada: 6, peso: 30 },
    ],
    completos: ['precos_lista', 'precos_grupo', 'remessas'],
  };
}

describe('camada de dados do app', () => {
  let db: SQLiteDatabase;

  before(async () => {
    db = abrirBanco();
    await migrar(db);
    await aplicarPull(db, pullBase());
  });

  test('migracao cria o schema e e idempotente', async () => {
    await migrar(db); // 2a vez nao pode falhar nem apagar nada
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    assert.equal(v?.user_version, 3);
    assert.equal((await db.getAllAsync('SELECT 1 FROM clientes')).length, 3);
  });

  test('pull grava meta (cursor, rota, vendedor, ultimo_sync)', async () => {
    assert.equal(await lerMeta(db, 'cursor'), '2026-10-03T12:00:00.000Z');
    assert.equal(await lerMeta(db, 'rota'), '000159');
    assert.equal(JSON.parse((await lerMeta(db, 'vendedor'))!).nome, 'Janser');
    assert.ok(await lerMeta(db, 'ultimo_sync'));
  });

  describe('tela do dia e clientes', () => {
    test('clientes do dia na ordem de visita, com titulos atrasados somados', async () => {
      const segunda = await clientesDoDia(db, 1);
      assert.deepEqual(segunda.map((c) => c.cod_cliente), ['C1', 'C2']);
      assert.equal(segunda[0].atrasados, 1);
      assert.equal(segunda[0].valor_atrasado, 100);
      assert.equal(segunda[1].valor_atrasado, 60);
      assert.deepEqual((await clientesDoDia(db, 5)).map((c) => c.cod_cliente), ['C1']);
      assert.equal((await clientesDoDia(db, 6)).length, 0); // sabado sem roteiro
    });

    test('busca por nome, codigo e CNPJ (com ou sem mascara)', async () => {
      assert.deepEqual((await listarClientes(db, 'alfa')).map((c) => c.cod_cliente), ['C1']);
      assert.deepEqual((await listarClientes(db, 'C2')).map((c) => c.cod_cliente), ['C2']);
      assert.deepEqual((await listarClientes(db, '10.736.964/0001-56')).map((c) => c.cod_cliente), ['C1']);
      assert.deepEqual((await listarClientes(db, '11433800')).map((c) => c.cod_cliente), ['C2']);
      assert.equal((await listarClientes(db, 'zzz')).length, 0);
      assert.equal((await listarClientes(db, '')).length, 3);
    });

    test('remessas de uma data, agrupadas por cliente (inclui fora do roteiro)', async () => {
      const r = await remessasDoDia(db, '2026-10-05');
      assert.deepEqual(r.map((x) => [x.cod_cliente, x.ordens, x.itens]), [['C1', 1, 2]]);
      assert.equal((await remessasDoDia(db, '2026-10-06'))[0].cod_cliente, 'C2');
    });

    test('detalhe do cliente: JSON convertido (endereco, dias, areas)', async () => {
      const c = (await obterCliente(db, 'C1'))!;
      assert.equal(c.endereco?.cidade, 'Goiania');
      assert.deepEqual(c.dias_entrega, [1, 5]);
      assert.equal(c.areas.length, 2);
      assert.equal(c.bloqueado, 0);
      assert.equal((await obterCliente(db, 'C3'))!.bloqueado, 1);
      assert.equal(await obterCliente(db, 'XX'), null);
    });
  });

  describe('pedidos e titulos', () => {
    test('pedido do app ja virado ordem no SAP nao aparece em duplicidade', async () => {
      const ps = await pedidosDoCliente(db, 'C1');
      assert.deepEqual(ps.map((p) => `${p.origem}:${p.chave}`).sort(), [
        'app:a2222222-0000-4000-8000-000000000002', // 0000008: ainda sem ordem no SAP
        'sap:O1', // 0000007 aparece so como a ordem
      ]);
    });

    test('lista geral e filtros (pendentes de envio / com erro)', async () => {
      assert.equal((await listarPedidos(db, 'todos')).length, 3); // O1, O2, app 0000008
      const pend = await listarPedidos(db, 'pendentes');
      assert.deepEqual(pend.map((p) => p.codigo), ['0000008']);
      assert.equal((await listarPedidos(db, 'erros')).length, 0);
    });

    test('titulos: ordenados (atrasado, aberto, pago) e filtros', async () => {
      assert.deepEqual((await titulosDoCliente(db, 'C1')).map((t) => t.status), ['Atrasado', 'Em aberto', 'Compensado']);
      assert.equal((await listarTitulos(db, 'atrasados')).length, 2);
      assert.equal((await listarTitulos(db, 'abertos')).length, 3);
      assert.equal((await listarTitulos(db, 'todos')).length, 4);
      assert.equal((await listarTitulos(db, 'todos'))[0].nome_cliente != null, true);
    });

    test('detalhe da ordem SAP: notas e itens', async () => {
      const p = (await obterPedidoSap(db, 'O1'))!;
      assert.equal(p.nome_cliente, 'Mercado Alfa');
      assert.equal(p.notas[0].nota_fiscal, '123');
      assert.equal((await itensDoPedidoSap(db, 'O1')).length, 2);
    });

    test('fila: conta aguardando e erros', async () => {
      assert.deepEqual({ ...(await contarFila(db)) }, { aguardando: 1, erros: 0 });
    });
  });

  describe('catalogo: caixa (KI/CX), preco por caixa e estoque que esconde produto', () => {
    const areasC1 = [FERT, HAWA];
    const buscar = (areas: typeof areasC1, termo = '') => buscarProdutos(db, areas, termo, HOJE);

    test('o pedido leva o CODIGO da caixa (KI); o vendedor le o TEXTO (CX); dados antigos caem no padrao', async () => {
      const todos = await buscar(areasC1);
      assert.deepEqual([...new Set(todos.map((p) => p.unidade))], ['KI']);
      assert.deepEqual([...new Set(todos.map((p) => p.unidadeTexto))], ['CX']);
      // P4: dados antigos (sem unidade_venda) e SEM preco: nao aparece na busca, mas o item ja no pedido tem info
      const p4 = (await infoProdutos(db, areasC1, ['P4'], HOJE)).P4;
      assert.equal(p4.unidade, 'KI');
      assert.equal(p4.unidadeTexto, 'CX');
    });

    test('rotulo(): o preco e as unidades aparecem como CX, e unidades do cadastro com o proprio texto', async () => {
      const p2 = (await buscar(areasC1, 'presunto'))[0];
      assert.equal(rotulo(p2, p2.preco?.unidade), 'CX');
      assert.equal(rotulo(p2, 'UN'), 'UN');
      assert.equal(rotulo(p2, null), 'un');
    });

    test('preco do GRUPO vale antes do da lista; lista em caixa nao precisa de conversao', async () => {
      const p1 = (await buscar(areasC1, 'mussarela'))[0];
      assert.equal(p1.preco?.origem, 'grupo');
      assert.equal(p1.preco?.valor, 40); // grupo 40/1, nao lista 50/10=5
      assert.equal(p1.preco?.unidade, 'KI');
      assert.equal(p1.preco?.tabela, undefined); // ja esta em caixa: nada foi convertido
    });

    test('minimo e multiplo do cadastro (em KG) viram CAIXAS: 6 KG = multiplo 1, 12 KG = minimo 2', async () => {
      const p1 = (await buscar(areasC1, 'mussarela'))[0];
      assert.deepEqual(p1.regra, { minimo: 2, multiplo: 1 });
    });

    test('preco por UN vira preco por CAIXA (3,00/UN x 12 = 36,00/CX) e guarda o preco da tabela', async () => {
      const p2 = (await buscar(areasC1, 'presunto'))[0];
      assert.equal(p2.preco?.valor, 36);
      assert.equal(p2.preco?.unidade, 'KI');
      assert.deepEqual(p2.preco?.tabela, { valor: 3, unidade: 'UN' });
    });

    test('ZVAR vai para a area HAWA: preco por KG vira por CAIXA (12,00/KG x 10 = 120,00/CX)', async () => {
      const p3 = (await buscar(areasC1, 'carne'))[0];
      assert.equal(p3.grupo, 'HAWA');
      assert.equal(p3.preco?.valor, 120);
      assert.deepEqual(p3.preco?.tabela, { valor: 12, unidade: 'KG' });
      assert.equal(p3.disponivel, true);
    });

    test('produto SEM preco de tabela NAO aparece na busca (mas o item ja no pedido continua com info)', async () => {
      assert.equal((await buscar(areasC1, 'sem preco')).length, 0);
      assert.equal((await buscar(areasC1, 'P4')).length, 0);
      const info = (await infoProdutos(db, areasC1, ['P4'], HOJE)).P4;
      assert.equal(info.preco, null);
      assert.equal(info.disponivel, true);
    });

    test('estoque menor que 1 CAIXA esconde o produto; usa o centro da area do tipo do produto', async () => {
      const ids = (await buscar(areasC1)).map((p) => p.cod_produto).sort();
      // P5 (2 KG de caixa de 5 KG = 0,4) e P6 (6 UN = 0,5 CX no centro 2014; os 999 UN do centro 2100 NAO contam)
      // ficam de fora. P2 (30 UN = 2,5 CX) e P3 (55 KG = 5,5 CX) aparecem.
      assert.deepEqual(ids, ['P1', 'P2', 'P3']); // (P4 tambem nao aparece: nao tem preco)
      assert.equal((await buscar(areasC1, 'esgotado')).length, 0);
      assert.equal((await buscar(areasC1, 'quase sem estoque')).length, 0);
    });

    test('o estoque em si NAO e exposto ao app (so esconde o produto)', async () => {
      const p = (await buscar(areasC1, 'mussarela'))[0] as unknown as Record<string, unknown>;
      assert.equal('estoque' in p, false);
      assert.equal(p.semEstoque, false);
    });

    test('centro SEM dados de estoque baixados nao esconde nada (nao da para dizer "sem estoque")', async () => {
      const semDados = [{ ...FERT, centro: '9999' }];
      const ids = (await buscar(semDados as typeof areasC1)).map((p) => p.cod_produto).sort();
      assert.deepEqual(ids, ['P1', 'P5']); // inclusive P5, que no centro 2100 estaria escondido (P4 segue sem preco)
    });

    test('cliente SEM area HAWA: HAWA e ZVAR nem aparecem (sem area nao ha preco); FERT segue', async () => {
      const ids = (await buscar([FERT] as typeof areasC1)).map((p) => p.cod_produto).sort();
      assert.deepEqual(ids, ['P1']); // P2, P3 e P6: sem area HAWA. P4: sem preco. P5: sem estoque
      // ...mas o item que ja esta num pedido continua com informacao e marcado como indisponivel
      const info = await infoProdutos(db, [FERT] as typeof areasC1, ['P2'], HOJE);
      assert.equal(info.P2.disponivel, false);
    });

    test('preco vencido nao e usado: o produto deixa de aparecer', async () => {
      assert.equal((await buscarProdutos(db, areasC1, 'mussarela', '2027-06-01')).length, 0); // depois de 31/12/2026
      const info = (await infoProdutos(db, areasC1, ['P1'], '2027-06-01')).P1;
      assert.equal(info.preco, null);
    });

    test('busca varre o catalogo em paginas: acha produto com preco mesmo depois de muitos sem preco', async () => {
      // 400 produtos sem preco que vem ANTES (ordem de nome) do unico com preco
      await db.withTransactionAsync(async () => {
        for (let i = 0; i < 400; i++) {
          await db.runAsync(
            `INSERT INTO produtos (cod_produto, descricao, tipo_material, dados) VALUES (?, ?, 'FERT', NULL)`,
            `X${i}`, `AAA sem preco ${String(i).padStart(3, '0')}`,
          );
        }
        await db.runAsync(`INSERT INTO produtos (cod_produto, descricao, tipo_material, dados) VALUES ('Z1', 'ZZZ unico com preco', 'FERT', NULL)`);
        await db.runAsync(`INSERT INTO precos_lista (pltyp, cod_produto, datab, datbi, kbetr, kpein, kmein) VALUES ('01', 'Z1', '2026-01-01', '2026-12-31', 10, 1, 'KI')`);
        await db.runAsync(`INSERT INTO estoque (centro, cod_produto, quantidade, unidade_base) VALUES ('2100', 'Z1', 50, 'CX')`);
      });
      const r = await buscar(areasC1, 'ZZZ');
      assert.deepEqual(r.map((p) => p.cod_produto), ['Z1']);
      const todos = await buscar(areasC1); // sem filtro de busca: os 400 sem preco ficam para tras
      assert.ok(todos.some((p) => p.cod_produto === 'Z1'));
      assert.ok(todos.every((p) => p.preco !== null));
      await db.withTransactionAsync(async () => {
        await db.runAsync(`DELETE FROM produtos WHERE cod_produto LIKE 'X%' OR cod_produto = 'Z1'`);
        await db.runAsync(`DELETE FROM precos_lista WHERE cod_produto = 'Z1'`);
        await db.runAsync(`DELETE FROM estoque WHERE cod_produto = 'Z1'`);
      });
    });

    test('desconto_max do SAP chega ao preco do catalogo (0 = sem desconto)', async () => {
      await db.runAsync(`UPDATE precos_lista SET desconto_max = 7.5 WHERE cod_produto = 'P1'`);
      await db.runAsync(`UPDATE precos_grupo SET desconto_max = 7.5 WHERE cod_produto = 'P1'`);
      const com = (await buscar(areasC1, 'mussarela'))[0];
      assert.equal(com.preco?.descontoMax, 7.5);
      await db.runAsync(`UPDATE precos_lista SET desconto_max = 0 WHERE cod_produto = 'P1'`);
      await db.runAsync(`UPDATE precos_grupo SET desconto_max = 0 WHERE cod_produto = 'P1'`);
      const sem = (await buscar(areasC1, 'mussarela'))[0];
      assert.equal(sem.preco?.descontoMax, undefined);
    });

    test('toda a busca devolve so produtos com preco, area e estoque', async () => {
      const todos = await buscar(areasC1);
      assert.ok(todos.length > 0);
      assert.ok(todos.every((p) => p.preco !== null && p.disponivel && !p.semEstoque));
    });

    test('busca por codigo e EAN; infoProdutos devolve so os pedidos', async () => {
      assert.equal((await buscar(areasC1, '789002'))[0].cod_produto, 'P2');
      assert.equal((await buscar(areasC1, 'P3'))[0].cod_produto, 'P3');
      const info = await infoProdutos(db, areasC1, ['P1', 'P3', 'NAO_EXISTE'], HOJE);
      assert.deepEqual(Object.keys(info).sort(), ['P1', 'P3']);
    });

    test('item que JA esta no pedido continua com informacao mesmo que o estoque tenha acabado', async () => {
      const info = await infoProdutos(db, areasC1, ['P5'], HOJE);
      assert.equal(info.P5.semEstoque, true); // some da busca, mas o item do pedido nao quebra
      assert.equal(info.P5.unidade, 'KI');
    });
  });

  describe('rascunhos, fila e envio', () => {
    test('rascunho: retoma o aberto do cliente; itens e campos sobrevivem', async () => {
      const id = await obterOuCriarRascunho(db, 'C1');
      assert.equal(await obterOuCriarRascunho(db, 'C1'), id); // mesmo rascunho
      assert.notEqual(await obterOuCriarRascunho(db, 'C2'), id);
      await salvarItens(db, id, [{ produto: 'P1', unidade: 'CX', quantidade: '12', preco: '40.00' }, { produto: 'P4', unidade: 'CX', quantidade: '2.5' }]);
      await salvarCampos(db, id, { ordem_compra_cliente: ' OC-9 ', observacao: '' });
      const p = (await lerPedidoApp(db, id))!;
      assert.equal(p.status, 'rascunho');
      assert.equal(p.itens.length, 2);
      assert.equal(p.ordem_compra_cliente, 'OC-9'); // aparado
      assert.equal(p.observacao, null); // vazio vira null
      assert.equal((await listarRascunhos(db)).length, 2);
    });

    test('confirmar: vira pendente, atualiza a data da compra e nao deixa mais editar itens', async () => {
      const id = await obterOuCriarRascunho(db, 'C1');
      const antes = (await lerPedidoApp(db, id))!.criado_em;
      await new Promise((r) => setTimeout(r, 5));
      await confirmarPedido(db, id);
      const p = (await lerPedidoApp(db, id))!;
      assert.equal(p.status, 'pendente');
      assert.ok(p.criado_em > antes);
      await salvarItens(db, id, []); // tentativa de editar depois de confirmado
      assert.equal((await lerPedidoApp(db, id))!.itens.length, 2); // ignorada
      assert.equal((await pendentesDeEnvio(db)).map((x) => x.id).includes(id), true);
    });

    test('enviar pendentes: sucesso grava codigo, ordens e data de entrega; erro de rede mantem pendente', async () => {
      const [pend] = await pendentesDeEnvio(db);
      const chamadas: Array<{ caminho: string; corpo: any }> = [];

      (globalThis as any).__apiStub = async (caminho: string, o: any) => {
        chamadas.push({ caminho, corpo: o.body });
        throw new Error('Sem conexão com o servidor.');
      };
      await assert.rejects(enviarPendentes(db), /Sem conexão/);
      assert.equal((await lerPedidoApp(db, pend.id))!.status, 'pendente'); // continua na fila
      assert.equal(chamadas[0].caminho, '/pedidos/push');
      const corpo = chamadas[0].corpo.pedidos[0];
      assert.equal(corpo.id, pend.id);
      assert.equal(corpo.criado_no_app_em, pend.criado_em);
      // com preco (por caixa, vira ZPR2) quando o item tem; sem preco vai null (o SAP aplica a lista)
      assert.deepEqual(corpo.itens[0], { produto: 'P1', unidade: 'CX', quantidade: '12', preco: '40.00' });
      assert.deepEqual(corpo.itens[1], { produto: 'P4', unidade: 'CX', quantidade: '2.5', preco: null });

      (globalThis as any).__apiStub = async (_c: string, o: any) => ({
        resultados: o.body.pedidos.map((p: any) => ({
          id: p.id, status: 'enviado', codigo: '0000010', dt_entrega: '2026-10-05',
          ordens: [{ ordem: 'O77', tipo_material: 'FERT', vkorg: '2100' }], erro: null, tentativas: 1,
        })),
      });
      assert.deepEqual(await enviarPendentes(db), { enviados: 1, comErro: 0 });
      const ok = (await lerPedidoApp(db, pend.id))!;
      assert.equal(ok.status, 'enviado');
      assert.equal(ok.codigo, '0000010');
      assert.equal(ok.dt_entrega, '2026-10-05');
      assert.equal(ok.ordens_sap[0].ordem, 'O77');
      assert.equal((await pendentesDeEnvio(db)).length, 0);
    });

    test('recusa do servidor (invalido) vira erro LOCAL sem codigo; pode descartar', async () => {
      const id = await obterOuCriarRascunho(db, 'C2');
      await salvarItens(db, id, [{ produto: 'P1', unidade: 'CX', quantidade: '6' }]);
      await confirmarPedido(db, id);
      (globalThis as any).__apiStub = async (_c: string, o: any) => ({
        resultados: o.body.pedidos.map((p: any) => ({ id: p.id, status: 'invalido', erros: ['Cliente fora da carteira do vendedor'] })),
      });
      assert.deepEqual(await enviarPendentes(db), { enviados: 0, comErro: 1 });
      const p = (await lerPedidoApp(db, id))!;
      assert.equal(p.status, 'erro');
      assert.equal(p.codigo, null);
      assert.match(p.erro!, /fora da carteira/);
      await descartarPedido(db, id);
      assert.equal(await lerPedidoApp(db, id), null);
    });

    test('NAO descarta pedido que o servidor ja conhece (tem codigo)', async () => {
      const id = 'a2222222-0000-4000-8000-000000000002'; // codigo 0000008, status recebido
      await descartarPedido(db, id);
      assert.ok(await lerPedidoApp(db, id));
    });

    test('resultado parcial e erro do servidor sao gravados com as ordens ja criadas', async () => {
      const id = 'a2222222-0000-4000-8000-000000000002';
      await aplicarResultado(db, { id, status: 'parcial', codigo: '0000008', ordens: [{ ordem: 'O88', tipo_material: 'FERT', vkorg: '2100' }], erro: '[HAWA] sem area', tentativas: 2 });
      const p = (await lerPedidoApp(db, id))!;
      assert.equal(p.status, 'parcial');
      assert.equal(p.tentativas, 2);
      assert.equal(p.ordens_sap[0].ordem, 'O88');
      assert.match(p.erro!, /HAWA/);
    });

    test('duplicar pedido do app: novo rascunho com os itens e ligado ao original', async () => {
      const original = 'a2222222-0000-4000-8000-000000000002';
      await salvarItens(db, original, []); // (so rascunho edita; confirma que nao mexeu)
      const novo = (await duplicarPedidoApp(db, original))!;
      const p = (await lerPedidoApp(db, novo))!;
      assert.equal(p.status, 'rascunho');
      assert.equal(p.duplicado_de, original);
      assert.equal(p.cod_cliente, 'C1');
      assert.notEqual(novo, original);
    });

    test('duplicar ordem do SAP: copia os itens e IGNORA os recusados', async () => {
      const novo = (await duplicarPedidoSap(db, 'O1'))!;
      const p = (await lerPedidoApp(db, novo))!;
      // o SAP devolve o TEXTO "CX" nos itens; o pedido novo leva o CODIGO "KI". Item 20 (recusado) fica de fora.
      assert.deepEqual(p.itens, [{ produto: 'P1', unidade: 'KI', quantidade: '12' }]);
      assert.equal(p.duplicado_de, null);
      assert.equal(await duplicarPedidoSap(db, 'NAO_EXISTE'), null);
    });
  });

  describe('novos pulls', () => {
    test('delta: conjuntos completos SUBSTITUEM (remessa entregue e preco vencido saem)', async () => {
      const p2 = pullBase();
      p2.cursor = '2026-10-04T12:00:00.000Z';
      p2.remessas = [p2.remessas![2]]; // so sobrou a de C2
      p2.precos_lista = []; // nenhuma lista vigente
      p2.precos_grupo = [];
      await aplicarPull(db, p2);
      assert.equal((await remessasDoDia(db, '2026-10-05')).length, 0);
      assert.equal((await remessasDoDia(db, '2026-10-06')).length, 1);
      assert.equal((await buscarProdutos(db, [FERT, HAWA], 'mussarela', HOJE)).length, 0); // sem preco, some da busca
      assert.equal((await infoProdutos(db, [FERT, HAWA], ['P1'], HOJE)).P1.preco, null);
      assert.equal(await lerMeta(db, 'cursor'), '2026-10-04T12:00:00.000Z');
    });

    test('pull SEM "completos" nao mexe em precos/remessas (nada mudou)', async () => {
      const p3 = pullBase();
      p3.completos = [];
      p3.remessas = undefined;
      p3.precos_lista = undefined;
      p3.precos_grupo = undefined;
      await aplicarPull(db, p3);
      assert.equal((await remessasDoDia(db, '2026-10-06')).length, 1); // permaneceu do pull anterior
    });

    test('cliente que saiu da carteira some do aparelho; pedido local pendente nao e afetado pelo pull', async () => {
      const id = await obterOuCriarRascunho(db, 'C2');
      await salvarItens(db, id, [{ produto: 'P1', unidade: 'CX', quantidade: '6' }]);
      const p4 = pullBase();
      p4.carteira = [{ cod_cliente: 'C1', dia_semana: 1, sequencia: 1 }];
      await aplicarPull(db, p4);
      assert.equal(await obterCliente(db, 'C2'), null);
      assert.equal((await obterCliente(db, 'C1'))!.cod_cliente, 'C1');
      assert.equal((await lerPedidoApp(db, id))!.itens.length, 1); // o rascunho local sobreviveu
    });

    test('pull atualiza status do pedido do app SEM apagar os itens locais', async () => {
      const id = 'a2222222-0000-4000-8000-000000000002';
      const itens = [{ produto: 'P1', unidade: 'CX', quantidade: '7' }];
      await db.runAsync('UPDATE pedidos_app SET itens = ? WHERE id = ?', JSON.stringify(itens), id);
      const p5 = pullBase();
      p5.pedidos_app = [{ ...p5.pedidos_app[1], status: 'enviado', codigo: '0000008', erro: null }];
      await aplicarPull(db, p5);
      const p = (await lerPedidoApp(db, id))!;
      assert.equal(p.status, 'enviado');
      assert.deepEqual(p.itens, itens); // itens preservados
    });

    test('limpar banco local (troca de usuario) apaga tudo, inclusive pedidos pendentes', async () => {
      await limparBancoLocal(db);
      for (const t of ['clientes', 'produtos', 'pedidos_app', 'titulos', 'remessas', 'meta']) {
        assert.equal((await db.getAllAsync(`SELECT 1 FROM ${t}`)).length, 0, t);
      }
    });
  });
});
