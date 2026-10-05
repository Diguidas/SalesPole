import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase/supabase.module';
import { PedidoRow, PedidosService } from './pedidos.service';

@Injectable()
export class PedidosCron {
  private readonly logger = new Logger(PedidosCron.name);
  private rodando = false;

  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly pedidos: PedidosService,
    private readonly cfg: ConfigService,
  ) {}

  /**
   * Fila de retentativa: a cada minuto envia ao SAP os pedidos 'recebido'/'parcial'
   * com a proxima tentativa vencida (e recupera os travados em 'enviando').
   * A reserva e atomica no banco, entao varias instancias nao duplicam envio.
   */
  @Cron('* * * * *')
  async retentar() {
    if (this.cfg.get('SYNC_ENABLED') === 'false' || this.rodando) return;
    this.rodando = true;
    try {
      const { data, error } = await this.sb.rpc('fn_pedidos_pendentes', { p_limite: 20 });
      if (error) throw error;

      for (const p of (data ?? []) as PedidoRow[]) {
        try {
          await this.pedidos.tentarEnviar(p.id);
        } catch (e) {
          this.logger.error(`Retentativa do pedido ${p.codigo} falhou: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.error(`Job de retentativa falhou: ${(e as Error).message}`);
    } finally {
      this.rodando = false;
    }
  }
}
