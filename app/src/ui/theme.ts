import { StyleSheet } from 'react-native';

// Cores do logo SalesPole: laranja, magenta e amarelo.
const clara = {
  primaria: '#F26A00',
  primariaEscura: '#C85500',
  primariaFundo: '#FFF1E5',
  acento: '#D6005B',
  amarelo: '#FFB400',

  fundo: '#F7F4F1',
  card: '#FFFFFF',
  borda: '#E7E2DC',

  texto: '#1F2430',
  textoSuave: '#6B7280',
  textoSobrePrimaria: '#FFFFFF',

  ok: '#1E9E5A',
  okFundo: '#E4F5EC',
  aviso: '#A85F00',
  avisoFundo: '#FFF1D6',
  erro: '#C62828',
  erroFundo: '#FDE7E7',
  neutroFundo: '#EEEAE5',
};

export type Paleta = Record<keyof typeof clara, string>;

const escura: Paleta = {
  primaria: '#F26A00',
  primariaEscura: '#FF8A3D',
  primariaFundo: '#3A2415',
  acento: '#F0488C',
  amarelo: '#FFB400',

  fundo: '#14171F',
  card: '#1E232E',
  borda: '#323948',

  texto: '#ECEFF5',
  textoSuave: '#9AA3B5',
  textoSobrePrimaria: '#FFFFFF',

  ok: '#3DD08A',
  okFundo: '#16342A',
  aviso: '#FFB84D',
  avisoFundo: '#3A2F14',
  erro: '#FF7A7A',
  erroFundo: '#3E1D1F',
  neutroFundo: '#2A303D',
};

export type NomeTema = 'claro' | 'escuro';

/**
 * Paleta ativa. E um objeto unico e mutavel: trocar o tema copia os valores para ca e o app
 * e remontado (ver TemaProvider), entao tudo que le `cor.x` no render ja pega a cor nova.
 */
export const cor: Paleta = { ...clara };

let versao = 0;
export function aplicarPaleta(nome: NomeTema) {
  Object.assign(cor, nome === 'escuro' ? escura : clara);
  versao++;
}

/**
 * StyleSheet que depende de `cor`: refeito sob demanda quando o tema muda.
 * Uso: `const estilos = estilosTema(() => StyleSheet.create({ ... }))`.
 */
export function estilosTema<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(fabrica: () => T): T {
  let cache: T | null = null;
  let deVersao = -1;
  const atual = () => {
    if (!cache || deVersao !== versao) {
      cache = fabrica();
      deVersao = versao;
    }
    return cache;
  };
  return new Proxy({} as T, { get: (_, chave) => (atual() as any)[chave] });
}

export const raio = 14;
export const espaco = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
