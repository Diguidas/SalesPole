import { Module } from '@nestjs/common';
import { VisitasController } from './visitas.controller';
import { VisitasCron } from './visitas.cron';
import { VisitasService } from './visitas.service';

@Module({
  controllers: [VisitasController],
  providers: [VisitasService, VisitasCron],
  exports: [VisitasService],
})
export class VisitasModule {}
