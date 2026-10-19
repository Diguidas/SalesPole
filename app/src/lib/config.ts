// EXPO_PUBLIC_* sao embutidas no app no momento do build/bundle (arquivo .env).
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Fotos dos produtos: bucket PUBLICO do Supabase, um arquivo por produto: <cod_produto>.jpg
export const FOTOS_URL = (
  process.env.EXPO_PUBLIC_FOTOS_URL ?? 'https://jebjtpmugcnpxxkdexyg.supabase.co/storage/v1/object/public/lojinha-fotos'
).replace(/\/+$/, '');

export const configuracaoOk = Boolean(API_URL && SUPABASE_URL && SUPABASE_ANON_KEY);
