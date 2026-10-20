import { api } from './api';
import { htmlPedido, montarDocPedido, type EntradaPdf } from './pedidoPdf';

/** Mesmo bucket de fotos que o pedido do app e a tela de Produtos usam (<codigo>.jpg). */
const FOTOS_URL = ((import.meta.env.VITE_FOTOS_URL as string) || 'https://jebjtpmugcnpxxkdexyg.supabase.co/storage/v1/object/public/lojinha-fotos').replace(/\/$/, '');

/**
 * Abre a confirmacao do pedido (mesmo documento do app) para imprimir / "Salvar como PDF" no navegador.
 * Usa um iframe escondido: nao troca de aba e o navegador cuida da paginacao A4 (uma folha por ordem do SAP).
 */
export async function imprimirPedidoApp(id: string): Promise<void> {
  const dados = await api<Omit<EntradaPdf, 'fotos_url' | 'gerado_em'>>(`/painel/pedido-app/${encodeURIComponent(id)}/pdf-dados`);
  const doc = montarDocPedido({ ...dados, fotos_url: FOTOS_URL, gerado_em: new Date().toISOString() });
  const html = htmlPedido(doc);

  const quadro = document.createElement('iframe');
  quadro.setAttribute('aria-hidden', 'true');
  quadro.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(quadro);
  const janela = quadro.contentWindow;
  if (!janela) {
    quadro.remove();
    throw new Error('O navegador não deixou preparar a impressão.');
  }
  janela.document.open();
  janela.document.write(html);
  janela.document.close();

  // espera as fotos carregarem (ou falharem: o proprio documento troca por uma inicial) antes de abrir a impressao
  const imagens = Array.from(janela.document.images);
  await Promise.all(imagens.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((ok) => { img.addEventListener('load', () => ok()); img.addEventListener('error', () => ok()); }))));
  // o titulo do documento vira o nome sugerido do arquivo
  const tituloAntes = document.title;
  document.title = `pedido_${doc.numero || doc.referencia}`;
  janela.focus();
  janela.print();
  setTimeout(() => {
    document.title = tituloAntes;
    quadro.remove();
  }, 60_000);
}
