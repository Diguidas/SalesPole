import * as Location from 'expo-location';

export interface Posicao {
  lat: number;
  lng: number;
  /** precisao do GPS em metros (null = nao informada) */
  precisaoM: number | null;
  /** o Android avisou que a posicao e simulada (app de GPS falso) */
  falsa: boolean;
}

const TEMPO_MAX_MS = 20_000;

/**
 * Posicao atual (GPS de alta precisao), so com o app aberto. O check-in da visita SEMPRE precisa dela:
 * lanca Error com mensagem amigavel se a permissao for negada ou o GPS nao responder a tempo.
 */
export async function obterPosicao(): Promise<Posicao> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new Error('Permita o uso da localização nas configurações do aparelho para iniciar a visita.');

  const leitura = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const limite = new Promise<never>((_, rejeita) => setTimeout(() => rejeita(new Error('timeout')), TEMPO_MAX_MS));
  try {
    const l = await Promise.race([leitura, limite]);
    return {
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      precisaoM: l.coords.accuracy ?? null,
      falsa: l.mocked === true,
    };
  } catch {
    throw new Error('Não consegui pegar o GPS. Vá para um local aberto, confira se a localização está ligada e tente de novo.');
  }
}
