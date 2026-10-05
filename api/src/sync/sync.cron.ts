import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod } from '../auth/vendedores.service';
import { SUPABASE } from '../supabase/supabase.module';
import { SyncService } from './sync.service';

const TZ = 'America/Sao_Paulo';

@Injectable()
export class SyncCron {
  private readonly logger = new Logger(SyncCron.name);
  private rodando = { diario: false, operacional: false };

  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly sync: SyncService,
    private readonly cfg: ConfigService,
  ) {}

  private get habilitado() {
    return this.cfg.get('SYNC_ENABLED') !== 'false';
  }

  /** Cadastros e catalogo: 1x por dia, de madrugada. Ao final roda tambem o operacional. */
  @Cron('0 5 * * *', { timeZone: TZ })
  async diario() {
    if (!this.habilitado || this.rodando.diario) return;
    this.rodando.diario = true;
    try {
      const codigos = await this.vendedoresAtivos();
      const rotasFeitas = new Set<string>(); // uma rota pode ter varios vendedores

      await this.sync.rodar('produtos', '*', () => this.sync.sincronizarProdutos());

      for (const cod of codigos) {
        try {
          const rota = await this.sync.sincronizarVendedor(cod);
          if (rotasFeitas.has(rota)) continue;
          rotasFeitas.add(rota);

          await this.sync.rodar('clientes', rota, () => this.sync.sincronizarClientes(cod, rota));
          await this.sync.sincronizarCatalogo(cod, rota);
          await this.sync.sincronizarOperacional(cod, rota);
        } catch (e) {
          this.logger.error(`Falha ao sincronizar vendedor ${cod}: ${(e as Error).message}`);
          await this.sync.registrarErro('vendedor', cod, e);
        }
      }
    } catch (e) {
      this.logger.error(`Job diario falhou: ${(e as Error).message}`);
    } finally {
      this.rodando.diario = false;
    }
  }

  /** Pedidos, titulos, remessas e estoque: a cada 15 min, 6h-21h, de segunda a sabado. */
  @Cron('*/15 6-21 * * 1-6', { timeZone: TZ })
  async operacional() {
    if (!this.habilitado || this.rodando.operacional || this.rodando.diario) return;
    this.rodando.operacional = true;
    try {
      for (const { cod, rota } of await this.rotasAtivas()) {
        await this.sync.sincronizarOperacional(cod, rota);
      }
    } catch (e) {
      this.logger.error(`Job operacional falhou: ${(e as Error).message}`);
    } finally {
      this.rodando.operacional = false;
    }
  }

  private async vendedoresAtivos(): Promise<string[]> {
    const { data, error } = await this.sb.from('usuarios_vendedor').select('cod_vendedor').eq('ativo', true);
    if (error) throw error;
    return [...new Set((data ?? []).map((u) => normCod(u.cod_vendedor)))];
  }

  /** Uma entrada por rota (qualquer vendedor dela serve para consultar o SAP). */
  private async rotasAtivas(): Promise<Array<{ cod: string; rota: string }>> {
    const codigos = await this.vendedoresAtivos();
    if (!codigos.length) return [];

    const { data, error } = await this.sb.from('vendedores').select('cod_vendedor, rota').in('cod_vendedor', codigos);
    if (error) throw error;

    const porRota = new Map<string, string>();
    for (const v of data ?? []) {
      if (v.rota && !porRota.has(v.rota)) porRota.set(v.rota, v.cod_vendedor);
    }
    return [...porRota.entries()].map(([rota, cod]) => ({ cod, rota }));
  }
}
