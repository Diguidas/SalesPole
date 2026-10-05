import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase/supabase.module';

export interface VendedorLogado {
  email: string;
  codVendedor: string;
  /** null ate o primeiro sync do vendedor com o SAP */
  rota: string | null;
}

/** Codigo do vendedor sem zeros a esquerda (SAP devolve assim; o painel pode digitar com zeros). */
export const normCod = (cod: string) => cod.trim().replace(/^0+/, '') || '0';

const TTL_MS = 60_000;

@Injectable()
export class VendedoresService {
  private cache = new Map<string, { v: VendedorLogado | null; exp: number }>();

  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {}

  /** Resolve o login Microsoft (e-mail) para o vendedor vinculado no painel. */
  async porEmail(email: string): Promise<VendedorLogado | null> {
    const chave = email.toLowerCase();
    const hit = this.cache.get(chave);
    if (hit && hit.exp > Date.now()) return hit.v;

    const { data: vinculo, error } = await this.sb
      .from('usuarios_vendedor')
      .select('cod_vendedor')
      .eq('email', chave)
      .eq('ativo', true)
      .maybeSingle();
    if (error) throw error;

    let resultado: VendedorLogado | null = null;
    if (vinculo) {
      const codVendedor = normCod(vinculo.cod_vendedor);
      const { data: vend, error: e2 } = await this.sb
        .from('vendedores')
        .select('rota')
        .eq('cod_vendedor', codVendedor)
        .maybeSingle();
      if (e2) throw e2;
      resultado = { email: chave, codVendedor, rota: vend?.rota ?? null };
    }

    this.cache.set(chave, { v: resultado, exp: Date.now() + TTL_MS });
    return resultado;
  }

  invalidar(email: string) {
    this.cache.delete(email.toLowerCase());
  }
}
