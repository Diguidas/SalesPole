// EXPO_PUBLIC_* sao embutidas no app no momento do build/bundle (arquivo .env).
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const configuracaoOk = Boolean(API_URL && SUPABASE_URL && SUPABASE_ANON_KEY);
