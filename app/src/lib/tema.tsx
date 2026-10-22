import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { aplicarPaleta, cor, type NomeTema } from '@/ui/theme';

export type Preferencia = 'auto' | 'claro' | 'escuro';

interface Ctx {
  preferencia: Preferencia;
  tema: NomeTema;
  definir: (p: Preferencia) => void;
}

const TemaCtx = createContext<Ctx>({ preferencia: 'auto', tema: 'claro', definir: () => undefined });
export const useTema = () => useContext(TemaCtx);

const CHAVE = 'tema';

/**
 * Tema claro/escuro (ou automatico, seguindo o sistema). Ao trocar, a paleta global `cor` e
 * atualizada ANTES de remontar a arvore (key), entao todas as telas leem as cores novas.
 */
export function TemaProvider({ children }: { children: ReactNode }) {
  const sistema = useColorScheme();
  const [preferencia, setPreferencia] = useState<Preferencia>('auto');

  useEffect(() => {
    AsyncStorage.getItem(CHAVE)
      .then((v) => { if (v === 'claro' || v === 'escuro' || v === 'auto') setPreferencia(v); })
      .catch(() => undefined);
  }, []);

  const tema: NomeTema = preferencia === 'auto' ? (sistema === 'dark' ? 'escuro' : 'claro') : preferencia;
  aplicarPaleta(tema); // sincrono, no render: os filhos ja nascem com a paleta certa

  const definir = useCallback((p: Preferencia) => {
    setPreferencia(p);
    AsyncStorage.setItem(CHAVE, p).catch(() => undefined);
  }, []);

  const valor = useMemo(() => ({ preferencia, tema, definir }), [preferencia, tema, definir]);
  const base = tema === 'escuro' ? DarkTheme : DefaultTheme;
  const navegacao = {
    ...base,
    colors: { ...base.colors, primary: cor.primaria, background: cor.fundo, card: cor.card, text: cor.texto, border: cor.borda },
  };

  return (
    <TemaCtx.Provider value={valor}>
      <ThemeProvider value={navegacao}>
        <Fragment key={tema}>{children}</Fragment>
      </ThemeProvider>
    </TemaCtx.Provider>
  );
}

