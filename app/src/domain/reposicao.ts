// Reposicao: produtos que o cliente costuma comprar num ritmo e que ja passaram da hora.
//
// Ritmo = janela de 12 meses / numero de pedidos com o produto (o aparelho so guarda esses totais por cliente e produto).
// O produto entra na lista quando passou FATOR_ATRASO x o ritmo desde a ultima compra (30% de folga: ninguem compra
// no dia exato), e sai quando passou muito do ritmo (aí e produto que o cliente deixou de comprar: e o caso de "Sem giro").
// So vale para quem comprou ao menos MIN_COMPRAS vezes: com menos nao da para falar em ritmo.

export const JANELA_DIAS = 365;
export const FATOR_ATRASO = 1.3;
export const FATOR_ABANDONO = 5;
export const MIN_COMPRAS = 3;

export interface CompraDoCliente {
  cod_produto: string;
  descricao: string;
  /** AAAA-MM-DD */
  ultima_compra: string;
  pedidos: number;
  quantidade: number;
  unidade: string | null;
}

export interface SugestaoReposicao {
  cod_produto: string;
  descricao: string;
  /** de quantos em quantos dias o cliente costuma comprar */
  intervaloDias: number;
  /** ha quantos dias comprou pela ultima vez */
  diasDesde: number;
  /** quantas caixas costuma levar por pedido (media), na unidade do historico */
  quantidadeTipica: number;
  unidade: string | null;
  /** quanto passou do ritmo: 1,5 = 50% alem do intervalo */
  atraso: number;
}

/** Dias entre duas datas AAAA-MM-DD (b - a). */
export function diasEntre(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

export function sugerirReposicao(
  compras: CompraDoCliente[],
  hoje: string,
  opcoes: { fator?: number; minCompras?: number; max?: number } = {},
): SugestaoReposicao[] {
  const fator = opcoes.fator ?? FATOR_ATRASO;
  const minCompras = opcoes.minCompras ?? MIN_COMPRAS;
  const lista: SugestaoReposicao[] = [];
  for (const c of compras) {
    if (!c.ultima_compra || c.pedidos < minCompras) continue;
    const intervalo = Math.max(1, Math.round(JANELA_DIAS / c.pedidos));
    const diasDesde = diasEntre(c.ultima_compra, hoje);
    if (diasDesde < intervalo * fator || diasDesde > intervalo * FATOR_ABANDONO) continue;
    lista.push({
      cod_produto: c.cod_produto,
      descricao: c.descricao,
      intervaloDias: intervalo,
      diasDesde,
      quantidadeTipica: c.quantidade > 0 ? c.quantidade / c.pedidos : 0,
      unidade: c.unidade,
      atraso: Math.round((diasDesde / intervalo) * 100) / 100,
    });
  }
  // o mais atrasado primeiro; empate: o que compra com mais frequencia
  lista.sort((a, b) => b.atraso - a.atraso || a.intervaloDias - b.intervaloDias);
  return opcoes.max ? lista.slice(0, opcoes.max) : lista;
}

/** Quantidade a sugerir em caixas: a tipica do cliente, respeitando minimo e multiplo do produto (pelo menos 1 multiplo). */
export function quantidadeSugerida(tipica: number, regra: { minimo?: number | null; multiplo?: number | null }): number {
  const mult = regra.multiplo && regra.multiplo > 0 ? regra.multiplo : 1;
  const min = regra.minimo && regra.minimo > 0 ? regra.minimo : mult;
  const base = tipica > 0 ? tipica : min;
  const emMultiplos = Math.max(1, Math.round(base / mult)) * mult;
  return Math.round(Math.max(min, emMultiplos) * 1000) / 1000;
}
