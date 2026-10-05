import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

/**
 * Cliente do Supabase usado SO para o login (e-mail/senha) e renovacao do token.
 * Os dados do app vem da API NestJS; as tabelas tem RLS sem policies, entao a
 * chave anon nao le nada alem do login.
 */
export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'sem-chave', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
