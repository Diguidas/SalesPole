const OBRIGATORIAS = [
  'SAP_BASE_URL',
  'SAP_USER',
  'SAP_PASSWORD',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

/** Falha o boot se faltar variavel obrigatoria. */
export function validateEnv(config: Record<string, unknown>) {
  const faltando = OBRIGATORIAS.filter((k) => !config[k]);
  if (faltando.length) {
    throw new Error(`Variaveis de ambiente ausentes: ${faltando.join(', ')}`);
  }
  return config;
}
