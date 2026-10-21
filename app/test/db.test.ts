// Testes da camada de dados do app contra um SQLite REAL (node:sqlite). Rodar: npm run test:db
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { before, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';
import { colocarNoCarrinho } from '@/db/carrinho';
import { feriadosDoCliente } from '@/db/feriados';
import { buscarProdutos, infoProdutos, rotulo } from '@/db/catalogo';
import { avisosNaoLidos, marcarAvisoLido } from '@/db/avisos';
import { htmlPedido, montarDocPedido, type EntradaPdf } from '@/domain/pedidoPdf';
import { carregarIncentivos } from '@/db/incentivos';
import { fichaDoProduto, listarDestaques, ultimosPedidosDoCliente } from '@/db/produto';
import { incentivoAplicavel } from '@/domain/incentivo';
import {
  aplicarResultado, confirmarPedido, descartarPedido, duplicarPedidoApp, duplicarPedidoSap, lerPedidoApp,
  itensDaOrdemSap, listarRascunhos, marcarOrdemCancelada, statusCancelaveis, obterOuCriarRascunho, pendentesDeEnvio, salvarCampos, salvarItens, salvarTipo,
} from '@/db/pedidos';
import { enviarPendentes } from '@/db/push';
import {
  carteiraParada, clientesDoDia, contarFila, historicoMensalDoCliente, produtosCompradosPeloCliente, ultimaCompraDoCliente, vendasPorMes, itensDoPedidoSap, listarClientes, listarPedidos, listarTitulos, obterCliente,
  obterPedidoSap, pedidosDoCliente, remessasDoDia, titulosDoCliente,
} from '@/db/queries';
import { migrar } from '@/db/schema';
import {
  adicionarFoto, concluirVisita, fotosDaVisita, iniciarVisita, MAX_FOTOS_VISITA, pedidoDaVisita, perguntasDaVisita, respostasDaVisita, resumoDoDia, visitaDoClienteNoDia, visitasDoDia,
} from '@/db/visitas';
import { aplicarPull, buscarOrdemNoSap, lerMeta, limparBancoLocal, type PullResposta } from '@/db/sync';

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
    assert.equal(v?.user_version, 13);
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
      assert.deepEqual({ ...(await contarFila(db)) }, { aguardando: 1, erros: 0, aprovacao: 0 });
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
      // preco_tabela e desconto vao so para o PDF de confirmacao (o servidor nao os manda ao SAP)
      assert.deepEqual(corpo.itens[0], { produto: 'P1', unidade: 'CX', quantidade: '12', preco: '40.00', preco_tabela: null, desconto: null });
      assert.deepEqual(corpo.itens[1], { produto: 'P4', unidade: 'CX', quantidade: '2.5', preco: null, preco_tabela: null, desconto: null });

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

describe('bonificacao, incentivos e cadastros do painel', () => {
  let db: SQLiteDatabase;

  before(async () => {
    db = abrirBanco();
    await migrar(db);
    const p = pullBase();
    p.tipos_bonificacao = [
      { codigo: '115', descricao: 'Bonificacao comercial' },
      { codigo: '120', descricao: 'Amostra' },
    ];
    p.centros_custo = [{ codigo: '2001501007', descricao: 'Comercial' }];
    p.destaques = [
      { cod_produto: 'P1', destaque: true, lancamento: false, ordem: 2 },
      { cod_produto: 'P2', destaque: false, lancamento: true, ordem: 1 },
      { cod_produto: 'P3', destaque: false, lancamento: false, ordem: 0 }, // sem marca: nao entra
    ];
    p.incentivos = [
      { id: 'i1', cod_produto: 'P1', escopo: 'geral', escopo_valor: null, qtd_minima: 10, desconto_pct: 4, desconto_extra_max_pct: 2 },
      { id: 'i2', cod_produto: 'P1', escopo: 'cliente', escopo_valor: 'C1', qtd_minima: 20, desconto_pct: 8, desconto_extra_max_pct: 1 },
      { id: 'i3', cod_produto: 'P1', escopo: 'cliente', escopo_valor: 'OUTRO', qtd_minima: 1, desconto_pct: 50, desconto_extra_max_pct: 0 },
      // por classificacao: qualquer produto da linha Premium, a partir de 3 caixas
      { id: 'i4', cod_produto: null, escopo: 'geral', escopo_valor: null, linha_id: '0003', grupo_id: null, categoria_id: null, marca: null, qtd_minima: 3, desconto_pct: 2, desconto_extra_max_pct: 0 },
    ];
    await aplicarPull(db, p);
  });

  test('migracao cria as tabelas dos cadastros do painel e as colunas da bonificacao', async () => {
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    assert.equal(v?.user_version, 13);
    for (const t of ['bonificacao_tipos', 'centros_custo', 'destaques', 'incentivos']) {
      assert.ok((await db.getAllAsync(`SELECT 1 FROM ${t}`)).length >= 0, t);
    }
    assert.equal((await db.getAllAsync('SELECT codigo FROM bonificacao_tipos ORDER BY codigo')).length, 2);
    assert.equal((await db.getAllAsync('SELECT codigo FROM centros_custo')).length, 1);
  });

  test('o pull SUBSTITUI os cadastros do painel (o que saiu de la some do aparelho)', async () => {
    const p = pullBase();
    p.tipos_bonificacao = [{ codigo: '115', descricao: 'Bonificacao comercial' }];
    await aplicarPull(db, p);
    assert.deepEqual((await db.getAllAsync<{ codigo: string }>('SELECT codigo FROM bonificacao_tipos')).map((x) => x.codigo), ['115']);
    // campos ausentes no pull nao apagam nada
    assert.equal((await db.getAllAsync('SELECT codigo FROM centros_custo')).length, 1);
    assert.equal((await db.getAllAsync('SELECT id FROM incentivos')).length, 4);
  });

  test('destaques e lancamentos: so os marcados, na ordem do painel', async () => {
    assert.deepEqual((await listarDestaques(db)).map((d) => d.cod_produto), ['P2', 'P1']);
  });

  test('incentivos: o contexto traz vendedor, canal e escritorio; vale a regra do cliente certo', async () => {
    const cli = (await obterCliente(db, 'C1'))!;
    const { rows, ctx } = await carregarIncentivos(db, 'C1', [...cli.areas, { ...cli.areas[0], canal: { codigo: '10' }, escritorio: { codigo: 'E1' } }]);
    assert.equal(ctx.codVendedor, '100409');
    assert.deepEqual(ctx.canais, ['10']);
    assert.deepEqual(ctx.escritorios, ['E1']);
    assert.equal(rows.length, 4);
    assert.equal(incentivoAplicavel(rows, 'P1', 10, ctx)?.id, 'i1');
    assert.equal(incentivoAplicavel(rows, 'P1', 25, ctx)?.id, 'i2'); // regra do cliente C1
    assert.equal(incentivoAplicavel(rows, 'P1', 1, ctx), null); // i3 e de outro cliente
  });

  test('bonificacao: o rascunho guarda tipo, centro de custo e justificativa; duplicar mantem; venda limpa', async () => {
    const id = await obterOuCriarRascunho(db, 'C1');
    assert.equal((await lerPedidoApp(db, id))!.tipo, 'venda');
    await salvarTipo(db, id, { tipo: 'bonificacao', tipo_bonificacao: '115', centro_custo: '2001501007', justificativa: '  Degustacao  ' });
    const b = (await lerPedidoApp(db, id))!;
    assert.deepEqual([b.tipo, b.tipo_bonificacao, b.centro_custo, b.justificativa], ['bonificacao', '115', '2001501007', 'Degustacao']);

    const copia = (await lerPedidoApp(db, (await duplicarPedidoApp(db, id))!))!;
    assert.deepEqual([copia.tipo, copia.tipo_bonificacao, copia.centro_custo, copia.justificativa], ['bonificacao', '115', '2001501007', 'Degustacao']);

    await salvarTipo(db, id, { tipo: 'venda', tipo_bonificacao: '115', centro_custo: '2001501007', justificativa: 'x' });
    const v = (await lerPedidoApp(db, id))!;
    assert.deepEqual([v.tipo, v.tipo_bonificacao, v.centro_custo, v.justificativa], ['venda', null, null, null]);
  });

  test('aguardando aprovacao entra na fila; rejeitado conta como erro e mostra o motivo', async () => {
    const p = pullBase();
    const base = p.pedidos_app[1];
    p.pedidos_app = [
      ...p.pedidos_app,
      { ...base, id: 'b1111111-0000-4000-8000-000000000001', codigo: '0000009', status: 'aguardando_aprovacao', erro: null, tipo: 'bonificacao', tipo_bonificacao: '115', centro_custo: '2001501007', justificativa: 'Teste', motivo_rejeicao: null },
      { ...base, id: 'b2222222-0000-4000-8000-000000000002', codigo: '0000010', status: 'rejeitado', erro: null, tipo: 'bonificacao', tipo_bonificacao: '115', centro_custo: '2001501007', justificativa: 'Teste', motivo_rejeicao: 'Sem verba no centro de custo' },
    ];
    await aplicarPull(db, p);

    const fila = await contarFila(db);
    assert.equal(fila.aprovacao, 1);
    assert.equal(fila.erros, 1); // rejeitado
    assert.equal(fila.aguardando, 1); // 'recebido' (a caminho do SAP)

    assert.deepEqual((await listarPedidos(db, 'aprovacao')).map((x) => x.codigo), ['0000009']);
    const rej = (await listarPedidos(db, 'erros')).find((x) => x.codigo === '0000010')!;
    assert.equal(rej.erro, 'Sem verba no centro de custo'); // o motivo aparece no lugar do erro
    assert.equal((await listarPedidos(db, 'fila')).length, 3); // recebido + aprovacao + rejeitado

    // uma aprovada volta como 'aprovado' (a caminho do SAP) e some de "em aprovacao"
    const p2 = pullBase();
    p2.pedidos_app = [{ ...base, id: 'b1111111-0000-4000-8000-000000000001', codigo: '0000009', status: 'aprovado', erro: null, tipo: 'bonificacao' }];
    await aplicarPull(db, p2);
    assert.equal((await contarFila(db)).aprovacao, 0);
    assert.equal((await lerPedidoApp(db, 'b1111111-0000-4000-8000-000000000001'))!.status, 'aprovado');
  });

  test('colocar no carrinho aplica o incentivo da quantidade e recalcula quando ela muda', async () => {
    const cli = (await obterCliente(db, 'C1'))!;
    const inc = await carregarIncentivos(db, 'C1', cli.areas);
    const info = await infoProdutos(db, cli.areas, ['P1'], HOJE);
    const p = info.P1;
    assert.ok(p, 'P1 precisa estar disponivel');
    const id = await obterOuCriarRascunho(db, 'C1');
    await salvarItens(db, id, []);

    // 10 caixas: incentivo geral de 4%
    let itens = await colocarNoCarrinho(db, id, [], p, 10, 0, 'somar', {}, inc);
    assert.equal(itens[0].desconto, 4);
    assert.equal((await lerPedidoApp(db, id))!.itens[0].desconto, 4);
    // 20 caixas: passa para a regra do cliente (8%)
    itens = await colocarNoCarrinho(db, id, itens, p, 20, 0, 'definir', {}, inc);
    assert.equal(itens[0].desconto, 8);
    // vendedor pede 5% extra com a lista sem desconto: limitado ao extra do incentivo (1% na faixa de 20)
    itens = await colocarNoCarrinho(db, id, itens, p, 20, 5, 'definir', {}, inc);
    assert.deepEqual([itens[0].descontoManual, itens[0].desconto], [1, 9]);
    // baixou para 5 caixas: perde o incentivo e o desconto do vendedor (lista sem desconto)
    itens = await colocarNoCarrinho(db, id, itens, p, 5, 5, 'definir', {}, inc);
    assert.equal(itens[0].desconto, null);
  });

  test('itens de uma ordem do SAP viram itens do carrinho (sem recusados, unidade em codigo)', async () => {
    const itens = await itensDaOrdemSap(db, 'O1');
    assert.deepEqual(itens, [{ produto: 'P1', unidade: 'KI', quantidade: '12' }]); // P4 foi recusado
  });

  test('ultimos pedidos do cliente trazem a quantidade de itens validos', async () => {
    const u = await ultimosPedidosDoCliente(db, 'C1', 5);
    assert.equal(u[0].ordem, 'O1');
    assert.equal(u[0].itens, 1);
  });

  test('ficha do produto: classificacao, unidade de venda e fator', async () => {
    await db.runAsync(
      'UPDATE produtos SET dados = ? WHERE cod_produto = ?',
      JSON.stringify({ classificacao: { linha: 'Premium', grupo: 'Queijos', marca: 'Pole' }, estoque: { prazoentregadias: '2' }, unidade_base: 'KG', unidade_base_texto: 'KG', unidade_venda: 'KI', conversoes: [{ unidade: 'KI', fator: 6 }] }),
      'P1',
    );
    const f = (await fichaDoProduto(db, 'P1'))!;
    assert.deepEqual([f.linha, f.grupo, f.marca, f.prazoDias, f.fatorVenda, f.ncm, f.ean], ['Premium', 'Queijos', 'Pole', '2', 6, '0406', '789001']);
    assert.equal(await fichaDoProduto(db, 'NAO_EXISTE'), null);
  });
});

describe('incentivo por classificacao (ID de linha/grupo/categoria e marca)', () => {
  let db: SQLiteDatabase;

  before(async () => {
    db = abrirBanco();
    await migrar(db);
    const p = pullBase();
    p.incentivos = [
      { id: 'l1', cod_produto: null, escopo: 'geral', escopo_valor: null, linha_id: '0003', grupo_id: null, categoria_id: null, marca: null, qtd_minima: 3, desconto_pct: 2, desconto_extra_max_pct: 0 },
      { id: 'm1', cod_produto: null, escopo: 'geral', escopo_valor: null, linha_id: null, grupo_id: null, categoria_id: null, marca: 'Pole', qtd_minima: 3, desconto_pct: 1, desconto_extra_max_pct: 0 },
    ];
    // P1 passa a ter classificacao no cadastro
    p.produtos = p.produtos.map((x) =>
      x.cod_produto === 'P1'
        ? { ...x, dados: { ...(x.dados as object), classificacao: { linha_id: '3', grupo_id: '12', categoria_id: '7', marca: 'Pole', linha: 'Premium', grupo: 'Queijos', categoria: 'Laticinios' } } }
        : x,
    );
    await aplicarPull(db, p);
  });

  test('a classificacao do cadastro chega no produto do catalogo', async () => {
    const cli = (await obterCliente(db, 'C1'))!;
    const info = await infoProdutos(db, cli.areas, ['P1', 'P2'], HOJE);
    assert.deepEqual(info.P1.classificacao, { linha_id: '3', grupo_id: '12', categoria_id: '7', marca: 'Pole', linha: 'Premium', grupo: 'Queijos', categoria: 'Laticinios' });
    assert.deepEqual(info.P2.classificacao, { linha_id: null, grupo_id: null, categoria_id: null, marca: null, linha: null, grupo: null, categoria: null }); // sem cadastro
  });

  test('as colunas de classificacao dos incentivos chegam no aparelho e a regra vale so para quem bate', async () => {
    const cli = (await obterCliente(db, 'C1'))!;
    const { rows, ctx } = await carregarIncentivos(db, 'C1', cli.areas);
    const info = await infoProdutos(db, cli.areas, ['P1', 'P2'], HOJE);
    assert.equal(rows.find((r) => r.id === 'l1')!.linha_id, '0003'); // P1 tem o ID '3': zeros a esquerda nao importam
    // P1 (linha Premium e marca Pole): vale a mais especifica entre as duas de mesma faixa (as duas tem 1 criterio: vence a 1a na ordem estavel)
    assert.ok(incentivoAplicavel(rows, 'P1', 3, ctx, info.P1.classificacao));
    // P2 nao tem classificacao: nenhuma das duas bate
    assert.equal(incentivoAplicavel(rows, 'P2', 3, ctx, info.P2.classificacao), null);
    assert.equal(incentivoAplicavel(rows, 'P1', 2, ctx, info.P1.classificacao), null); // abaixo da faixa
  });

  test('carrinho: o desconto por classificacao e aplicado no produto da linha e nao no outro', async () => {
    const cli = (await obterCliente(db, 'C1'))!;
    const inc = await carregarIncentivos(db, 'C1', cli.areas);
    const info = await infoProdutos(db, cli.areas, ['P1', 'P3'], HOJE);
    const id = await obterOuCriarRascunho(db, 'C1');
    await salvarItens(db, id, []);
    let itens = await colocarNoCarrinho(db, id, [], info.P1, 3, 0, 'somar', {}, inc);
    assert.ok((itens[0].desconto ?? 0) > 0, 'P1 e da linha Premium e deveria ter desconto');
    itens = await colocarNoCarrinho(db, id, itens, info.P3, 3, 0, 'somar', { P1: info.P1 }, inc);
    assert.equal(itens.find((i) => i.produto === 'P3')!.desconto, null);
  });
});

describe('entrega (feriados) e carteira parada', () => {
  let db: SQLiteDatabase;

  before(async () => {
    db = abrirBanco();
    await migrar(db);
    const p = pullBase();
    p.feriados = [
      { data: '2026-11-02', descricao: 'Finados', uf: null, cidade: null },
      { data: '2026-11-03', descricao: 'Estadual GO', uf: 'GO', cidade: null },
      { data: '2026-11-04', descricao: 'Municipal Goiania', uf: 'GO', cidade: 'GOIÂNIA' },
      { data: '2026-11-05', descricao: 'Estadual SP', uf: 'SP', cidade: null },
      { data: '2026-11-06', descricao: 'Municipal Anapolis', uf: 'GO', cidade: 'Anapolis' },
    ];
    await aplicarPull(db, p);
  });

  test('feriados do cliente: nacionais + do estado + da cidade dele (cidade sem acento/caixa)', async () => {
    const c1 = (await obterCliente(db, 'C1'))!; // Goiania / GO
    const f = await feriadosDoCliente(db, c1.endereco);
    assert.deepEqual([...f.datas].sort(), ['2026-11-02', '2026-11-03', '2026-11-04']);
    assert.equal(f.descricao.get('2026-11-02'), 'Finados');
    // cliente sem endereco: so os nacionais
    const c2 = (await obterCliente(db, 'C2'))!;
    assert.deepEqual([...(await feriadosDoCliente(db, c2.endereco)).datas], ['2026-11-02']);
  });

  test('o pull substitui os feriados', async () => {
    const p = pullBase();
    p.feriados = [{ data: '2026-12-25', descricao: 'Natal', uf: null, cidade: null }];
    await aplicarPull(db, p);
    assert.deepEqual((await db.getAllAsync<{ data: string }>('SELECT data FROM feriados')).map((x) => x.data), ['2026-12-25']);
  });

  test('carteira parada: quem nao compra desde a data de corte (nunca-comprou primeiro, depois o mais antigo)', async () => {
    // O1 (C1) = 01/10, O2 (C2) = 20/09; C3 nunca comprou
    const ate25 = await carteiraParada(db, '2026-09-25');
    assert.deepEqual(ate25.map((c) => c.cod_cliente), ['C3', 'C2']); // C1 comprou depois do corte
    assert.equal(ate25[0].ultima_compra, null);
    assert.equal(ate25[1].ultima_compra, '2026-09-20');
    assert.deepEqual(ate25[0].dias_visita, [2]);
    assert.equal(ate25[0].bloqueado, 1);
    // corte antigo: so quem nunca comprou
    assert.deepEqual((await carteiraParada(db, '2026-09-01')).map((c) => c.cod_cliente), ['C3']);
    // corte recente: todos
    assert.deepEqual((await carteiraParada(db, '2026-10-03')).map((c) => c.cod_cliente), ['C3', 'C2', 'C1']);
    assert.deepEqual((await carteiraParada(db, '2026-10-03'))[2].dias_visita, [1, 5]);
  });
});

describe('pagamento antecipado (forma V): sem credito', () => {
  let db: SQLiteDatabase;

  before(async () => {
    db = abrirBanco();
    await migrar(db);
    const p = pullBase();
    // C2 paga antecipado: o SAP manda o limite disponivel zerado e o indicador
    p.clientes = p.clientes.map((c) =>
      c.cod_cliente === 'C2'
        ? { ...c, pagamento_antecipado: true, limite_disponivel: 0, formas_pagamento: [{ codigo: 'V', descricao: 'Antecipado' }] }
        : { ...c, pagamento_antecipado: false },
    );
    await aplicarPull(db, p);
  });

  test('o indicador chega no detalhe do cliente e nas listas', async () => {
    const c2 = (await obterCliente(db, 'C2'))!;
    assert.equal(c2.pagamento_antecipado, true);
    assert.equal(c2.limite_disponivel, 0);
    assert.deepEqual(c2.formas_pagamento, [{ codigo: 'V', descricao: 'Antecipado' }]);
    assert.equal((await obterCliente(db, 'C1'))!.pagamento_antecipado, false);

    const segunda = await clientesDoDia(db, 1); // C1 e C2
    assert.deepEqual(segunda.map((c) => [c.cod_cliente, c.pagamento_antecipado]), [['C1', 0], ['C2', 1]]);
    assert.equal((await listarClientes(db, 'Beta'))[0].pagamento_antecipado, 1);
  });

  test('cliente sem o campo (servidor antigo) nao e antecipado', async () => {
    const db2 = abrirBanco();
    await migrar(db2);
    await aplicarPull(db2, pullBase()); // pullBase nao traz pagamento_antecipado
    assert.equal((await obterCliente(db2, 'C2'))!.pagamento_antecipado, false);
  });
});

describe('roteiro de visita', () => {
  let db: SQLiteDatabase;
  const DIA = '2026-10-05';
  const NO_CLIENTE = { lat: -16.6869, lng: -49.2648, precisaoM: 8, falsa: false };
  const REF = { lat: -16.6869, lng: -49.2648 };
  const FOTO = { uri: 'file:///visitas/a.jpg', tamanhoBytes: 210_000 };

  before(async () => {
    db = abrirBanco();
    await migrar(db);
    await aplicarPull(db, pullBase());
  });

  test('check-in perto do cliente: guarda GPS, distancia, a foto de fachada e fica em andamento', async () => {
    const r = await iniciarVisita(db, { cod_cliente: 'C1', data_visita: DIA, posicao: NO_CLIENTE, cliente: REF, fachada: FOTO });
    assert.equal(r.nova, true);
    const v = (await visitaDoClienteNoDia(db, 'C1', DIA))!;
    assert.deepEqual([v.status, v.distancia_m, v.fora_do_raio, v.sem_referencia, v.sincronizada, v.validacao], ['em_andamento', 0, 0, 0, 0, 'pendente']);
    assert.equal(v.checkin_lat, -16.6869);
    const fotos = await fotosDaVisita(db, v.id);
    assert.deepEqual(fotos.map((f) => [f.tipo, f.enviada, f.uri]), [['fachada', 0, FOTO.uri]]);
  });

  test('uma visita por cliente por dia: iniciar de novo devolve a mesma e nao duplica a fachada', async () => {
    const antes = (await visitaDoClienteNoDia(db, 'C1', DIA))!;
    const r = await iniciarVisita(db, { cod_cliente: 'C1', data_visita: DIA, posicao: NO_CLIENTE, cliente: REF, fachada: { uri: 'file:///outra.jpg', tamanhoBytes: 1 } });
    assert.deepEqual([r.id, r.nova], [antes.id, false]);
    assert.equal((await fotosDaVisita(db, antes.id)).length, 1);
    // outro dia pode
    assert.equal((await iniciarVisita(db, { cod_cliente: 'C1', data_visita: '2026-10-06', posicao: NO_CLIENTE, cliente: REF, fachada: FOTO })).nova, true);
  });

  test('check-in a ~500 m marca fora do raio (so avisa); cliente sem coordenada fica sem referencia; GPS falso e registrado', async () => {
    await iniciarVisita(db, { cod_cliente: 'C2', data_visita: DIA, posicao: { ...NO_CLIENTE, lat: -16.6869 + 0.0045, falsa: true }, cliente: REF, fachada: FOTO });
    const c2 = (await visitaDoClienteNoDia(db, 'C2', DIA))!;
    assert.equal(c2.fora_do_raio, 1);
    assert.equal(c2.gps_falso, 1);
    assert.ok(c2.distancia_m! > 450 && c2.distancia_m! < 550);

    await iniciarVisita(db, { cod_cliente: 'C3', data_visita: DIA, posicao: NO_CLIENTE, cliente: { lat: null, lng: null }, fachada: FOTO });
    const c3 = (await visitaDoClienteNoDia(db, 'C3', DIA))!;
    assert.deepEqual([c3.sem_referencia, c3.fora_do_raio, c3.distancia_m], [1, 0, null]);
  });

  test('fotos extras: ate 6 por visita', async () => {
    const v = (await visitaDoClienteNoDia(db, 'C1', DIA))!;
    for (let i = 0; i < MAX_FOTOS_VISITA - 1; i++) await adicionarFoto(db, v.id, { uri: `file:///x${i}.jpg`, tamanhoBytes: 1 });
    assert.equal((await fotosDaVisita(db, v.id)).length, MAX_FOTOS_VISITA);
    await assert.rejects(() => adicionarFoto(db, v.id, { uri: 'file:///x.jpg', tamanhoBytes: 1 }), /No máximo 6 fotos/);
  });

  test('concluir "nao vendeu" exige o motivo digitado; depois de concluida nao muda mais', async () => {
    const v = (await visitaDoClienteNoDia(db, 'C2', DIA))!;
    await assert.rejects(() => concluirVisita(db, v.id, { resultado: 'nao_vendeu', motivo: '  ' }), /motivo/);
    await assert.rejects(() => concluirVisita(db, v.id, { resultado: 'nao_vendeu' }), /motivo/);
    await concluirVisita(db, v.id, { resultado: 'nao_vendeu', motivo: '  Estoque cheio  ', observacao: 'volto quinta' });
    const c = (await visitaDoClienteNoDia(db, 'C2', DIA))!;
    assert.deepEqual([c.status, c.resultado, c.motivo_nao_venda, c.observacao, c.sincronizada, c.pedido_id], ['concluida', 'nao_vendeu', 'Estoque cheio', 'volto quinta', 0, null]);
    assert.ok(c.checkout_em);
    await assert.rejects(() => concluirVisita(db, v.id, { resultado: 'nao_vendeu', motivo: 'outro' }), /já foi concluída/);
  });

  test('perguntas da visita: valem por escopo, as obrigatorias bloqueiam a conclusao e as respostas ficam gravadas', async () => {
    await db.execAsync(`
      INSERT INTO visita_perguntas (id, texto, tipo, opcoes, obrigatoria, escopo, escopo_valor, ordem) VALUES
        ('p1', 'Produto exposto?', 'sim_nao', NULL, 1, 'geral', NULL, 1),
        ('p2', 'Estado da loja', 'opcoes', 'Ótimo; Bom; Ruim', 0, 'geral', NULL, 2),
        ('p3', 'Só do cliente C9', 'texto', NULL, 1, 'cliente', 'C9,C10', 3),
        ('p4', 'Só do canal 99', 'texto', NULL, 1, 'canal', '99', 4),
        ('p5', 'Preço do concorrente', 'numero', NULL, 0, 'geral', NULL, 5);
    `);
    const cli = { cod_cliente: 'C9', areas: [] };
    assert.deepEqual((await perguntasDaVisita(db, cli)).map((p) => p.id), ['p1', 'p2', 'p3', 'p5']);
    assert.deepEqual((await perguntasDaVisita(db, { cod_cliente: 'C1', areas: [{ canal: { codigo: '99' } } as never] })).map((p) => p.id), ['p1', 'p2', 'p4', 'p5']);

    await iniciarVisita(db, { cod_cliente: 'C9', data_visita: '2020-01-02', posicao: NO_CLIENTE, cliente: { lat: null, lng: null }, fachada: FOTO });
    const v = (await visitaDoClienteNoDia(db, 'C9', '2020-01-02'))!;
    await assert.rejects(() => concluirVisita(db, v.id, { resultado: 'nao_vendeu', motivo: 'sem estoque' }), /Produto exposto\?/);
    await assert.rejects(() => concluirVisita(db, v.id, { resultado: 'nao_vendeu', motivo: 'sem estoque', respostas: { p1: 'Talvez', p3: 'x' } }), /Sim ou Não/);
    await assert.rejects(() => concluirVisita(db, v.id, { resultado: 'nao_vendeu', motivo: 'sem estoque', respostas: { p1: 'Sim', p3: 'x', p5: 'caro' } }), /número/);
    await concluirVisita(db, v.id, { resultado: 'nao_vendeu', motivo: 'sem estoque', respostas: { p1: 'Sim', p2: 'Bom', p3: 'ok', p5: '12,5' } });
    const salvas = respostasDaVisita((await visitaDoClienteNoDia(db, 'C9', '2020-01-02'))!);
    assert.deepEqual(salvas.map((r) => [r.pergunta_id, r.resposta]), [['p1', 'Sim'], ['p2', 'Bom'], ['p3', 'ok'], ['p5', '12.5']]);
    await db.execAsync('DELETE FROM visita_perguntas');
  });

  test('concluir "vendeu" exige um pedido de VENDA feito depois do check-in (bonificacao e rascunho nao contam)', async () => {
    const v = (await visitaDoClienteNoDia(db, 'C1', DIA))!;
    await assert.rejects(() => concluirVisita(db, v.id, { resultado: 'vendeu' }), /faça o pedido/);

    // rascunho nao conta
    const id1 = await obterOuCriarRascunho(db, 'C1');
    await salvarItens(db, id1, [{ produto: 'P1', unidade: 'KI', quantidade: '2' }]);
    assert.equal(await pedidoDaVisita(db, v), null);
    await assert.rejects(() => concluirVisita(db, v.id, { resultado: 'vendeu' }), /faça o pedido/);

    // bonificacao confirmada nao conta como venda
    await salvarTipo(db, id1, { tipo: 'bonificacao', tipo_bonificacao: '115', centro_custo: '2001501007', justificativa: 'Degustacao' });
    await confirmarPedido(db, id1);
    assert.equal(await pedidoDaVisita(db, v), null);

    // pedido de venda confirmado: conta
    const id2 = await obterOuCriarRascunho(db, 'C1');
    await salvarItens(db, id2, [{ produto: 'P1', unidade: 'KI', quantidade: '3' }]);
    await confirmarPedido(db, id2);
    assert.equal((await pedidoDaVisita(db, v))!.id, id2);
    await concluirVisita(db, v.id, { resultado: 'vendeu' });
    const c = (await visitaDoClienteNoDia(db, 'C1', DIA))!;
    assert.deepEqual([c.status, c.resultado, c.pedido_id, c.motivo_nao_venda], ['concluida', 'vendeu', id2, null]);
  });

  test('resumo do dia: so conta clientes do roteiro de hoje', async () => {
    const r = await resumoDoDia(db, DIA, ['C1', 'C2', 'C9']); // C3 tem visita mas nao esta no roteiro informado
    assert.deepEqual(r, { total: 3, iniciadas: 2, concluidas: 2, vendeu: 1 });
    assert.equal((await visitasDoDia(db, DIA)).length, 3);
  });

  test('pull: validacao do painel chega; o que ainda nao foi enviado nunca e sobrescrito; visita de outro aparelho entra', async () => {
    const c1 = (await visitaDoClienteNoDia(db, 'C1', DIA))!; // sincronizada = 0 (nunca enviada)
    const c2 = (await visitaDoClienteNoDia(db, 'C2', DIA))!;
    await db.runAsync('UPDATE visitas SET sincronizada = 1 WHERE id = ?', c2.id); // simula "enviada"

    const p = pullBase();
    const base = { cod_cliente: 'C2', data_visita: DIA, status: 'concluida', checkin_em: c2.checkin_em, checkin_lat: -16.6869, checkin_lng: -49.2648, checkin_precisao_m: 8,
      checkin_gps_falso: false, distancia_m: 498, fora_do_raio: true, sem_referencia: false, checkout_em: c2.checkout_em, resultado: 'nao_vendeu',
      motivo_nao_venda: 'Estoque cheio', observacao: null, pedido_id: null };
    p.visitas = [
      { ...base, id: c2.id, validacao: 'validada', validacao_obs: 'Fachada ok' },
      // do servidor, mas no aparelho ainda esta pendente de envio: nao sobrescreve
      { ...base, id: c1.id, cod_cliente: 'C1', status: 'em_andamento', resultado: null, motivo_nao_venda: null, checkout_em: null, validacao: 'recusada', validacao_obs: 'x' },
      // visita feita em outro aparelho
      { ...base, id: 'f0000000-0000-4000-8000-000000000001', cod_cliente: 'C3', validacao: 'pendente', validacao_obs: null },
    ];
    await aplicarPull(db, p);

    const c2d = (await visitaDoClienteNoDia(db, 'C2', DIA))!;
    assert.deepEqual([c2d.validacao, c2d.validacao_obs, c2d.distancia_m], ['validada', 'Fachada ok', 498]);
    const c1d = (await visitaDoClienteNoDia(db, 'C1', DIA))!;
    assert.deepEqual([c1d.status, c1d.validacao, c1d.sincronizada], ['concluida', 'pendente', 0]); // intacta
    const outro = await db.getFirstAsync<{ sincronizada: number; resultado: string }>("SELECT sincronizada, resultado FROM visitas WHERE id = 'f0000000-0000-4000-8000-000000000001'");
    assert.deepEqual([outro?.sincronizada, outro?.resultado], [1, 'nao_vendeu']);
  });

  test('trocar de usuario apaga visitas e fotos locais', async () => {
    await limparBancoLocal(db);
    for (const t of ['visitas', 'visita_fotos']) assert.equal((await db.getAllAsync(`SELECT 1 FROM ${t}`)).length, 0, t);
  });
});

describe('historico de 12 meses (totais do servidor) e cancelamento', () => {
  let db: SQLiteDatabase;
  const HOJE_ = '2026-10-03';

  before(async () => {
    db = abrirBanco();
    await migrar(db);
    const p = pullBase();
    p.historico_mes = [
      { cod_cliente: 'C1', mes: '2026-10', valor: 480, pedidos: 2 },
      { cod_cliente: 'C1', mes: '2026-07', valor: 300, pedidos: 1 },
      { cod_cliente: 'C1', mes: '2026-01', valor: 90, pedidos: 1 }, // mais antigo que os 90 dias do aparelho
      { cod_cliente: 'C2', mes: '2026-09', valor: 90, pedidos: 1 },
    ];
    p.historico_produto = [
      { cod_cliente: 'C1', cod_produto: 'P1', denominacao: 'Queijo Mussarela', ultima_compra: '2026-10-01', pedidos: 3, quantidade: 36, unidade: 'CX', meses_com_compra: 3 },
      { cod_cliente: 'C1', cod_produto: 'P9', denominacao: 'Produto antigo', ultima_compra: '2026-03-15', pedidos: 2, quantidade: 8, unidade: 'CX', meses_com_compra: 2 },
      { cod_cliente: 'C2', cod_produto: 'P1', denominacao: 'Queijo Mussarela', ultima_compra: '2026-09-20', pedidos: 1, quantidade: 4, unidade: 'CX', meses_com_compra: 1 },
      { cod_cliente: 'C3', cod_produto: 'P2', denominacao: 'Presunto', ultima_compra: '2026-02-10', pedidos: 1, quantidade: 2, unidade: 'CX', meses_com_compra: 1 },
    ];
    p.parametros = { status_cancelaveis: ['A Faturar', ' Aguardando Liberação '] };
    await aplicarPull(db, p);
  });

  test('grafico do cliente: 12 meses com os totais do servidor (inclusive meses alem dos 90 dias), zero onde nao comprou', async () => {
    const h = await historicoMensalDoCliente(db, 'C1', HOJE_);
    assert.equal(h.length, 12);
    assert.deepEqual([h[0].mes, h[11].mes], ['2025-11', '2026-10']);
    assert.deepEqual(h.find((m) => m.mes === '2026-10'), { mes: '2026-10', total: 480, pedidos: 2 });
    assert.equal(h.find((m) => m.mes === '2026-07')!.total, 300);
    assert.equal(h.find((m) => m.mes === '2026-01')!.total, 90); // so existe nos totais do servidor
    assert.equal(h.find((m) => m.mes === '2026-05')!.total, 0);
  });

  test('aba Analise: 3 meses COMPLETOS somando a carteira (o primeiro mes nao fica pela metade)', async () => {
    const v = await vendasPorMes(db, HOJE_, 3);
    assert.deepEqual(v.map((m) => [m.mes, m.total, m.pedidos]), [['2026-08', 0, 0], ['2026-09', 90, 1], ['2026-10', 480, 2]]);
  });

  test('o que o cliente compra vem dos totais de 12 meses (produto parado ha 6 meses aparece, do mais recente ao mais antigo)', async () => {
    const c = await produtosCompradosPeloCliente(db, 'C1');
    assert.deepEqual(c.map((x) => [x.cod_produto, x.descricao, x.ultima_compra, x.pedidos]), [
      ['P1', 'Queijo Mussarela', '2026-10-01', 3],
      ['P9', 'Produto antigo', '2026-03-15', 2],
    ]);
  });

  test('ultima compra: sem pedido nos 90 dias do aparelho, usa so a data dos totais de 12 meses', async () => {
    assert.deepEqual(await ultimaCompraDoCliente(db, 'C3'), { ordem: '', data: '2026-02-10', valor: null });
    assert.equal((await ultimaCompraDoCliente(db, 'C1'))!.ordem, 'O1'); // pedido recente: vale o do aparelho (com numero e valor)
  });

  test('carteira parada enxerga os 12 meses: quem comprou depois do corte nao entra; a data vem do mais recente dos dois lados', async () => {
    const r = await carteiraParada(db, '2026-09-25');
    assert.deepEqual(r.map((c) => [c.cod_cliente, c.ultima_compra]), [['C3', '2026-02-10'], ['C2', '2026-09-20']]);
    assert.deepEqual((await carteiraParada(db, '2026-03-01')).map((c) => c.cod_cliente), ['C3']);
    assert.deepEqual(await carteiraParada(db, '2026-01-01'), []);
  });

  test('sem os totais do servidor (servidor antigo), as telas usam os 90 dias locais como antes', async () => {
    const db2 = abrirBanco();
    await migrar(db2);
    await aplicarPull(db2, pullBase());
    const h = await historicoMensalDoCliente(db2, 'C1', HOJE_);
    assert.equal(h.find((m) => m.mes === '2026-10')!.total, 480); // do pedido O1 local
    assert.equal(h.find((m) => m.mes === '2026-01')!.total, 0);
    assert.deepEqual((await produtosCompradosPeloCliente(db2, 'C1')).map((x) => x.cod_produto), ['P1']);
    assert.equal(await ultimaCompraDoCliente(db2, 'C3'), null);
  });

  test('o pull SUBSTITUI os totais quando eles vem; quando nao vem (nada mudou), mantem os que o aparelho ja tem', async () => {
    const semMudanca = pullBase(); // sem historico_mes/historico_produto
    await aplicarPull(db, semMudanca);
    assert.equal((await db.getAllAsync('SELECT 1 FROM historico_mes')).length, 4);

    const novo = pullBase();
    novo.historico_mes = [{ cod_cliente: 'C1', mes: '2026-10', valor: 999, pedidos: 5 }];
    novo.historico_produto = [];
    await aplicarPull(db, novo);
    assert.deepEqual((await db.getAllAsync<Record<string, unknown>>('SELECT cod_cliente, mes, valor, pedidos FROM historico_mes')).map((x) => ({ ...x })), [{ cod_cliente: 'C1', mes: '2026-10', valor: 999, pedidos: 5 }]);
    assert.equal((await db.getAllAsync('SELECT 1 FROM historico_produto')).length, 0);
  });

  test('status em que o painel libera o cancelamento: minusculo, sem espaco nas pontas; vazio desliga; pull sem o parametro mantem', async () => {
    assert.deepEqual(await statusCancelaveis(db), ['a faturar', 'aguardando liberação']);
    await aplicarPull(db, pullBase()); // sem parametros: nao mexe
    assert.deepEqual(await statusCancelaveis(db), ['a faturar', 'aguardando liberação']);
    const desligar = pullBase();
    desligar.parametros = { status_cancelaveis: [] };
    await aplicarPull(db, desligar);
    assert.deepEqual(await statusCancelaveis(db), []);
    // aparelho que nunca recebeu o parametro: desligado
    const novo = abrirBanco();
    await migrar(novo);
    assert.deepEqual(await statusCancelaveis(novo), []);
  });

  test('ordem cancelada: o aparelho passa a mostrar Recusado na hora', async () => {
    const antes = await db.getFirstAsync<{ status: string }>("SELECT status FROM pedidos_sap WHERE ordem = 'O1'");
    assert.equal(antes?.status, 'A Faturar');
    await marcarOrdemCancelada(db, 'O1');
    const depois = await db.getFirstAsync<{ status: string }>("SELECT status FROM pedidos_sap WHERE ordem = 'O1'");
    assert.equal(depois?.status, 'Recusado');
  });
});

describe('busca de uma ordem avulsa no SAP', () => {
  test('grava cabecalho e itens da ordem; repetir troca os itens (nao acumula) e erro do servidor sobe', async () => {
    const db = abrirBanco();
    await migrar(db);
    const chamadas: Array<{ caminho: string; metodo?: string }> = [];
    (globalThis as any).__apiStub = async (caminho: string, o: any) => {
      chamadas.push({ caminho, metodo: o?.method });
      return {
        pedido: { ordem: '5800001', cod_cliente: 'C1', tp_ped: 'ZPR2', dt_criacao: '2026-10-18', dt_entrega: '2026-10-20', valor: 100, status: 'A Faturar', notas: [] },
        itens: [{ ordem: '5800001', item: '10', cod_produto: 'P1', denominacao: 'Queijo', quantidade: 3, unidade_venda: 'CX', valor_unitario: 33.3 }],
      };
    };
    await buscarOrdemNoSap(db, '5800001');
    assert.deepEqual(chamadas, [{ caminho: '/sync/ordem/5800001', metodo: 'POST' }]);
    assert.equal((await db.getFirstAsync<{ status: string }>("SELECT status FROM pedidos_sap WHERE ordem = '5800001'"))?.status, 'A Faturar');
    assert.equal((await db.getAllAsync("SELECT 1 FROM pedido_itens_sap WHERE ordem = '5800001'")).length, 1);

    // o SAP trocou os itens (ex.: um item foi recusado/removido): fica so o que veio agora
    (globalThis as any).__apiStub = async () => ({
      pedido: { ordem: '5800001', cod_cliente: 'C1', valor: 70, status: 'Faturado', notas: [] },
      itens: [{ ordem: '5800001', item: '20', cod_produto: 'P2', quantidade: 1, unidade_venda: 'CX' }],
    });
    await buscarOrdemNoSap(db, '5800001');
    assert.deepEqual((await db.getAllAsync<{ item: string }>("SELECT item FROM pedido_itens_sap WHERE ordem = '5800001'")).map((x) => x.item), ['20']);
    assert.equal((await db.getFirstAsync<{ status: string }>("SELECT status FROM pedidos_sap WHERE ordem = '5800001'"))?.status, 'Faturado');

    (globalThis as any).__apiStub = async () => { throw new Error('Ordem ainda nao encontrada no SAP'); };
    await assert.rejects(buscarOrdemNoSap(db, '5800002'), /ainda nao encontrada/);
    assert.equal((await db.getAllAsync("SELECT 1 FROM pedidos_sap WHERE ordem = '5800002'")).length, 0);
  });
});

describe('avisos do painel', () => {
  let db: SQLiteDatabase;

  before(async () => {
    db = abrirBanco();
    await migrar(db);
    await db.execAsync(`
      INSERT INTO clientes (cod_cliente, nome_fantasia, areas) VALUES
        ('A1', 'Loja', '[{"escritorio":{"codigo":"E10"},"canal":{"codigo":"02"}}]');
      INSERT INTO avisos (id, titulo, mensagem, nivel, escopo, escopo_valor, vigencia_ini, vigencia_fim, atualizado_em) VALUES
        ('a1', 'Geral', 'para todos', 'info', 'geral', NULL, NULL, NULL, 't1'),
        ('a2', 'Urgente', 'canal certo', 'urgente', 'canal', '99,02', NULL, NULL, 't1'),
        ('a3', 'Outro canal', 'nao vale', 'info', 'canal', '77', NULL, NULL, 't1'),
        ('a4', 'Escritorio', 'escritorio certo', 'importante', 'escritorio', 'E10', NULL, NULL, 't1'),
        ('a5', 'Vencido', 'expirou', 'info', 'geral', NULL, NULL, '2026-10-01', 't1'),
        ('a6', 'Futuro', 'ainda nao', 'info', 'geral', NULL, '2026-11-01', NULL, 't1');
    `);
  });

  test('so os vigentes que valem para o escritorio/canal dos clientes, do mais urgente ao menos', async () => {
    const lista = await avisosNaoLidos(db, '2026-10-19');
    assert.deepEqual(lista.map((a) => a.id), ['a2', 'a4', 'a1']);
  });

  test('lido some; aviso editado no painel (atualizado_em novo) volta a aparecer', async () => {
    const [primeiro] = await avisosNaoLidos(db, '2026-10-19');
    await marcarAvisoLido(db, primeiro);
    assert.deepEqual((await avisosNaoLidos(db, '2026-10-19')).map((a) => a.id), ['a4', 'a1']);
    await db.runAsync("UPDATE avisos SET atualizado_em = 't2' WHERE id = 'a2'");
    assert.deepEqual((await avisosNaoLidos(db, '2026-10-19')).map((a) => a.id), ['a2', 'a4', 'a1']);
  });
});

describe('PDF de confirmacao do pedido', () => {
  const prod = (descricao: string, tipo_material: string) => ({
    descricao, tipo_material, unidade_venda: 'KI', unidade_venda_texto: 'CX', unidade_base: 'KG', conversoes: [{ unidade: 'KI', texto: 'CX', fator: 7 }], pesoliquido: '1.000',
  });
  const entrada = (extra: Partial<EntradaPdf['pedido']> = {}): EntradaPdf => ({
    pedido: {
      id: '9f3a21bc-0000-4000-8000-000000000000', codigo: '0421173', criado_em: '2026-10-19T19:22:00Z', dt_entrega: '2026-10-21', status: 'enviado', tipo: 'venda',
      cond_pagamento: null, ordem_compra_cliente: null, endereco_entrega: null, observacao: null,
      itens: [
        { produto: 'F1', unidade: 'KI', quantidade: '20', preco: '142.10', preco_tabela: '158.00', desconto: 10 },
        { produto: 'F2', unidade: 'KI', quantidade: '14', preco: '153.67', preco_tabela: '153.67' },
        { produto: 'R1', unidade: 'KI', quantidade: '2', preco: null },
      ],
      ordens_sap: [{ ordem: '0005997479', tipo_material: 'FERT' }, { ordem: '0005997480', tipo_material: 'HAWA' }],
      ...extra,
    },
    cliente: { cod_cliente: '1058893', nome_fantasia: 'Lagoa', razao_social: 'Super Lagoa', cnpjcpf: '04601165002709', telefone: null, endereco: { cidade: 'Juazeiro', uf: 'CE' }, areas: [{ tipo_material: 'FERT', lista_preco: { descricao: 'Grupo Lagoa' } }], formas_pagamento: [{ codigo: 'B', descricao: 'Boletos' }] },
    vendedor: { codigo: '100571', nome: 'Jessica', email: null },
    produtos: { F1: prod('File de Peito', 'FERT'), F2: prod('Coxa', 'FERT'), R1: prod('Pao de Queijo', 'HAWA') },
    tipo_bonificacao: null, fotos_url: 'https://fotos.exemplo', gerado_em: '2026-10-19T20:00:00Z',
  });

  test('uma folha por ordem do SAP (industrializados e revenda), com ordem, totais, desconto e peso', () => {
    const d = montarDocPedido(entrada());
    assert.deepEqual(d.folhas.map((f) => [f.titulo, f.ordemSap, f.itens.length]), [['Industrializados', '0005997479', 2], ['Revenda', '0005997480', 1]]);
    const [a, b] = d.folhas[0].itens;
    assert.deepEqual([a.unidade, a.precoTabela, a.precoFinal, a.total, a.descontoPct, a.pesoKg], ['CX', 158, 142.1, 2842, 10.06, 140]);
    assert.deepEqual([b.descontoPct, b.total, b.pesoKg], [null, 2151.38, 98]);
    assert.equal(d.folhas[1].itens[0].total, null); // sem preco: o SAP define
    assert.equal(d.tabelaPrecos, 'Grupo Lagoa');
    assert.equal(d.pagamento, 'Boletos');
    assert.equal(d.cliente.documento, '04.601.165/0027-09');
    const html = htmlPedido(d);
    assert.match(html, /Folha 1 de 2/);
    assert.match(html, /Folha 2 de 2/);
    assert.match(html, /5997479/);
    assert.match(html, /5997480/);
    assert.match(html, /item\(ns\) sem preço/);
    assert.match(html, /https:\/\/fotos\.exemplo\/F1\.jpg/);
  });

  test('sem as ordens do SAP (offline): o documento sai mesmo assim e avisa que aguarda o SAP', () => {
    const d = montarDocPedido(entrada({ status: 'pendente', codigo: null, ordens_sap: [] }));
    assert.equal(d.folhas.length, 2);
    assert.equal(d.folhas[0].ordemSap, null);
    assert.match(d.situacao, /aguardando envio/);
    const html = htmlPedido(d);
    assert.match(html, /Aguardando confirmação do SAP/);
    assert.match(html, /9F3A21BC/); // sem numero definitivo, usa a referencia
  });

  test('bonificacao: tag e valor so de referencia; texto vindo do cadastro e escapado', () => {
    const e = entrada({ tipo: 'bonificacao', observacao: '<script>alert(1)</script>' });
    e.tipo_bonificacao = 'Amostra';
    const html = htmlPedido(montarDocPedido(e));
    assert.match(html, /BONIFICAÇÃO/);
    assert.match(html, /Bonificação — Amostra/);
    assert.match(html, /Valor de referência/);
    assert.ok(!html.includes('<script>alert(1)</script>'));
  });

  test('o app e o painel usam o MESMO arquivo do documento (copia identica)', () => {
    for (const nome of ['pedidoPdf.ts', 'pdfLogos.ts']) {
      const app = path.resolve(process.cwd(), 'src/domain', nome);
      const painel = path.resolve(process.cwd(), '../painel/src', nome);
      if (!existsSync(painel)) continue;
      assert.equal(readFileSync(painel, 'utf8'), readFileSync(app, 'utf8'), `painel/src/${nome} diferente de app/src/domain/${nome}: copie o do app`);
    }
  });
});
