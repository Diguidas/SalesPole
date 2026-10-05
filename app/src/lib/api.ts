import { API_URL } from './config';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    readonly status: number, // 0 = sem resposta (rede, timeout)
    message: string,
  ) {
    super(message);
  }
}

interface Opcoes {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
}

/** Chama a API NestJS com o token do login (renovado automaticamente pelo supabase-js). */
export async function api<T>(caminho: string, { method = 'GET', body, timeoutMs = 90_000 }: Opcoes = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, 'Sessão expirada. Entre novamente.');

  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_URL}${caminho}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controle.signal,
    });

    const texto = await res.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      /* corpo nao e JSON */
    }

    if (!res.ok) {
      const msg = (json as { message?: string } | null)?.message ?? texto.slice(0, 200);
      throw new ApiError(res.status, msg || `Erro ${res.status}`);
    }
    return json as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw new ApiError(0, 'O servidor demorou demais para responder.');
    // em desenvolvimento mostra a URL tentada e o erro real (ex.: "Network request failed"),
    // porque "sem conexao" sozinho esconde se e URL errada, API fora do ar ou HTTP bloqueado
    const detalhe = __DEV__ ? ` [${API_URL || 'EXPO_PUBLIC_API_URL vazia'}${caminho} -> ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}]` : '';
    throw new ApiError(0, `Sem conexão com o servidor.${detalhe}`);
  } finally {
    clearTimeout(timer);
  }
}
