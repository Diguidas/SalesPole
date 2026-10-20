import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, definirVendedorAtivo } from './api';
import { useSession } from './auth';

/**
 * Modo equipe: supervisor, gerente, gerente geral e admin usam o MESMO login do painel e, no app, escolhem um vendedor
 * da equipe para operar "como ele" (carteira, pedidos, visitas). O cadastro de quem tem acesso e um so (Usuarios, no painel).
 */

export interface EuEquipe {
  /** true = este login tem modo equipe (papel de supervisor, gerente, gerente geral ou admin no painel) */
  equipe: boolean;
  papel: string;
  nome: string | null;
  permissoes: string[];
  /** codigo do vendedor do proprio login (quem tem os dois acessos) */
  vendedor_proprio: string | null;
}

export interface VendedorEquipe {
  cod_vendedor: string;
  nome: string | null;
  escritorio?: string | null;
  equipe?: string | null;
}

interface EquipeCtx {
  /** lendo o que ficou salvo no aparelho (e perguntando ao servidor): o app espera isso para escolher o banco local */
  carregando: boolean;
  eu: EuEquipe | null;
  usaEquipe: boolean;
  /** vendedor escolhido (null = nenhum: mostra o resumo da equipe) */
  vendedor: { cod: string; nome: string | null } | null;
  /** modo equipe, mas sem vendedor escolhido */
  semVendedor: boolean;
  entrarComo: (v: VendedorEquipe) => void;
  sairDoVendedor: () => void;
  seletorAberto: boolean;
  abrirSeletor: () => void;
  fecharSeletor: () => void;
}

const Ctx = createContext<EquipeCtx | null>(null);

const chaveEu = (userId: string) => `equipe.eu.${userId}`;
const chaveVendedor = (userId: string) => `equipe.vendedor.${userId}`;

export function EquipeProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [carregando, setCarregando] = useState(true);
  const [eu, setEu] = useState<EuEquipe | null>(null);
  const [vendedor, setVendedor] = useState<{ cod: string; nome: string | null } | null>(null);
  const [seletorAberto, setSeletorAberto] = useState(false);

  useEffect(() => {
    let vivo = true;
    if (!userId) {
      definirVendedorAtivo(null);
      setEu(null);
      setVendedor(null);
      setSeletorAberto(false);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    (async () => {
      // 1) o que ficou salvo: o app abre mesmo sem internet
      let euSalvo: EuEquipe | null = null;
      let vendedorSalvo: { cod: string; nome: string | null } | null = null;
      try {
        const [a, b] = await Promise.all([AsyncStorage.getItem(chaveEu(userId)), AsyncStorage.getItem(chaveVendedor(userId))]);
        euSalvo = a ? (JSON.parse(a) as EuEquipe) : null;
        vendedorSalvo = b ? (JSON.parse(b) as { cod: string; nome: string | null }) : null;
      } catch {
        /* armazenamento indisponivel: segue sem o salvo */
      }
      if (!vivo) return;
      definirVendedorAtivo(euSalvo?.equipe ? vendedorSalvo?.cod ?? null : null);
      setEu(euSalvo);
      setVendedor(euSalvo?.equipe ? vendedorSalvo : null);
      setCarregando(false);

      // 2) confirma com o servidor (papel pode ter mudado no painel)
      try {
        const novo = await api<EuEquipe>('/equipe/eu', { semVendedor: true, timeoutMs: 20_000 });
        if (!vivo) return;
        setEu(novo);
        AsyncStorage.setItem(chaveEu(userId), JSON.stringify(novo)).catch(() => undefined);
        if (!novo.equipe) {
          definirVendedorAtivo(null);
          setVendedor(null);
          AsyncStorage.removeItem(chaveVendedor(userId)).catch(() => undefined);
        }
      } catch {
        /* sem internet ou sem acesso ao painel: vale o que ja estava */
      }
    })();
    return () => {
      vivo = false;
    };
  }, [userId]);

  const entrarComo = useCallback(
    (v: VendedorEquipe) => {
      const escolhido = { cod: v.cod_vendedor, nome: v.nome };
      definirVendedorAtivo(escolhido.cod); // antes de qualquer tela chamar a API
      setVendedor(escolhido);
      setSeletorAberto(false);
      if (userId) AsyncStorage.setItem(chaveVendedor(userId), JSON.stringify(escolhido)).catch(() => undefined);
    },
    [userId],
  );

  const sairDoVendedor = useCallback(() => {
    definirVendedorAtivo(null);
    setVendedor(null);
    if (userId) AsyncStorage.removeItem(chaveVendedor(userId)).catch(() => undefined);
  }, [userId]);

  const usaEquipe = !!eu?.equipe;
  const valor = useMemo<EquipeCtx>(
    () => ({
      carregando, eu, usaEquipe, vendedor, semVendedor: usaEquipe && !vendedor,
      entrarComo, sairDoVendedor, seletorAberto,
      abrirSeletor: () => setSeletorAberto(true),
      fecharSeletor: () => setSeletorAberto(false),
    }),
    [carregando, eu, usaEquipe, vendedor, entrarComo, sairDoVendedor, seletorAberto],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useEquipe(): EquipeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useEquipe fora do EquipeProvider');
  return c;
}
