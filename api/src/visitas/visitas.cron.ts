import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { VisitasService } from './visitas.service';

@Injectable()
export class VisitasCron implements OnModuleInit {
  private readonly logger = new Logger(VisitasCron.name);

  constructor(
    private readonly visitas: VisitasService,
    private readonly cfg: ConfigService,
  ) {}

  /** Garante o bucket privado das fotos ao subir a API. */
  async onModuleInit() {
    if (this.cfg.get('SYNC_ENABLED') === 'false') return;
    try {
      await this.visitas.garantirBucket();
    } catch (e) {
      this.logger.warn(`Bucket das fotos de visita nao verificado: ${(e as Error).message}`);
    }
  }

  /** Retencao das fotos: todo dia as 3h30 (Sao Paulo) apaga as fotos mais velhas que FOTO_VISITA_DIAS. */
  @Cron('30 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async limparFotos() {
    if (this.cfg.get('SYNC_ENABLED') === 'false') return;
    try {
      await this.visitas.limparFotosAntigas();
    } catch (e) {
      this.logger.error(`Retencao das fotos de visita falhou: ${(e as Error).message}`);
    }
  }
}
