import { createHash } from 'node:crypto';

export interface ItemEntrada {
  produto: string;
  unidade: string;
  quantidade: string;
  preco: string | null;
}

export interface PedidoEntrada {
  id: string;
  criadoNoAppEm: string;
  codCliente: string;
  dtEntrega: string | null;
  condPagamento: string | null;
  ordemCompraCliente: string | null;
  enderecoEntrega: string | null;
  observacao: string | null;
  duplicadoDe: string | null;
  itens: ItemEntrada[];
}

export type ResultadoValidacao =
  | { ok: true; pedido: PedidoEntrada }
  | { ok: false; id: string | null; erros: string[] };

export const MAX_ITENS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const texto = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Numero decimal positivo com no maximo `casas` casas; devolve string canonica ("10.5") ou null. */
function decimal(v: unknown, casas: number, max: number): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!(n > 0) || n > max) return null;
  const dec = s.split('.')[1]?.replace(/0+$/, '') ?? '';
  if (dec.length > casas) return null;
  return dec ? `${Math.trunc(n)}.${dec}` : String(Math.trunc(n));
}

/** Valida e normaliza UM pedido vindo do app (snake_case). Nunca lanca. */
export function validarPedido(raw: unknown): ResultadoValidacao {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const erros: string[] = [];
  const id = typeof r.id === 'string' ? r.id.trim().toLowerCase() : '';

  if (!UUID.test(id)) erros.push('id deve ser um UUID');

  const criado = typeof r.criado_no_app_em === 'string' ? Date.parse(r.criado_no_app_em) : NaN;
  if (Number.isNaN(criado)) erros.push('criado_no_app_em deve ser uma data/hora ISO');
  else if (criado > Date.now() + 10 * 60_000) erros.push('criado_no_app_em esta no futuro');

  const codCliente = texto(r.cod_cliente, 10);
  if (!codCliente || !/^\d+$/.test(codCliente)) erros.push('cod_cliente invalido');

  const dtEntrega = texto(r.dt_entrega, 10);
  if (dtEntrega && !DATA_ISO.test(dtEntrega)) erros.push('dt_entrega deve ser AAAA-MM-DD');

  const duplicadoDe = texto(r.duplicado_de, 36)?.toLowerCase() ?? null;
  if (duplicadoDe && !UUID.test(duplicadoDe)) erros.push('duplicado_de deve ser um UUID');

  const itensRaw = Array.isArray(r.itens) ? r.itens : [];
  if (itensRaw.length < 1 || itensRaw.length > MAX_ITENS) erros.push(`itens deve ter de 1 a ${MAX_ITENS} itens`);

  const itens: ItemEntrada[] = [];
  itensRaw.slice(0, MAX_ITENS).forEach((it, i) => {
    const x = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    const produto = texto(x.produto, 18);
    const unidade = texto(x.unidade, 3)?.toUpperCase() ?? null;
    const quantidade = decimal(x.quantidade, 3, 1_000_000);
    const preco = x.preco === undefined || x.preco === null || x.preco === '' ? null : decimal(x.preco, 4, 10_000_000);

    if (!produto || !/^[\w.-]+$/.test(produto)) erros.push(`itens[${i}].produto invalido`);
    if (!unidade || !/^[A-Z0-9]+$/.test(unidade)) erros.push(`itens[${i}].unidade invalida`);
    if (!quantidade) erros.push(`itens[${i}].quantidade deve ser > 0 (ate 3 casas)`);
    if (x.preco !== undefined && x.preco !== null && x.preco !== '' && !preco) erros.push(`itens[${i}].preco invalido`);

    if (produto && unidade && quantidade) itens.push({ produto, unidade, quantidade, preco });
  });

  if (erros.length) return { ok: false, id: UUID.test(id) ? id : null, erros };

  return {
    ok: true,
    pedido: {
      id,
      criadoNoAppEm: new Date(criado).toISOString(),
      codCliente: codCliente!,
      dtEntrega,
      condPagamento: texto(r.cond_pagamento, 4),
      ordemCompraCliente: texto(r.ordem_compra_cliente, 35),
      enderecoEntrega: texto(r.endereco_entrega, 300),
      observacao: texto(r.observacao, 300),
      duplicadoDe,
      itens,
    },
  };
}

/** Impressao digital do pedido (cliente + itens), usada para detectar duplicidade. */
export function hashItens(codCliente: string, itens: ItemEntrada[]): string {
  const linhas = itens
    .map((i) => `${i.produto}:${i.unidade}:${i.quantidade}:${i.preco ?? ''}`)
    .sort();
  return createHash('sha1').update(`${codCliente}|${linhas.join('|')}`).digest('hex');
}
