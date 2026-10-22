// GERADO a partir de shared/pdf/pedidoPdf.ts. NAO EDITE AQUI: altere a fonte e rode "npm run shared" (app ou api).
// Documento "Confirmacao de pedido" (PDF). Codigo PURO, sem dependencias: o app (offline, expo-print) e o painel
// (impressao do navegador) usam este mesmo arquivo. ATENCAO: ha uma copia identica em painel/src/pedidoPdf.ts
// (o teste do app confere que as duas sao iguais): altere aqui e copie para la.

import { LOGO_POLE, LOGO_SALESPOLE } from './pdfLogos';

// ---------------------------------------------------------------------------
// Entrada (o que cada lado le do seu banco) e documento pronto para imprimir
// ---------------------------------------------------------------------------

export interface ItemBruto {
  produto: string;
  unidade: string;
  quantidade: string;
  /** preco FINAL por caixa (o que vai ao SAP) */
  preco?: string | null;
  /** preco de tabela por caixa, fixado no envio (pedidos antigos nao tem) */
  preco_tabela?: string | null;
  /** desconto total em % sobre a tabela */
  desconto?: number | null;
  /** brinde de combo: sai no PDF como desconto total de combo (preco final zero) */
  brinde?: boolean;
}

export interface ProdutoBruto {
  descricao: string | null;
  tipo_material: string | null;
  unidade_venda?: string | null;
  unidade_venda_texto?: string | null;
  unidade_base?: string | null;
  conversoes?: Array<{ unidade: string; texto?: string | null; fator: number }> | null;
  /** peso liquido por unidade base, como veio do SAP */
  pesoliquido?: string | number | null;
}

export interface EntradaPdf {
  pedido: {
    id: string;
    codigo: string | null;
    criado_em: string;
    dt_entrega: string | null;
    status: string;
    tipo: 'venda' | 'bonificacao';
    cond_pagamento: string | null;
    ordem_compra_cliente: string | null;
    endereco_entrega: string | null;
    observacao: string | null;
    itens: ItemBruto[];
    ordens_sap: Array<{ ordem: string; tipo_material: string; vkorg?: string }>;
  };
  cliente: {
    cod_cliente: string;
    nome_fantasia: string | null;
    razao_social: string | null;
    cnpjcpf: string | null;
    telefone: string | null;
    endereco: { logradouro?: string; bairro?: string; cidade?: string; uf?: string; cep?: string } | null;
    areas: Array<{ tipo_material?: string; lista_preco?: { codigo?: string; descricao?: string } | null }>;
    formas_pagamento: Array<{ codigo?: string; descricao?: string }> | null;
  } | null;
  vendedor: { codigo: string; nome: string | null; email: string | null } | null;
  produtos: Record<string, ProdutoBruto | undefined>;
  /** descricao do tipo de bonificacao (bonificacao) */
  tipo_bonificacao: string | null;
  /** onde ficam as fotos (<codigo>.jpg); vazio = sem foto */
  fotos_url: string;
  gerado_em: string;
}

export type GrupoPdf = 'industrializados' | 'revenda';

export interface ItemDoc {
  produto: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  precoTabela: number | null;
  descontoPct: number | null;
  precoFinal: number | null;
  total: number | null;
  totalTabela: number | null;
  /** brinde de combo: desconto total, preco final zero */
  brinde: boolean;
  pesoKg: number | null;
  foto: string | null;
}

export interface FolhaDoc {
  grupo: GrupoPdf;
  titulo: string;
  /** ordem do SAP desta folha; null = ainda nao chegou */
  ordemSap: string | null;
  itens: ItemDoc[];
}

export interface DocPedido {
  numero: string;
  referencia: string;
  emissao: string;
  previsao: string | null;
  tipo: 'venda' | 'bonificacao';
  natureza: string;
  situacao: string;
  cliente: { codigo: string; razao: string; fantasia: string; documento: string; endereco: string; cidadeUf: string; telefone: string };
  vendedor: { nome: string; codigo: string; email: string };
  tabelaPrecos: string;
  pagamento: string;
  ordemCompra: string;
  observacao: string;
  folhas: FolhaDoc[];
  geradoEm: string;
}

// ---------------------------------------------------------------------------
// Empresa (emitente)
// ---------------------------------------------------------------------------

export const EMPRESA = {
  nome: 'Pole Alimentos Ltda',
  endereco: 'Av. Wilson Camurça, 401 - Distrito Industrial I',
  cidade: 'Maracanaú/CE',
  cep: '61939-000',
  cnpj: '03282301000143',
};

// ---------------------------------------------------------------------------
// Formatacao
// ---------------------------------------------------------------------------

const par = (n: number) => String(n).padStart(2, '0');
const milhar = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function moedaPdf(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const neg = v < 0;
  const [i, d] = Math.abs(v).toFixed(2).split('.');
  return `${neg ? '-' : ''}R$ ${milhar(i)},${d}`;
}

export function numeroPdf(v: number, casas = 0): string {
  const [i, d] = v.toFixed(casas).split('.');
  const dec = d ? d.replace(/0+$/, '') : '';
  return dec ? `${milhar(i)},${dec}` : milhar(i);
}

export function dataPdf(iso: string | null | undefined): string {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${par(d.getDate())}/${par(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function dataHoraPdf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${dataPdf(iso)} ${par(d.getHours())}:${par(d.getMinutes())}`;
}

export function documentoPdf(v: string | null | undefined): string {
  const n = (v ?? '').replace(/\D/g, '');
  if (n.length === 14) return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
  if (n.length === 11) return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
  return v?.trim() || '—';
}

const SITUACAO: Record<string, string> = {
  pendente: 'Registrado — aguardando envio ao SAP',
  recebido: 'Recebido — enviando ao SAP',
  enviando: 'Recebido — enviando ao SAP',
  parcial: 'Parcialmente confirmado no SAP',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovado: 'Aprovado — enviando ao SAP',
  rejeitado: 'Não aprovado',
  enviado: 'Confirmado no SAP',
  erro: 'Pendente de reenvio ao SAP',
};

const grupoDoMaterial = (tipo: string | null | undefined): GrupoPdf => (tipo === 'HAWA' || tipo === 'ZVAR' ? 'revenda' : 'industrializados');
const TITULO_GRUPO: Record<GrupoPdf, string> = { industrializados: 'Industrializados', revenda: 'Revenda' };

// ---------------------------------------------------------------------------
// Montagem do documento a partir dos dados brutos
// ---------------------------------------------------------------------------

function pesoDoItem(qtd: number, unidade: string, p: ProdutoBruto | undefined): number | null {
  if (!p) return null;
  const fator = p.conversoes?.find((c) => c.unidade === unidade)?.fator ?? (unidade === p.unidade_base ? 1 : null);
  if (!fator || !(fator > 0)) return null;
  const peso = Number(p.pesoliquido);
  if (p.unidade_base === 'KG') return qtd * fator;
  return peso > 0 ? qtd * fator * peso : null;
}

function itemDoc(i: ItemBruto, p: ProdutoBruto | undefined, fotosUrl: string): ItemDoc {
  const quantidade = Number(i.quantidade) || 0;
  const tabela = i.preco_tabela != null && i.preco_tabela !== '' ? Number(i.preco_tabela) : null;
  const finalEnviado = i.preco != null && i.preco !== '' ? Number(i.preco) : null;
  const desc = typeof i.desconto === 'number' && i.desconto > 0 ? i.desconto : null;
  // preco final: o que foi enviado ao SAP; sem ele, a tabela com o desconto
  const precoFinal = i.brinde ? 0 : finalEnviado !== null && Number.isFinite(finalEnviado) ? finalEnviado : tabela !== null ? Math.round(tabela * (1 - (desc ?? 0) / 100) * 100) / 100 : null;
  // o preco e por caixa: so multiplica quando o item esta na unidade de venda
  const naUnidadeDoPreco = !p?.unidade_venda || p.unidade_venda === i.unidade;
  // desconto exibido = o que de fato esta no preco enviado (tabela x preco final), nao o digitado
  const descReal = i.brinde ? 100 : tabela !== null && tabela > 0 && precoFinal !== null ? Math.max(0, Math.round((1 - precoFinal / tabela) * 10000) / 100) : desc;
  const unTexto =p?.conversoes?.find((c) => c.unidade === i.unidade)?.texto || (p?.unidade_venda === i.unidade ? p?.unidade_venda_texto : null) || i.unidade;
  return {
    produto: i.produto,
    descricao: p?.descricao?.trim() || `Produto ${i.produto}`,
    quantidade,
    unidade: unTexto || i.unidade,
    precoTabela: tabela !== null && Number.isFinite(tabela) ? tabela : null,
    descontoPct: descReal && descReal > 0 ? descReal : null,
    precoFinal: precoFinal !== null && Number.isFinite(precoFinal) ? precoFinal : null,
    total: naUnidadeDoPreco && precoFinal !== null && Number.isFinite(precoFinal) ? Math.round(quantidade * precoFinal * 100) / 100 : null,
    totalTabela: naUnidadeDoPreco && tabela !== null && Number.isFinite(tabela) ? Math.round(quantidade * tabela * 100) / 100 : null,
    brinde: i.brinde === true,
    pesoKg: pesoDoItem(quantidade, i.unidade, p),
    foto: fotosUrl ? `${fotosUrl.replace(/\/$/, '')}/${encodeURIComponent(i.produto.trim())}.jpg` : null,
  };
}

export function montarDocPedido(e: EntradaPdf): DocPedido {
  const { pedido: p, cliente: c, vendedor: v } = e;
  const grupos = new Map<GrupoPdf, ItemDoc[]>();
  for (const i of p.itens) {
    const g = grupoDoMaterial(e.produtos[i.produto]?.tipo_material);
    grupos.set(g, [...(grupos.get(g) ?? []), itemDoc(i, e.produtos[i.produto], e.fotos_url)]);
  }
  const ordemDe = (g: GrupoPdf) => p.ordens_sap.find((o) => grupoDoMaterial(o.tipo_material) === g)?.ordem ?? null;
  const folhas: FolhaDoc[] = (['industrializados', 'revenda'] as GrupoPdf[])
    .filter((g) => grupos.has(g))
    .map((g) => ({ grupo: g, titulo: TITULO_GRUPO[g], ordemSap: ordemDe(g), itens: grupos.get(g)! }));

  const end = c?.endereco;
  const cidadeUf = [end?.cidade, end?.uf].filter(Boolean).join('/');
  const enderecoCadastro = [end?.logradouro, end?.bairro, end?.cep].filter(Boolean).join(' - ');
  const lista = c?.areas.find((a) => a.lista_preco?.descricao)?.lista_preco?.descricao ?? c?.areas.find((a) => a.lista_preco?.codigo)?.lista_preco?.codigo ?? '';
  const formas = c?.formas_pagamento ?? [];
  const pagamento = p.cond_pagamento
    ? formas.find((f) => f.codigo === p.cond_pagamento)?.descricao ?? p.cond_pagamento
    : formas.map((f) => f.descricao ?? f.codigo).filter(Boolean).join(' / ');
  const bonif = p.tipo === 'bonificacao';

  return {
    numero: p.codigo ?? '',
    referencia: p.id.slice(0, 8).toUpperCase(),
    emissao: p.criado_em,
    previsao: p.dt_entrega,
    tipo: p.tipo,
    natureza: bonif ? `Bonificação${e.tipo_bonificacao ? ` — ${e.tipo_bonificacao}` : ''}` : 'Venda de mercadorias',
    situacao: SITUACAO[p.status] ?? 'Registrado',
    cliente: {
      codigo: c?.cod_cliente ?? '',
      razao: c?.razao_social ?? c?.nome_fantasia ?? '—',
      fantasia: c?.nome_fantasia ?? '—',
      documento: documentoPdf(c?.cnpjcpf),
      endereco: p.endereco_entrega?.trim() || enderecoCadastro || '—',
      cidadeUf: cidadeUf || '—',
      telefone: c?.telefone?.trim() || '—',
    },
    vendedor: { nome: v?.nome?.trim() || '—', codigo: v?.codigo ?? '', email: v?.email?.trim() || '' },
    tabelaPrecos: lista || '—',
    pagamento: pagamento || '—',
    ordemCompra: p.ordem_compra_cliente?.trim() || '',
    observacao: p.observacao?.trim() || '',
    folhas,
    geradoEm: e.gerado_em,
  };
}

// ---------------------------------------------------------------------------
// HTML (layout em A4, preto e branco, no estilo dos documentos fiscais)
// ---------------------------------------------------------------------------

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const caixa = (rotulo: string, valor: string, extra = '') =>
  `<div class="c ${extra}"><div class="r">${esc(rotulo)}</div><div class="v">${valor || '&nbsp;'}</div></div>`;

const CSS = `
@page { size: A4; margin: 8mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 9pt; color: #111; }
.folha { page-break-after: always; }
.folha:last-child { page-break-after: auto; }
.linha { display: flex; }
.linha > .c { border: 0.6pt solid #222; margin: 0 -0.3pt -0.6pt 0; padding: 1.2mm 1.8mm 1.4mm; flex: 1 1 0; min-width: 0; }
.r { font-size: 5.6pt; letter-spacing: .25pt; text-transform: uppercase; color: #444; margin-bottom: .6mm; }
.v { font-size: 8.6pt; font-weight: 600; word-break: break-word; }
.v.n { font-weight: 400; }
.w2 { flex: 2 1 0 !important; } .w3 { flex: 3 1 0 !important; } .w4 { flex: 4 1 0 !important; }
.sec { font-size: 6.4pt; font-weight: 700; letter-spacing: .6pt; text-transform: uppercase; margin: 3.2mm 0 .9mm; color: #111; }
.topo { display: flex; border: 0.6pt solid #222; }
.topo > div { padding: 2mm 2.4mm; }
.emit { flex: 3.2 1 0; display: flex; gap: 3mm; align-items: center; }
.emit img { height: 14mm; }
.emit .nome { font-size: 10pt; font-weight: 700; }
.emit .sub { font-size: 7.2pt; color: #333; line-height: 1.35; }
.tit { flex: 2.4 1 0; text-align: center; border-left: 0.6pt solid #222; border-right: 0.6pt solid #222; display: flex; flex-direction: column; justify-content: center; }
.tit .t1 { font-size: 11.5pt; font-weight: 800; letter-spacing: .4pt; }
.tit .t2 { font-size: 6.6pt; color: #333; margin-top: 1mm; }
.tit .tag { display: inline-block; margin: 1.4mm auto 0; border: 0.8pt solid #111; padding: .3mm 2.4mm; font-size: 7.4pt; font-weight: 800; letter-spacing: .6pt; }
.num { flex: 2 1 0; text-align: center; display: flex; flex-direction: column; justify-content: center; gap: 1mm; }
.num .n1 { font-size: 6pt; text-transform: uppercase; letter-spacing: .3pt; color: #444; }
.num .n2 { font-size: 13pt; font-weight: 800; }
.num .n3 { font-size: 7.6pt; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { font-size: 5.8pt; text-transform: uppercase; letter-spacing: .2pt; font-weight: 700; color: #333; border: 0.6pt solid #222; padding: 1.2mm 1.4mm; text-align: center; background: #f1f1f1; }
td { border: 0.6pt solid #222; padding: 1mm 1.5mm; font-size: 8.2pt; vertical-align: middle; }
tr { page-break-inside: avoid; }
td.d { text-align: right; white-space: nowrap; }
td.f { width: 12mm; padding: 0.8mm; text-align: center; }
.foto { width: 10.5mm; height: 10.5mm; display: block; margin: 0 auto; object-fit: contain; }
.ph { width: 10.5mm; height: 10.5mm; margin: 0 auto; border: 0.5pt solid #bbb; background: #f4f4f4; color: #777; font-weight: 700; font-size: 11pt; display: flex; align-items: center; justify-content: center; }
.sku { font-size: 6.6pt; color: #444; }
.desc { font-weight: 600; }
.neg { font-weight: 700; }
.tot { display: flex; justify-content: flex-end; margin-top: 2.4mm; }
.tot table { width: 78mm; }
.tot td { font-size: 8.4pt; }
.tot td:first-child { background: #f1f1f1; font-size: 6.8pt; text-transform: uppercase; letter-spacing: .2pt; }
.tot td:last-child { text-align: right; font-weight: 600; }
.tot tr.g td { font-size: 10pt; font-weight: 800; }
.aviso { border: 0.6pt solid #222; padding: 1.6mm 2.2mm; font-size: 7pt; line-height: 1.45; margin-top: 3mm; }
.rod { margin-top: 3mm; display: flex; justify-content: space-between; align-items: center; font-size: 6.8pt; color: #444; border-top: 0.6pt solid #222; padding-top: 1.6mm; }
.rod img { height: 7mm; }
`;

function htmlFolha(d: DocPedido, f: FolhaDoc, idx: number): string {
  const tot = f.itens.reduce((a, i) => a + (i.total ?? 0), 0);
  const totTabela = f.itens.reduce((a, i) => a + (i.totalTabela ?? 0), 0);
  const semPreco = f.itens.filter((i) => i.total === null).length;
  const peso = f.itens.reduce((a, i) => a + (i.pesoKg ?? 0), 0);
  const algumPeso = f.itens.some((i) => i.pesoKg !== null);
  const descontos = totTabela > 0 && tot > 0 ? Math.max(0, totTabela - tot) : 0;
  const qtdTotal = f.itens.reduce((a, i) => a + i.quantidade, 0);
  const todas = d.folhas.length;
  const totalPedido = d.folhas.reduce((a, x) => a + x.itens.reduce((s, i) => s + (i.total ?? 0), 0), 0);
  const bonif = d.tipo === 'bonificacao';

  const linhas = f.itens
    .map((i) => {
      const ini = esc(i.descricao.replace(/^BCX\s+/i, '').trim().charAt(0).toUpperCase() || '?');
      const foto = i.foto
        ? `<img class="foto" src="${esc(i.foto)}" onerror="this.outerHTML='<div class=&quot;ph&quot;>${ini}</div>'">`
        : `<div class="ph">${ini}</div>`;
      return `<tr>
        <td class="f">${foto}</td>
        <td><div class="desc">${esc(i.descricao)}</div><div class="sku">SKU ${esc(i.produto)}${i.brinde ? ' · BRINDE DO COMBO' : ''}</div></td>
        <td class="d">${numeroPdf(i.quantidade, 3)} ${esc(i.unidade)}</td>
        <td class="d">${moedaPdf(i.precoTabela)}</td>
        <td class="d">${i.brinde ? '<b>Desconto total<br>(combo)</b>' : i.descontoPct ? `${numeroPdf(i.descontoPct, 2)}%` : '—'}</td>
        <td class="d">${moedaPdf(i.precoFinal)}</td>
        <td class="d neg">${moedaPdf(i.total)}</td>
      </tr>`;
    })
    .join('');

  const ordem = f.ordemSap ? esc(f.ordemSap.replace(/^0+/, '')) : '';
  return `<section class="folha">
  <div class="topo">
    <div class="emit"><img src="${LOGO_POLE}" alt="Pole">
      <div><div class="nome">${esc(EMPRESA.nome)}</div>
      <div class="sub">${esc(EMPRESA.endereco)}<br>${esc(EMPRESA.cidade)} · CEP ${esc(EMPRESA.cep)}<br>CNPJ ${esc(documentoPdf(EMPRESA.cnpj))}</div></div></div>
    <div class="tit"><div class="t1">CONFIRMAÇÃO DE PEDIDO</div><div class="t2">Documento auxiliar de venda — sem valor fiscal</div>${bonif ? '<div><span class="tag">BONIFICAÇÃO</span></div>' : ''}</div>
    <div class="num"><div class="n1">Pedido nº</div><div class="n2">${esc(d.numero || d.referencia)}</div>
      <div class="n3">${todas > 1 ? `Folha ${idx + 1} de ${todas} · ` : ''}${esc(f.titulo)}</div></div>
  </div>

  <div class="linha" style="margin-top:0">
    ${caixa('Natureza da operação', esc(d.natureza), 'w3')}
    ${caixa('Ordem de venda SAP', ordem ? esc(ordem) : '<span style="font-weight:400">Aguardando confirmação do SAP</span>', 'w2')}
    ${caixa('Emissão', esc(dataHoraPdf(d.emissao)))}
    ${caixa('Previsão de entrega', esc(dataPdf(d.previsao)))}
  </div>
  <div class="linha">
    ${caixa('Situação do pedido', esc(d.situacao), 'w3')}
    ${caixa('Tabela de preços', esc(d.tabelaPrecos), 'w2')}
  </div>

  <div class="sec">Destinatário</div>
  <div class="linha">
    ${caixa('Razão social', esc(d.cliente.razao), 'w4')}
    ${caixa('CNPJ / CPF', esc(d.cliente.documento), 'w2')}
    ${caixa('Cód. cliente', esc(d.cliente.codigo))}
  </div>
  <div class="linha">
    ${caixa('Nome fantasia', esc(d.cliente.fantasia), 'w3')}
    ${caixa('Telefone', esc(d.cliente.telefone), 'w2')}
  </div>
  <div class="linha">
    ${caixa('Endereço de entrega', esc(d.cliente.endereco), 'w4')}
    ${caixa('Município / UF', esc(d.cliente.cidadeUf), 'w2')}
  </div>

  <div class="sec">Vendedor e condições</div>
  <div class="linha">
    ${caixa('Vendedor', esc(d.vendedor.nome) + (d.vendedor.codigo ? ` <span style="font-weight:400">(${esc(d.vendedor.codigo)})</span>` : ''), 'w3')}
    ${caixa('E-mail do vendedor', esc(d.vendedor.email || '—'), 'w3')}
  </div>
  <div class="linha">
    ${caixa('Condição de pagamento', esc(d.pagamento), 'w3')}
    ${caixa('Ordem de compra do cliente', esc(d.ordemCompra || '—'), 'w2')}
  </div>

  <div class="sec">Dados dos produtos — ${esc(f.titulo)}</div>
  <table>
    <thead><tr><th style="width:12mm">Foto</th><th>SKU / Produto</th><th>Quantidade</th><th>Preço tabela (cx)</th><th>Desconto</th><th>Preço c/ desc. (cx)</th><th>Total</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>

  <div class="tot"><table>
    <tr><td>Itens / quantidade</td><td>${f.itens.length} / ${esc(numeroPdf(qtdTotal, 3))}</td></tr>
    ${algumPeso ? `<tr><td>Peso líquido</td><td>${esc(numeroPdf(peso, 2))} kg</td></tr>` : ''}
    ${totTabela > 0 ? `<tr><td>Valor a preço de tabela</td><td>${moedaPdf(totTabela)}</td></tr>` : ''}
    ${descontos > 0 ? `<tr><td>Descontos concedidos</td><td>- ${moedaPdf(descontos)}</td></tr>` : ''}
    <tr class="g"><td>${bonif ? 'Valor de referência' : 'Total desta folha'}</td><td>${moedaPdf(tot)}</td></tr>
    ${todas > 1 ? `<tr><td>Total do pedido (${todas} folhas)</td><td>${moedaPdf(totalPedido)}</td></tr>` : ''}
  </table></div>

  ${semPreco ? `<div class="aviso">${semPreco} item(ns) sem preço de tabela neste aparelho: o valor será definido pelo SAP.</div>` : ''}
  ${d.observacao ? `<div class="aviso"><strong>OBSERVAÇÕES:</strong> ${esc(d.observacao)}</div>` : ''}
  <div class="aviso">${bonif ? 'Bonificação sem cobrança: o valor é apenas de referência. ' : ''}Este documento confirma o registro do pedido e <strong>não é documento fiscal</strong>. Os valores são estimados com a tabela de preços vigente na data do pedido e estão sujeitos à conferência na nota fiscal emitida pelo SAP.${todas > 1 ? ' O pedido foi dividido em ordens de venda separadas (uma folha para cada).' : ''}</div>

  <div class="rod"><span>Gerado em ${esc(dataHoraPdf(d.geradoEm))} · Pedido ${esc(d.numero || d.referencia)}</span><img src="${LOGO_SALESPOLE}" alt="SalesPole"></div>
</section>`;
}

/** HTML completo do documento: uma folha A4 por ordem do SAP (industrializados e revenda). */
export function htmlPedido(d: DocPedido): string {
  const folhas = d.folhas.length ? d.folhas : [{ grupo: 'industrializados' as GrupoPdf, titulo: 'Pedido', ordemSap: null, itens: [] }];
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido ${esc(d.numero || d.referencia)}</title><style>${CSS}</style></head><body>${folhas.map((f, i) => htmlFolha(d, f, i)).join('')}</body></html>`;
}

/** Nome sugerido do arquivo. */
export const nomeArquivoPedido = (d: DocPedido) => `pedido_${d.numero || d.referencia}.pdf`;
