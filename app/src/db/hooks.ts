import { useFocusEffect } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { useSync } from '@/lib/sync-context';

/**
 * Le dados do SQLite local e re-le quando (a) as dependencias mudam ou (b) um
 * sincronismo altera o banco. Nunca toca na rede.
 */
export function useDados<T>(consulta: (db: SQLiteDatabase) => Promise<T>, deps: unknown[] = []) {
  const db = useSQLiteContext();
  const { versao } = useSync();
  const [dados, setDados] = useState<T | undefined>(undefined);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    consulta(db)
      .then((r) => {
        if (!vivo) return;
        setDados(r);
        setCarregando(false);
      })
      .catch(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
    // `consulta` e recriada a cada render de proposito: quem controla e `deps` + `versao`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, versao, ...deps]);

  return { dados, carregando };
}

/** Numero que muda toda vez que a tela volta a ficar em foco (ex.: ao voltar da tela de produtos). */
export function useTickAoFocar(): number {
  const [tick, setTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setTick((t) => t + 1);
    }, []),
  );
  return tick;
}
