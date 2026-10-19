// Validacao e regras puras do roteiro de visita (sem banco): facil de testar.

export const BUCKET_FOTOS = 'visitas-fotos';

/** Raio (m) do check-in ate o cliente; fora dele a visita so e marcada, nao bloqueada. VISITA_RAIO_M, padrao 150. */
export function raioVisitaM(): number {
  const n = Number(process.env.VISITA_RAIO_M);
  return Number.isFinite(n) && n > 0 ? n : 150;
}

/** Dias que a FOTO fica guardada (o registro e a validacao da visita ficam para sempre). FOTO_VISITA_DIAS, padrao 30. */
export function diasDeFoto(): number {
  const n = Number(process.env.FOTO_VISITA_DIAS);
  return Number.isInteger(n) && n > 0 ? n : 30;
}

export const MAX_FOTOS_POR_VISITA = 6;
export const MAX_BYTES_FOTO = 3_000_000;

/** Distancia em metros entre dois pontos (haversine). */
export function distanciaM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
}

export interface VisitaEntrada {
  id: string;
  codCliente: string;
  dataVisita: string;
  checkinEm: string;
  checkinLat: number;
  checkinLng: number;
  checkinPrecisaoM: number | null;
  gpsFalso: boolean;
  /** so quando a visita foi concluida no aparelho */
  checkout: { em: string; resultado: 'vendeu' | 'nao_vendeu'; motivo: string | null; pedidoId: string | null } | null;
  observacao: string | null;
}

export type ResultadoValidacaoVisita = { ok: true; visita: VisitaEntrada } | { ok: false; id: string | null; erros: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const texto = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const instante = (v: unknown): number => (typeof v === 'string' ? Date.parse(v) : NaN);

/** Valida e normaliza UMA visita vinda do app (snake_case). Nunca lanca. */
export function validarVisita(raw: unknown): ResultadoValidacaoVisita {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const erros: string[] = [];
  const id = typeof r.id === 'string' ? r.id.trim().toLowerCase() : '';
  if (!UUID.test(id)) erros.push('id deve ser um UUID');

  const codCliente = texto(r.cod_cliente, 10);
  if (!codCliente || !/^\d+$/.test(codCliente)) erros.push('cod_cliente invalido');

  const dataVisita = texto(r.data_visita, 10);
  if (!dataVisita || !DATA_ISO.test(dataVisita)) erros.push('data_visita deve ser AAAA-MM-DD');

  const checkin = instante(r.checkin_em);
  if (Number.isNaN(checkin)) erros.push('checkin_em deve ser uma data/hora ISO');
  else if (checkin > Date.now() + 10 * 60_000) erros.push('checkin_em esta no futuro');

  const lat = numero(r.checkin_lat);
  const lng = numero(r.checkin_lng);
  if (lat === null || lat < -90 || lat > 90) erros.push('checkin_lat obrigatorio (GPS) entre -90 e 90');
  if (lng === null || lng < -180 || lng > 180) erros.push('checkin_lng obrigatorio (GPS) entre -180 e 180');

  const precisao = numero(r.checkin_precisao_m);
  if (precisao !== null && (precisao < 0 || precisao > 100_000)) erros.push('checkin_precisao_m invalida');

  // conclusao da visita
  let checkout: VisitaEntrada['checkout'] = null;
  const temCheckout = r.checkout_em !== undefined && r.checkout_em !== null && r.checkout_em !== '';
  const temResultado = r.resultado !== undefined && r.resultado !== null && r.resultado !== '';
  if (temCheckout || temResultado) {
    const co = instante(r.checkout_em);
    if (Number.isNaN(co)) erros.push('checkout_em deve ser uma data/hora ISO');
    else if (co > Date.now() + 10 * 60_000) erros.push('checkout_em esta no futuro');
    else if (!Number.isNaN(checkin) && co < checkin) erros.push('checkout_em antes do check-in');

    const resultado = r.resultado === 'vendeu' || r.resultado === 'nao_vendeu' ? r.resultado : null;
    if (!resultado) erros.push("resultado deve ser 'vendeu' ou 'nao_vendeu'");

    const motivo = texto(r.motivo_nao_venda, 500);
    if (resultado === 'nao_vendeu' && (!motivo || motivo.length < 3)) erros.push('motivo_nao_venda obrigatorio quando nao vendeu (minimo 3 caracteres)');

    const pedidoId = texto(r.pedido_id, 36)?.toLowerCase() ?? null;
    if (pedidoId && !UUID.test(pedidoId)) erros.push('pedido_id deve ser um UUID');
    if (resultado === 'vendeu' && !pedidoId) erros.push('pedido_id obrigatorio quando vendeu');

    if (!erros.length && resultado) {
      checkout = { em: new Date(co).toISOString(), resultado, motivo: resultado === 'nao_vendeu' ? motivo : null, pedidoId: resultado === 'vendeu' ? pedidoId : null };
    }
  }

  if (erros.length) return { ok: false, id: UUID.test(id) ? id : null, erros };

  return {
    ok: true,
    visita: {
      id,
      codCliente: codCliente!,
      dataVisita: dataVisita!,
      checkinEm: new Date(checkin).toISOString(),
      checkinLat: lat!,
      checkinLng: lng!,
      checkinPrecisaoM: precisao,
      gpsFalso: r.gps_falso === true || r.gps_falso === 'true' || r.gps_falso === 1,
      checkout,
      observacao: texto(r.observacao, 500),
    },
  };
}

export interface FotoEntrada {
  id: string;
  visitaId: string;
  tipo: 'fachada' | 'outra';
  tiradaEm: string;
  lat: number | null;
  lng: number | null;
  tamanhoBytes: number | null;
}

export type ResultadoValidacaoFoto = { ok: true; foto: FotoEntrada } | { ok: false; erros: string[] };

export function validarFoto(raw: unknown): ResultadoValidacaoFoto {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const erros: string[] = [];
  const id = typeof r.id === 'string' ? r.id.trim().toLowerCase() : '';
  const visitaId = typeof r.visita_id === 'string' ? r.visita_id.trim().toLowerCase() : '';
  if (!UUID.test(id)) erros.push('id deve ser um UUID');
  if (!UUID.test(visitaId)) erros.push('visita_id deve ser um UUID');

  const tipo = r.tipo === 'outra' ? 'outra' : r.tipo === 'fachada' || r.tipo === undefined ? 'fachada' : null;
  if (!tipo) erros.push("tipo deve ser 'fachada' ou 'outra'");

  const tirada = instante(r.tirada_em);
  if (Number.isNaN(tirada)) erros.push('tirada_em deve ser uma data/hora ISO');

  const lat = numero(r.lat);
  const lng = numero(r.lng);
  if ((lat !== null && (lat < -90 || lat > 90)) || (lng !== null && (lng < -180 || lng > 180))) erros.push('lat/lng invalidos');

  const tamanho = numero(r.tamanho_bytes);
  if (tamanho !== null && (tamanho < 0 || tamanho > MAX_BYTES_FOTO)) erros.push(`foto acima de ${MAX_BYTES_FOTO} bytes`);

  if (erros.length) return { ok: false, erros };
  return {
    ok: true,
    foto: { id, visitaId, tipo: tipo!, tiradaEm: new Date(tirada).toISOString(), lat, lng, tamanhoBytes: tamanho === null ? null : Math.round(tamanho) },
  };
}
