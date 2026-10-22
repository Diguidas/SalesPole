import { supabase } from './supabase';

const BASE = ((import.meta.env.VITE_API_URL as string) || 'http://localhost:3000').replace(/\/$/, '');

export class ErroApi extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

/** Chama a API do SalesPole com o token do login Microsoft (Supabase). */
export async function api<T>(caminho: string, opcoes: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opcoes.body !== undefined) headers['Content-Type'] = 'application/json';

  let r: Response;
  try {
    r = await fetch(BASE + caminho, {
      method: opcoes.method ?? 'GET',
      headers,
      body: opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined,
    });
  } catch {
    throw new ErroApi(0, 'Sem conexao com o servidor.');
  }
  const texto = await r.text();
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* resposta nao JSON */
  }
  if (!r.ok) {
    const msg = (json as { message?: string | string[] } | null)?.message;
    throw new ErroApi(r.status, Array.isArray(msg) ? msg.join(', ') : msg || `Erro ${r.status}`);
  }
  return json as T;
}
