import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, ErroApi } from './api';
import { supabase } from './supabase';

export type Papel = 'admin' | 'aprovador' | 'consulta' | 'supervisor' | 'gerente' | 'gerente_geral' | 'vendedor';

/** Hierarquia comercial: ve so a propria equipe (gerente geral ve tudo) e nao acessa Cadastros nem Sistema. */
export const ehHierarquia = (p?: Papel) => p === 'supervisor' || p === 'gerente' || p === 'gerente_geral';
/** Vendedor: usa o painel no computador, so com a propria carteira (Hoje, pedidos, clientes, carteira parada, titulos). */
export const ehVendedor = (p?: Papel) => p === 'vendedor';
/** Aprova bonificacao, valida visita, cancela e cria pedido (dentro do escopo, no caso da hierarquia). */
export const podeAprovar = (p?: Papel) => p === 'admin' || p === 'aprovador' || ehHierarquia(p);
/** Acao liberada para o usuario (padrao do papel + ajustes do admin; administrador tem todas). */
export const tem = (u: { papel: Papel; permissoes?: string[] } | null | undefined, chave: string) => u?.papel === 'admin' || (u?.permissoes ?? []).includes(chave);

export interface UsuarioPainel {
  email: string;
  nome: string | null;
  papel: Papel;
  cod_sap?: string | null;
  permissoes?: string[];
}

interface Ctx {
  carregando: boolean;
  sessao: Session | null;
  usuario: UsuarioPainel | null;
  erro: string | null;
  sair: () => Promise<void>;
}

const AuthCtx = createContext<Ctx>({ carregando: true, sessao: null, usuario: null, erro: null, sair: async () => {} });
export const useAuth = () => useContext(AuthCtx);

export async function entrar(email: string, senha: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<UsuarioPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      if (!data.session) setCarregando(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => {
      setSessao(s);
      if (!s) {
        setUsuario(null);
        setCarregando(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // logou na Microsoft: a API diz se esse e-mail tem acesso ao painel
  const token = sessao?.access_token;
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    setCarregando(true);
    api<UsuarioPainel>('/painel/eu')
      .then((u) => {
        if (!vivo) return;
        setUsuario(u);
        setErro(null);
      })
      .catch((e) => {
        if (!vivo) return;
        setUsuario(null);
        setErro(e instanceof ErroApi && e.status === 403 ? (/sem acesso ao painel/i.test(e.message) ? 'Seu e-mail nao tem acesso ao painel. Peca a um administrador.' : e.message) : (e as Error).message);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  const sair = async () => {
    await supabase.auth.signOut();
    setUsuario(null);
  };

  return <AuthCtx.Provider value={{ carregando, sessao, usuario, erro, sair }}>{children}</AuthCtx.Provider>;
}
