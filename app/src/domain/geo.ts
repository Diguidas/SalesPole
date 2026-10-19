// Geografia do roteiro de visita (sem dependencias: testavel). Mesma conta do servidor (api/src/visitas).

/** Raio (m) do check-in ate o cliente: fora dele o app so AVISA (a API grava a visita marcada "fora do raio"). */
export const RAIO_VISITA_M = 150;

/** Distancia em metros entre dois pontos (haversine). */
export function distanciaM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
}

/** "85 m", "1,2 km". */
export function textoDistancia(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

export interface AvaliacaoCheckin {
  /** distancia ate o cliente em metros (null = cliente sem coordenada no cadastro) */
  distanciaM: number | null;
  foraDoRaio: boolean;
  semReferencia: boolean;
}

/** Compara a posicao do check-in com a do cliente (cadastro do SAP). */
export function avaliarCheckin(
  posicao: { lat: number; lng: number },
  cliente: { lat: number | null; lng: number | null },
  raioM = RAIO_VISITA_M,
): AvaliacaoCheckin {
  if (cliente.lat === null || cliente.lng === null) return { distanciaM: null, foraDoRaio: false, semReferencia: true };
  const d = distanciaM(posicao.lat, posicao.lng, cliente.lat, cliente.lng);
  return { distanciaM: d, foraDoRaio: d > raioM, semReferencia: false };
}
