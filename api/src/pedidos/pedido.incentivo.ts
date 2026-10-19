// Desconto por incentivo (tabela incentivos_desconto, cadastrada no painel): a partir de uma
// quantidade o produto ganha um desconto, e o vendedor ainda pode dar um extra ate um teto.
// Mesma regra do app (app/src/domain/incentivo.ts): se mudar uma, mude a outra.
//
// A regra tem duas dimensoes:
//   QUEM compra (escopo): geral | cliente | vendedor | canal | escritorio
//   O QUE compra (alvo):  um produto (cod_produto) OU a classificacao do produto (ID da linha, do grupo,
//                         da categoria; marca por texto; varios juntos = todos precisam bater) OU qualquer produto
// Quantidade minima 0 = sem minimo (desconto fixo).

export interface IncentivoRow {
  id: string;
  cod_produto: string | null;
  escopo: string; // geral | produto | cliente | vendedor | canal | escritorio
  escopo_valor: string | null;
  linha_id?: string | null;
  grupo_id?: string | null;
  categoria_id?: string | null;
  marca?: string | null;
  qtd_minima: number;
  desconto_pct: number;
  desconto_extra_max_pct: number;
  vigencia_ini: string | null;
  vigencia_fim: string | null;
  ativo: boolean;
}

/** Classificacao do produto no cadastro (dados.classificacao do produto). */
export interface ClassificacaoSrv {
  linha_id?: string | null;
  grupo_id?: string | null;
  categoria_id?: string | null;
  marca?: string | null;
}

export interface ContextoIncentivo {
  codCliente: string;
  codVendedor: string;
  canais: string[];
  escritorios: string[];
  /** AAAA-MM-DD */
  hoje: string;
}

// quanto mais especifico o escopo, maior o peso (desempate quando a quantidade minima e igual)
const PESO: Record<string, number> = { cliente: 5, vendedor: 4, escritorio: 3, canal: 2, produto: 1, geral: 0 };

const CRITERIOS = ['linha_id', 'grupo_id', 'categoria_id', 'marca'] as const;

/** IDs do SAP podem vir com zeros a esquerda (NUMC): '0003' e '3' sao o mesmo ID. A marca e texto. */
const norm = (campo: (typeof CRITERIOS)[number], v: string | null | undefined): string => {
  const t = (v ?? '').trim().toLowerCase();
  return campo === 'marca' ? t : t.replace(/^0+(?=\d)/, '');
};

function pesoProduto(r: IncentivoRow): number {
  if (r.cod_produto) return 10;
  return CRITERIOS.filter((c) => norm(c, r[c])).length;
}

function vale(r: IncentivoRow, produto: string, ctx: ContextoIncentivo, cls?: ClassificacaoSrv | null): boolean {
  if (!r.ativo) return false;
  if (r.vigencia_ini && r.vigencia_ini > ctx.hoje) return false;
  if (r.vigencia_fim && r.vigencia_fim < ctx.hoje) return false;
  if (r.cod_produto && r.cod_produto !== produto) return false;
  if (!CRITERIOS.every((c) => !norm(c, r[c]) || norm(c, r[c]) === norm(c, cls?.[c]))) return false;
  switch (r.escopo) {
    case 'geral':
    case 'produto':
      return true;
    case 'cliente':
      return r.escopo_valor === ctx.codCliente;
    case 'vendedor':
      return r.escopo_valor === ctx.codVendedor;
    case 'canal':
      return !!r.escopo_valor && ctx.canais.includes(r.escopo_valor);
    case 'escritorio':
      return !!r.escopo_valor && ctx.escritorios.includes(r.escopo_valor);
    default:
      return false;
  }
}

/** Regra que vale para o produto nessa quantidade: maior quantidade minima atingida; empate = escopo mais especifico, depois alvo mais especifico. */
export function incentivoAplicavel(
  rows: IncentivoRow[],
  produto: string,
  qtd: number,
  ctx: ContextoIncentivo,
  cls?: ClassificacaoSrv | null,
): IncentivoRow | null {
  return (
    rows
      .filter((r) => vale(r, produto, ctx, cls) && Number(r.qtd_minima) <= qtd)
      .sort(
        (a, b) =>
          Number(b.qtd_minima) - Number(a.qtd_minima) || (PESO[b.escopo] ?? 0) - (PESO[a.escopo] ?? 0) || pesoProduto(b) - pesoProduto(a),
      )[0] ?? null
  );
}

/** Desconto extra (%) que o incentivo libera alem do maximo da lista: o automatico + o que o vendedor pode acrescentar. */
export function descontoLiberadoPeloIncentivo(r: IncentivoRow | null): number {
  return r ? Number(r.desconto_pct) + Number(r.desconto_extra_max_pct) : 0;
}
