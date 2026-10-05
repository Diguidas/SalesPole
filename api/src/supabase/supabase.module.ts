import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE = Symbol('SUPABASE');

/** Cliente com service role: ignora RLS. Uso exclusivo do backend. */
@Global()
@Module({
  providers: [
    {
      provide: SUPABASE,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): SupabaseClient =>
        createClient(
          cfg.getOrThrow<string>('SUPABASE_URL'),
          cfg.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
          { auth: { persistSession: false, autoRefreshToken: false } },
        ),
    },
  ],
  exports: [SUPABASE],
})
export class SupabaseModule {}
