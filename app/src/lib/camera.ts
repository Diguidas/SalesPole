import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export interface FotoCapturada {
  /** arquivo na pasta do app (o sistema nao limpa); sai daqui depois de enviada */
  uri: string;
  tamanhoBytes: number | null;
}

/** Largura maxima da foto enviada: menor que isso e ruim para validar a fachada; maior so pesa no 3G. */
const LARGURA_MAX = 1280;
const QUALIDADE_JPEG = 0.7;

/**
 * Abre a CAMERA (nao a galeria: a foto e o comprovante da visita), reduz para ~1280 px em JPEG e guarda
 * no armazenamento do app. Devolve null se o vendedor cancelar. Lanca Error com mensagem amigavel
 * se a permissao da camera for negada.
 */
export async function tirarFoto(): Promise<FotoCapturada | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Permita o uso da câmera nas configurações do aparelho para fotografar a visita.');

  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: false });
  if (r.canceled || !r.assets?.length) return null;

  const reduzida = await manipulateAsync(r.assets[0].uri, [{ resize: { width: LARGURA_MAX } }], {
    compress: QUALIDADE_JPEG,
    format: SaveFormat.JPEG,
  });

  const pasta = new Directory(Paths.document, 'visitas');
  if (!pasta.exists) pasta.create();
  const destino = new File(pasta, `${Crypto.randomUUID()}.jpg`);
  new File(reduzida.uri).copy(destino);
  return { uri: destino.uri, tamanhoBytes: destino.size };
}

/** Conteudo da foto para subir no Storage. */
export function lerFoto(uri: string): Promise<ArrayBuffer> {
  return new File(uri).arrayBuffer();
}

/** Apaga o arquivo local (depois de enviado). Nunca lanca. */
export function apagarFoto(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* arquivo ja sumiu: sem problema */
  }
}
