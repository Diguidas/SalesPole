// Regras de incentivo/escopo comuns ao app (app/src/domain) e a API (api/src/pedidos). FONTE UNICA: edite so aqui
// (shared/) e rode `npm run shared` na pasta do app ou da API para copiar. Sem dependencia de tela, banco ou Nest.

/** Classificacao (IDs) do produto no cadastro (dados.classificacao do produto). */
export interface ClassificacaoIds {
  linha_id?: string | null;
  grupo_id?: string | null;
  categoria_id?: string | null;
  marca?: string | null;
}

export interface ContextoComprador {
  codCliente: string;
  codVendedor: string;
  canais: string[];
  escritorios: string[];
  /** listas de preco do cliente (PLTYP) */
  listasPreco?: string[];
  /** equipe do vendedor e tipos de estabelecimento do cliente */
  equipes?: string[];
  tiposEstabelecimento?: string[];
}

// quanto mais especifico o escopo, maior o peso (desempate quando a quantidade minima e igual)
const PESO: Record<string, number> = { cliente: 8, vendedor: 7, equipe: 6, escritorio: 5, lista_preco: 4, tipo_estabelecimento: 3, canal: 2, produto: 1, geral: 0 };

/** Escopo mais especifico vence; lista + grupo de preco ("L.G") vence a lista inteira ("L"). */
export const pesoEscopo = (r: { escopo: string; escopo_valor?: string | null }): number =>
  (PESO[r.escopo] ?? 0) + (r.escopo === 'lista_preco' && (r.escopo_valor ?? '').includes('.') ? 0.5 : 0);

export const CRITERIOS = ['linha_id', 'grupo_id', 'categoria_id', 'marca'] as const;

/** IDs do SAP podem vir com zeros a esquerda (NUMC): '0003' e '3' sao o mesmo ID. A marca e texto (sem diferenciar caixa). */
export const normCriterio = (campo: (typeof CRITERIOS)[number], v: string | null | undefined): string => {
  const t = (v ?? '').trim().toLowerCase();
  return campo === 'marca' ? t : t.replace(/^0+(?=\d)/, '');
};

/** "a, b,c" -> ['a','b','c'] */
export const listaCsv = (v: string | null | undefined): string[] => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** Alvo (O QUE compra) de uma regra de incentivo. */
export interface AlvoDeRegra extends ClassificacaoIds {
  cod_produto: string | null;
}

/** A regra serve para este PRODUTO? (codigo e/ou classificacao; regra sem alvo serve para qualquer produto) */
export function alvoServeProduto(r: AlvoDeRegra, produto: string, cls?: ClassificacaoIds | null): boolean {
  if (r.cod_produto && r.cod_produto !== produto) return false;
  return CRITERIOS.every((c) => !normCriterio(c, r[c]) || normCriterio(c, r[c]) === normCriterio(c, cls?.[c]));
}

/** Quao especifico e o alvo da regra: produto especifico > classificacao (quanto mais criterios, mais especifica) > qualquer produto. */
export function pesoAlvo(r: AlvoDeRegra): number {
  if (r.cod_produto) return 10;
  return CRITERIOS.filter((c) => normCriterio(c, r[c])).length;
}

/** O escopo (QUEM compra) serve para este comprador? O valor do escopo pode ter varios codigos separados por virgula. */
export function escopoServe(escopo: string, escopoValor: string | null | undefined, ctx: ContextoComprador): boolean {
  const valores = listaCsv(escopoValor);
  const algum = (tem: string[]) => valores.some((x) => tem.includes(x));
  switch (escopo) {
    case 'geral':
    case 'produto':
      return true;
    case 'cliente':
      return valores.includes(ctx.codCliente);
    case 'vendedor':
      return valores.includes(ctx.codVendedor);
    case 'canal':
      return algum(ctx.canais);
    case 'escritorio':
      return algum(ctx.escritorios);
    case 'lista_preco':
      return algum(ctx.listasPreco ?? []);
    case 'equipe':
      return algum(ctx.equipes ?? []);
    case 'tipo_estabelecimento':
      return algum(ctx.tiposEstabelecimento ?? []);
    default:
      return false;
  }
}

/** Regra que vale nessa quantidade entre as que ja servem: maior quantidade minima atingida; empate = escopo mais especifico, depois alvo mais especifico. */
export function melhorPorQuantidade<T extends AlvoDeRegra & { escopo: string; escopo_valor?: string | null; qtd_minima: number | string }>(
  servem: T[],
  qtd: number,
): T | null {
  return (
    servem
      .filter((r) => Number(r.qtd_minima) <= qtd)
      .sort((a, b) => Number(b.qtd_minima) - Number(a.qtd_minima) || pesoEscopo(b) - pesoEscopo(a) || pesoAlvo(b) - pesoAlvo(a))[0] ?? null
  );
}
