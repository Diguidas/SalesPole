import type { SQLiteDatabase } from 'expo-sqlite';
import { FOTOS_URL } from '@/lib/config';
import { htmlPedido, montarDocPedido, nomeArquivoPedido, type EntradaPdf, type ProdutoBruto } from '@/domain/pedidoPdf';
import { lerPedidoApp } from './pedidos';
import { obterCliente } from './queries';
import { lerMeta } from './sync';

// Confirmacao do pedido em PDF: montada SO com o que ja esta no aparelho (funciona sem internet). Gerar de novo depois
// que as ordens do SAP chegarem atualiza o documento (numero da ordem, situacao).

const json = <T>(v: unknown, vazio: T): T => {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : vazio;
  } catch {
    return vazio;
  }
};

/** Dados brutos do pedido no aparelho. null se o pedido nao existe. */
export async function carregarEntradaPdf(db: SQLiteDatabase, id: string): Promise<EntradaPdf | null> {
  const pedido = await lerPedidoApp(db, id);
  if (!pedido) return null;

  const cliente = await obterCliente(db, pedido.cod_cliente);
  const vend = json<{ cod?: string; nome?: string | null; email?: string } | null>(await lerMeta(db, 'vendedor'), null);

  const codigos = [...new Set(pedido.itens.map((i) => i.produto))];
  const produtos: Record<string, ProdutoBruto> = {};
  if (codigos.length) {
    const linhas = await db.getAllAsync<{ cod_produto: string; descricao: string | null; tipo_material: string | null; dados: string | null }>(
      `SELECT cod_produto, descricao, tipo_material, dados FROM produtos WHERE cod_produto IN (${codigos.map(() => '?').join(',')})`,
      ...codigos,
    );
    for (const l of linhas) {
      const d = json<Record<string, any>>(l.dados, {});
      produtos[l.cod_produto] = {
        descricao: l.descricao,
        tipo_material: l.tipo_material,
        unidade_venda: d.unidade_venda ?? null,
        unidade_venda_texto: d.unidade_venda_texto ?? null,
        unidade_base: d.unidade_base ?? null,
        conversoes: Array.isArray(d.conversoes) ? d.conversoes : null,
        pesoliquido: d.peso?.pesoliquido ?? null,
      };
    }
  }

  const tipoBon = pedido.tipo === 'bonificacao' && pedido.tipo_bonificacao
    ? (await db.getFirstAsync<{ descricao: string | null }>('SELECT descricao FROM bonificacao_tipos WHERE codigo = ?', pedido.tipo_bonificacao))?.descricao ?? pedido.tipo_bonificacao
    : null;

  return {
    pedido: {
      id: pedido.id,
      codigo: pedido.codigo,
      criado_em: pedido.criado_em,
      dt_entrega: pedido.dt_entrega,
      status: pedido.status,
      tipo: pedido.tipo,
      cond_pagamento: pedido.cond_pagamento,
      ordem_compra_cliente: pedido.ordem_compra_cliente,
      endereco_entrega: pedido.endereco_entrega,
      observacao: pedido.observacao,
      itens: pedido.itens.map((i) => ({
        produto: i.produto,
        unidade: i.unidade,
        quantidade: i.quantidade,
        preco: i.preco ?? null,
        preco_tabela: i.precoTabela ?? null,
        desconto: i.desconto ?? null,
        ...(i.brinde ? { brinde: true } : {}),
      })),
      ordens_sap: pedido.ordens_sap,
    },
    cliente: cliente
      ? {
          cod_cliente: cliente.cod_cliente,
          nome_fantasia: cliente.nome_fantasia,
          razao_social: cliente.razao_social,
          cnpjcpf: cliente.cnpjcpf,
          telefone: cliente.telefone,
          endereco: cliente.endereco,
          areas: cliente.areas as never,
          formas_pagamento: cliente.formas_pagamento,
        }
      : null,
    vendedor: vend ? { codigo: vend.cod ?? '', nome: vend.nome ?? null, email: vend.email ?? null } : null,
    produtos,
    tipo_bonificacao: tipoBon,
    fotos_url: FOTOS_URL,
    gerado_em: new Date().toISOString(),
  };
}

export interface PdfGerado {
  uri: string;
  nome: string;
}

/** Gera o PDF do pedido (uma folha por ordem do SAP) e devolve o arquivo. Lanca Error se o pedido nao existir. */
export async function gerarPdfPedido(db: SQLiteDatabase, id: string): Promise<PdfGerado> {
  // carregados so quando o vendedor pede: ficam fora do bundle inicial
  const { printToFileAsync } = await import('expo-print');
  const entrada = await carregarEntradaPdf(db, id);
  if (!entrada) throw new Error('Pedido não encontrado neste aparelho.');
  const doc = montarDocPedido(entrada);
  const { base64, uri: uriImpressao } = await printToFileAsync({
    html: htmlPedido(doc),
    width: 595,
    height: 842,
    margins: { left: 23, top: 23, right: 23, bottom: 23 },
    base64: true,
  });
  const nome = nomeArquivoPedido(doc);

  // grava o PDF numa pasta do app que o expo-sharing pode ler, com nome legivel (pedido_0421173.pdf);
  // se nao der (Expo Go), compartilha o arquivo do expo-print como esta
  try {
    if (!base64) throw new Error('sem base64');
    const { File, Paths } = await import('expo-file-system');
    const destino = new File(Paths.cache, nome);
    if (destino.exists) destino.delete();
    destino.create();
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    destino.write(bytes);
    return { uri: destino.uri, nome };
  } catch {
    return { uri: uriImpressao, nome };
  }
}

/** Gera o PDF e abre o compartilhamento do aparelho (WhatsApp, e-mail, salvar...). */
export async function compartilharPdfPedido(db: SQLiteDatabase, id: string): Promise<void> {
  const { uri, nome } = await gerarPdfPedido(db, id);
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Este aparelho não tem compartilhamento disponível.');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: nome, UTI: 'com.adobe.pdf' });
}
