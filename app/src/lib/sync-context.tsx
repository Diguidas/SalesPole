import NetInfo from '@react-native-community/netinfo';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import {
  createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { AppState } from 'react-native';
import { enviarPendentes } from '@/db/push';
import { enviarVisitas } from '@/db/visitasPush';
import { executarPull, gravarMeta, lerMeta, limparBancoLocal } from '@/db/sync';
import { api, ApiError } from './api';
import { useSession } from './auth';

interface SyncCtx {
  sincronizando: boolean;
  /** ISO do ultimo pull bem-sucedido (null = nunca) */
  ultimoSync: string | null;
  erro: string | null;
  /** incrementa a cada mudanca nos dados locais; as telas re-leem o SQLite quando muda */
  versao: number;
  sincronizar: () => Promise<void>;
  /** So envia os pedidos pendentes (rapido; sem baixar a carteira de novo). Devolve mensagem de erro ou null. */
  enviarPedidos: () => Promise<string | null>;
}

const Ctx = createContext<SyncCtx | null>(null);

const SYNC_AUTOMATICO_APOS_MS = 10 * 60_000; // ao abrir/voltar ao app, sincroniza se estiver mais velho que isso

/**
 * `ativo = false` (supervisor/gerente sem vendedor escolhido): nao ha carteira para sincronizar, entao nada sobe nem desce.
 */
export function SyncProvider({ children, ativo = true }: { children: ReactNode; ativo?: boolean }) {
  const db = useSQLiteContext();
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [sincronizando, setSincronizando] = useState(false);
  const [ultimoSync, setUltimoSync] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const emAndamento = useRef(false);
  const ultimoSyncRef = useRef<string | null>(null);

  const sincronizar = useCallback(async () => {
    if (!ativo || emAndamento.current) return;
    emAndamento.current = true;
    setSincronizando(true);
    try {
      const rede = await NetInfo.fetch();
      if (rede.isConnected === false) {
        setErro('Sem conexão. Os dados mostrados são do último sincronismo.');
        return;
      }
      // 1) envia os pedidos pendentes (o servidor devolve o codigo definitivo);
      // 2) pede ao servidor para buscar no SAP o que mudou (pedidos, titulos, remessas, estoque);
      // 3) baixa as novidades. Sem o passo 2 o app so enxerga o que o job automatico (seg-sab, 6h-21h) ja trouxe.
      await enviarPendentes(db);
      // visitas (check-in/check-out) e fotos: o que nao subir fica pendente e tenta de novo na proxima vez
      await enviarVisitas(db).catch(() => undefined);
      const aviso = await atualizarDoSap();
      await executarPull(db);
      const agora = (await lerMeta(db, 'ultimo_sync')) ?? new Date().toISOString();
      ultimoSyncRef.current = agora;
      setUltimoSync(agora);
      setErro(aviso);
      setVersao((v) => v + 1);
    } catch (e) {
      setErro(e instanceof ApiError || e instanceof Error ? e.message : 'Falha ao sincronizar.');
    } finally {
      emAndamento.current = false;
      setSincronizando(false);
    }
  }, [db, ativo]);

  const enviarPedidos = useCallback(async (): Promise<string | null> => {
    if (!ativo || emAndamento.current) return null; // um sincronismo ja esta enviando
    emAndamento.current = true;
    try {
      const rede = await NetInfo.fetch();
      if (rede.isConnected === false) return 'Sem conexão: o pedido ficou salvo e será enviado quando a internet voltar.';
      await enviarPendentes(db);
      return null;
    } catch (e) {
      return `${e instanceof Error ? e.message : 'Falha ao enviar.'} O pedido ficou salvo e será enviado no próximo sincronismo.`;
    } finally {
      emAndamento.current = false;
      setVersao((v) => v + 1);
    }
  }, [db, ativo]);

  // Login: se mudou o usuario neste aparelho, apaga os dados do anterior antes de qualquer coisa.
  useEffect(() => {
    if (!userId || !ativo) return;
    let vivo = true;
    (async () => {
      await prepararUsuario(db, userId);
      if (!vivo) return;
      const ultimo = await lerMeta(db, 'ultimo_sync');
      ultimoSyncRef.current = ultimo;
      setUltimoSync(ultimo);
      setVersao((v) => v + 1);
      if (!ultimo || Date.now() - Date.parse(ultimo) > SYNC_AUTOMATICO_APOS_MS) sincronizar();
    })();
    return () => {
      vivo = false;
    };
  }, [db, userId, ativo, sincronizar]);

  // Voltou ao app ou a rede: sincroniza se os dados estiverem velhos.
  useEffect(() => {
    if (!userId || !ativo) return;
    const velho = () =>
      !ultimoSyncRef.current || Date.now() - Date.parse(ultimoSyncRef.current) > SYNC_AUTOMATICO_APOS_MS;

    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active' && velho()) sincronizar();
    });
    let estavaOffline = false;
    const rede = NetInfo.addEventListener((s) => {
      if (s.isConnected === false) estavaOffline = true;
      else if (estavaOffline) {
        estavaOffline = false;
        sincronizar();
      }
    });
    return () => {
      app.remove();
      rede();
    };
  }, [userId, ativo, sincronizar]);

  const valor = useMemo(
    () => ({ sincronizando, ultimoSync, erro, versao, sincronizar, enviarPedidos }),
    [sincronizando, ultimoSync, erro, versao, sincronizar, enviarPedidos],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/**
 * Pede ao servidor para sincronizar com o SAP agora (POST /sync/refresh; no maximo 1x por minuto por vendedor).
 * NUNCA derruba o sincronismo: se o servidor ou o SAP nao responderem, o app segue com o que o servidor ja tem
 * e devolve um aviso (null = tudo certo). Recusa por excesso de pedidos (429) nao e problema: ja atualizou ha pouco.
 */
async function atualizarDoSap(): Promise<string | null> {
  try {
    const r = await api<{ resultados?: Array<{ ok: boolean }> }>('/sync/refresh', { method: 'POST', timeoutMs: 150_000 });
    const falhas = (r.resultados ?? []).filter((x) => !x.ok).length;
    return falhas ? 'O SAP não respondeu a tudo agora: alguns dados (pedidos, títulos, estoque) podem estar desatualizados.' : null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) return null;
    return 'Não foi possível buscar as novidades no SAP agora: mostrando o que o servidor já tem.';
  }
}

/** Garante que o banco local pertence ao usuario logado; se for outro, limpa. */
async function prepararUsuario(db: SQLiteDatabase, userId: string) {
  const dono = await lerMeta(db, 'user_id');
  if (dono && dono !== userId) await limparBancoLocal(db);
  if (dono !== userId) await gravarMeta(db, 'user_id', userId);
}

export function useSync(): SyncCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSync fora do SyncProvider');
  return c;
}
