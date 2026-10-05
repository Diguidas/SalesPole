import type { SQLiteDatabase } from 'expo-sqlite';
import {
  areaDoGrupo, escolherPreco, estoqueEmUnidade, grupoDoMaterial, lerConversoes, precoNaUnidade, rotuloUnidade,
  UNIDADE_PEDIDO_PADRAO,
  type AreaCliente, type DadosProduto, type GrupoMaterial, type LinhaPreco, type PrecoNaUnidade,
} from '@/domain/preco';
import { lerRegra, regraNaUnidade, type RegraQuantidade } from '@/domain/quantidade';

export interface ProdutoCatalogo {
  cod_produto: string;
  descricao: string;
  /** CODIGO da unidade em que o pedido e feito (a caixa, ex.: KI): e o que vai no pedido */
  unidade: string;
  /** TEXTO da mesma unidade, o que o vendedor le (ex.: CX) */
  unidadeTexto: string;
  /** texto de cada codigo de unidade deste produto (KI -> CX, KG -> KG...) */
  textos: Record<string, string>;
  tipo_material: string | null;
  grupo: GrupoMaterial | null;
  /** minimo/multiplo JA convertidos para a unidade do pedido (o cadastro guarda na unidade base) */
  regra: RegraQuantidade;
  /** preco de tabela na unidade do pedido (referencia; o SAP precifica) */
  preco: PrecoNaUnidade | null;
  /**
   * true = o centro do cliente TEM dados de estoque e este produto tem menos de 1 caixa.
   * O estoque em si nao e mostrado ao vendedor; so serve para esconder o produto.
   */
  semEstoque: boolean;
  /** false = o cliente nao tem area de vendas para este tipo de produto */
  disponivel: boolean;
}

interface ProdutoRow {
  cod_produto: string;
  descricao: string | null;
  tipo_material: string | null;
  dados: string | null;
}

const marcadores = (n: number) => Array(n).fill('?').join(',');

function lerDados(texto: string | null): DadosProduto {
  try {
    return texto ? (JSON.parse(texto) as DadosProduto) : {};
  } catch {
    return {};
  }
}

/**
 * Preco de tabela e estoque dos produtos para UM cliente: o preco depende da lista e do grupo
 * da area de vendas do cliente para aquele tipo de material; o estoque, do centro dessa area.
 */
async function enriquecer(db: SQLiteDatabase, areas: AreaCliente[], produtos: ProdutoRow[], hoje: string): Promise<ProdutoCatalogo[]> {
  if (!produtos.length) return [];
  const ids = produtos.map((p) => p.cod_produto);

  const pares = areas.filter((a) => a.lista_preco?.codigo).map((a) => ({ pltyp: a.lista_preco!.codigo, kdgrp: a.rede?.codigo ?? '' }));
  const pltyps = [...new Set(pares.map((p) => p.pltyp))];
  const centros = [...new Set(areas.map((a) => a.centro).filter(Boolean))];

  const grupoRows = pares.length
    ? await db.getAllAsync<Record<string, unknown>>(
        `SELECT * FROM precos_grupo WHERE cod_produto IN (${marcadores(ids.length)})
            AND (${pares.map(() => '(pltyp = ? AND kdgrp = ?)').join(' OR ')})`,
        [...ids, ...pares.flatMap((p) => [p.pltyp, p.kdgrp])],
      )
    : [];
  const listaRows = pltyps.length
    ? await db.getAllAsync<Record<string, unknown>>(
        `SELECT * FROM precos_lista WHERE cod_produto IN (${marcadores(ids.length)}) AND pltyp IN (${marcadores(pltyps.length)})`,
        [...ids, ...pltyps],
      )
    : [];
  const estoqueRows = centros.length
    ? await db.getAllAsync<{ centro: string; cod_produto: string; quantidade: number }>(
        `SELECT centro, cod_produto, quantidade FROM estoque
          WHERE cod_produto IN (${marcadores(ids.length)}) AND centro IN (${marcadores(centros.length)})`,
        [...ids, ...centros],
      )
    : [];
  // centros para os quais ja baixamos algum estoque: sem isso nao da para dizer "sem estoque"
  const centrosComDados = new Set(
    centros.length
      ? (await db.getAllAsync<{ centro: string }>(`SELECT DISTINCT centro FROM estoque WHERE centro IN (${marcadores(centros.length)})`, centros)).map((r) => r.centro)
      : [],
  );

  const linha = (r: Record<string, unknown>, origem: 'grupo' | 'lista'): LinhaPreco => ({
    kbetr: r.kbetr as number | null, kpein: r.kpein as number | null, kmein: r.kmein as string | null,
    datab: r.datab as string, datbi: r.datbi as string, origem,
    descontoMax: (r.desconto_max as number | null) ?? 0,
  });

  return produtos.map((p) => {
    const grupo = grupoDoMaterial(p.tipo_material);
    const area = areaDoGrupo(areas, grupo);
    const dados = lerDados(p.dados);
    const conv = lerConversoes(dados);
    const unidade = dados.unidade_venda || UNIDADE_PEDIDO_PADRAO; // codigo interno (ex.: KI), sem mexer em maiusculas

    let preco: PrecoNaUnidade | null = null;
    if (area?.lista_preco?.codigo) {
      const pltyp = area.lista_preco.codigo;
      const kdgrp = area.rede?.codigo ?? '';
      const g = grupoRows.filter((r) => r.cod_produto === p.cod_produto && r.pltyp === pltyp && r.kdgrp === kdgrp).map((r) => linha(r, 'grupo'));
      const l = listaRows.filter((r) => r.cod_produto === p.cod_produto && r.pltyp === pltyp).map((r) => linha(r, 'lista'));
      preco = precoNaUnidade(escolherPreco(g, l, hoje), unidade, conv);
    }

    // estoque em CAIXAS (o SAP guarda na unidade base). Sem conversao conhecida, usa a quantidade como esta.
    let semEstoque = false;
    if (area && centrosComDados.has(area.centro)) {
      const linhaEstoque = estoqueRows.find((e) => e.cod_produto === p.cod_produto && e.centro === area.centro);
      const base = linhaEstoque?.quantidade ?? 0;
      const emCaixas = estoqueEmUnidade(base, unidade, conv) ?? base;
      semEstoque = emCaixas < 1;
    }

    return {
      cod_produto: p.cod_produto,
      descricao: p.descricao ?? p.cod_produto,
      unidade,
      unidadeTexto: rotuloUnidade(unidade, conv),
      textos: conv.textos,
      tipo_material: p.tipo_material,
      grupo,
      regra: regraNaUnidade(lerRegra(dados), unidade, conv),
      preco,
      semEstoque,
      disponivel: area !== null,
    };
  });
}

/**
 * Busca no catalogo (nome, codigo ou EAN) para um cliente. So aparece produto que o vendedor PODE vender:
 *  - o cliente tem area de vendas para o tipo do produto;
 *  - existe preco de tabela vigente (sem preco nao aparece);
 *  - ha pelo menos 1 caixa em estoque no centro do cliente.
 * Muitos produtos sao descartados, entao le o catalogo em PAGINAS, em ordem de nome, ate juntar `limite`.
 */
export async function buscarProdutos(db: SQLiteDatabase, areas: AreaCliente[], busca: string, hoje: string, limite = 60): Promise<ProdutoCatalogo[]> {
  const termo = `%${busca.trim()}%`;
  const PAGINA = 150;
  const MAX_PAGINAS = 10; // no maximo 1.500 produtos varridos por busca
  const vendaveis: ProdutoCatalogo[] = [];

  for (let pagina = 0; pagina < MAX_PAGINAS && vendaveis.length < limite; pagina++) {
    const offset = pagina * PAGINA;
    const rows = busca.trim()
      ? await db.getAllAsync<ProdutoRow>(
          `SELECT cod_produto, descricao, tipo_material, dados FROM produtos
            WHERE descricao LIKE ? OR cod_produto LIKE ? OR ean LIKE ? ORDER BY descricao LIMIT ? OFFSET ?`,
          termo, termo, termo, PAGINA, offset,
        )
      : await db.getAllAsync<ProdutoRow>(
          `SELECT cod_produto, descricao, tipo_material, dados FROM produtos ORDER BY descricao LIMIT ? OFFSET ?`,
          PAGINA, offset,
        );
    if (!rows.length) break;

    const lista = await enriquecer(db, areas, rows, hoje);
    for (const p of lista) if (p.disponivel && p.preco !== null && !p.semEstoque) vendaveis.push(p);

    if (rows.length < PAGINA) break; // acabou o catalogo
  }
  return vendaveis.slice(0, limite);
}

/** Os mesmos dados para uma lista de codigos (itens ja no pedido: aqui NADA e escondido: preco, estoque e area nao filtram). */
export async function infoProdutos(db: SQLiteDatabase, areas: AreaCliente[], codigos: string[], hoje: string): Promise<Record<string, ProdutoCatalogo>> {
  if (!codigos.length) return {};
  const rows = await db.getAllAsync<ProdutoRow>(
    `SELECT cod_produto, descricao, tipo_material, dados FROM produtos WHERE cod_produto IN (${marcadores(codigos.length)})`,
    codigos,
  );
  const lista = await enriquecer(db, areas, rows, hoje);
  return Object.fromEntries(lista.map((p) => [p.cod_produto, p]));
}

/** Texto de uma unidade para a tela, no contexto de um produto (KI -> CX). */
export function rotulo(p: ProdutoCatalogo, codigo: string | null | undefined): string {
  if (!codigo) return 'un';
  if (codigo === p.unidade) return p.unidadeTexto;
  return p.textos[codigo] ?? codigo;
}
