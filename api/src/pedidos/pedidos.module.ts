import { Module } from '@nestjs/common';
import { PedidosController } from './pedidos.controller';
import { PedidosCron } from './pedidos.cron';
import { PedidosService } from './pedidos.service';

@Module({
  controllers: [PedidosController],
  providers: [PedidosService, PedidosCron],
  exports: [PedidosService],
})
export class PedidosModule {}
