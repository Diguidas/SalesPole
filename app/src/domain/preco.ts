import { arredondar } from './numero';
// Regras de preco: SEM dependencia de tela/banco (testavel em Node: npm run test:dominio).

export type GrupoMaterial = 'FERT' | 'HAWA';

/** FERT vai na org 2100/2002; HAWA e ZVAR vao juntos na org 2014/2015 (mesma regra do SAP). */
export function grupoDoMaterial(mtart: string | null | undefined): GrupoMaterial | null {
  if (mtart === 'FERT') return 'FERT';
  if (mtart === 'HAWA' || mtart === 'ZVAR') return 'HAWA';
  return null;
}

/** Area de vendas do cliente (uma por organizacao). */
export interface AreaCliente {
  vkorg: string;
  tipo_material: string; // FERT | HAWA
  centro: string;
  lista_preco?: { codigo: string } | null;
  rede?: { codigo: string } | null;
}

/** Area do cliente que atende um tipo de material; null = o cliente nao compra esse tipo. */
export function areaDoGrupo(areas: AreaCliente[], grupo: GrupoMaterial | null): AreaCliente | null {
  if (!grupo) return null;
  return areas.find((a) => a.tipo_material === grupo) ?? null;
}

export interface LinhaPreco {
  kbetr: number | null; // valor da condicao
  kpein: number | null; // por quantas unidades (preco por 1, por 10...)
  kmein: string | null; // unidade da condicao (KG, CX...)
  datab: string; // inicio da vigencia AAAA-MM-DD
  datbi: string; // fim da vigencia
  origem: 'grupo' | 'lista';
  /** desconto maximo em % que o vendedor pode dar neste preco (0/ausente = nao pode) */
  descontoMax?: number;
}

/**
 * Preco vigente hoje. Prioridade definida pelo negocio: lista+grupo (A912) vale antes de
 * lista (A913). Dentro de cada um, a vigencia que comecou mais recentemente.
 */
export function escolherPreco(grupos: LinhaPreco[], listas: LinhaPreco[], hoje: string): LinhaPreco | null {
  const vale = (l: LinhaPreco) => l.datab <= hoje && l.datbi >= hoje && l.kbetr !== null && l.kbetr > 0;
  const melhor = (ls: LinhaPreco[]) => ls.filter(vale).sort((a, b) => b.datab.localeCompare(a.datab))[0] ?? null;
  return melhor(grupos) ?? melhor(listas);
}

export interface PrecoUnitario {
  valor: number; // por 1 unidade de `unidade`
  unidade: string | null;
  origem: 'grupo' | 'lista';
  /** desconto maximo em % (so presente quando maior que zero) */
  descontoMax?: number;
}

export function precoUnitario(l: LinhaPreco | null): PrecoUnitario | null {
  if (!l || l.kbetr === null || l.kbetr <= 0) return null;
  const por = l.kpein && l.kpein > 0 ? l.kpein : 1;
  return { valor: l.kbetr / por, unidade: l.kmein, origem: l.origem, ...(l.descontoMax && l.descontoMax > 0 ? { descontoMax: l.descontoMax } : {}) };
}

// ---------------------------------------------------------------------------
// Unidades: o pedido e feito em CAIXA; a lista de precos e o estoque podem estar em KG, UN...
// ---------------------------------------------------------------------------

/**
 * Codigo INTERNO da caixa neste SAP (MARM-MEINH) e o texto que o vendedor le (T006A-MSEH3).
 * O pedido leva o CODIGO (KI); a tela mostra o TEXTO (CX). Usados so quando o catalogo ainda
 * nao trouxe a unidade de venda (dados antigos): o SAP informa a de cada produto.
 */
export const UNIDADE_PEDIDO_PADRAO = 'KI';
export const ROTULO_PADRAO = 'CX';

export interface Conversoes {
  /** unidade base do material (MARA-MEINS), codigo interno */
  base: string | null;
  /** unidades alternativas: quantas unidades BASE cabem em 1 da unidade (MARM UMREZ/UMREN) */
  fatores: Record<string, number>;
  /** texto que o vendedor le de cada codigo de unidade (ex.: KI -> CX) */
  textos: Record<string, string>;
}

/** O que o SAP manda dentro de produtos.dados (campos de unidade podem faltar em dados antigos). */
export interface DadosProduto {
  pedido?: { quantidademinima?: unknown; multiplo?: unknown };
  unidade_base?: string | null;
  unidade_base_texto?: string | null;
  unidade_venda?: string | null;
  unidade_venda_texto?: string | null;
  conversoes?: Array<{ unidade: string; texto?: string | null; fator: number }>;
}

export function lerConversoes(d: DadosProduto): Conversoes {
  const validas = (d.conversoes ?? []).filter((c) => c.unidade && c.fator > 0);
  const textos: Record<string, string> = {};
  for (const c of validas) if (c.texto) textos[c.unidade] = c.texto;
  if (d.unidade_base && d.unidade_base_texto) textos[d.unidade_base] = d.unidade_base_texto;
  if (d.unidade_venda && d.unidade_venda_texto) textos[d.unidade_venda] = d.unidade_venda_texto;
  return { base: d.unidade_base ?? null, fatores: Object.fromEntries(validas.map((c) => [c.unidade, c.fator])), textos };
}

/** Texto de uma unidade para a tela (KI -> CX). Sem texto conhecido, mostra o proprio codigo. */
export function rotuloUnidade(codigo: string | null | undefined, c: Conversoes): string {
  if (!codigo) return 'un';
  return c.textos[codigo] ?? (codigo === UNIDADE_PEDIDO_PADRAO ? ROTULO_PADRAO : codigo);
}

/**
 * Codigo interno de uma unidade dado o codigo OU o texto (o SAP devolve o texto "CX" nos itens de
 * um pedido; o pedido novo precisa do codigo "KI"). Desconhecida: devolve como veio.
 */
export function unidadeInterna(valor: string, c: Conversoes): string {
  if (valor === c.base || c.fatores[valor] !== undefined) return valor;
  return Object.entries(c.textos).find(([, texto]) => texto === valor)?.[0] ?? valor;
}

/** Quantas unidades base ha em 1 `unidade`; null = nao sei converter. */
export function fatorBase(unidade: string | null | undefined, c: Conversoes): number | null {
  if (!unidade) return null;
  if (c.base && unidade === c.base) return 1;
  const f = c.fatores[unidade];
  return f && f > 0 ? f : null;
}

/** Preco por 1 `de` -> preco por 1 `para` (ex.: R$ 12/KG -> R$ 120/CX se 1 CX = 10 KG). null = sem conversao. */
export function converterPreco(valor: number, de: string | null | undefined, para: string, c: Conversoes): number | null {
  if (!de) return null;
  if (de === para) return valor;
  const fDe = fatorBase(de, c);
  const fPara = fatorBase(para, c);
  if (!fDe || !fPara) return null;
  return arredondar((valor / fDe) * fPara, 4);
}

/** Estoque (na unidade base) em unidades de venda; null = sem conversao. */
export function estoqueEmUnidade(quantidadeBase: number, unidade: string, c: Conversoes): number | null {
  const f = fatorBase(unidade, c);
  return f ? quantidadeBase / f : null;
}

export interface PrecoNaUnidade extends PrecoUnitario {
  /** preenchido quando o preco foi CONVERTIDO: o que esta na tabela de precos (ex.: R$ 12/KG) */
  tabela?: { valor: number; unidade: string | null };
}

/**
 * Preco de tabela na unidade do pedido. Se nao ha conversao entre a unidade da tabela e a do
 * pedido, devolve o preco na unidade da tabela (so para referencia: nao entra no total estimado).
 */
export function precoNaUnidade(l: LinhaPreco | null, destino: string, c: Conversoes): PrecoNaUnidade | null {
  const p = precoUnitario(l);
  if (!p) return null;
  if (p.unidade === destino) return p;
  const convertido = converterPreco(p.valor, p.unidade, destino, c);
  if (convertido === null) return p;
  return {
    valor: convertido, unidade: destino, origem: p.origem, tabela: { valor: p.valor, unidade: p.unidade },
    ...(p.descontoMax ? { descontoMax: p.descontoMax } : {}),
  };
}
