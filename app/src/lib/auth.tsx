import type { Session } from '@supabase/supabase-js';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';

interface SessaoCtx {
  session: Session | null;
  /** true enquanto le a sessao salva no aparelho (primeira abertura) */
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<string | null>; // devolve mensagem de erro ou null
  sair: () => Promise<void>;
}

const Ctx = createContext<SessaoCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCarregando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => setSession(s));

    // renovacao do token so enquanto o app esta em primeiro plano (recomendacao do supabase-js no RN)
    const estado = AppState.addEventListener('change', (s) => {
      if (s === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    supabase.auth.startAutoRefresh();

    return () => {
      sub.subscription.unsubscribe();
      estado.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  const entrar = useCallback(async (email: string, senha: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha });
    if (!error) return null;
    if (/invalid login credentials/i.test(error.message)) return 'E-mail ou senha incorretos.';
    if (/network|fetch/i.test(error.message)) return 'Sem conexão. Verifique a internet e tente de novo.';
    return error.message;
  }, []);

  const sair = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const valor = useMemo(() => ({ session, carregando, entrar, sair }), [session, carregando, entrar, sair]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSession(): SessaoCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession fora do SessionProvider');
  return c;
}
