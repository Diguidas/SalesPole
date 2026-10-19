import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !chave) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY nao configurados (.env.local).');

// chave anon e publica por desenho; so serve para o login. Os dados vem da API do Sales Pole.
export const supabase = createClient(url, chave);
