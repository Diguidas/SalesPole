import { Module } from '@nestjs/common';
import { PedidosModule } from '../pedidos/pedidos.module';
import { SyncModule } from '../sync/sync.module';
import { PainelController } from './painel.controller';
import { CatalogoPainelService } from './catalogo-painel.service';
import { ConsultaPainelService } from './consulta-painel.service';
import { PedidoPainelService } from './pedido-painel.service';
import { PainelGuard } from './painel.guard';
import { IndicadoresService } from './indicadores.service';
import { MonitorService } from './monitor.service';
import { PainelService } from './painel.service';
import { UsuariosService } from './usuarios.service';

@Module({
  imports: [PedidosModule, SyncModule],
  controllers: [PainelController],
  providers: [PainelService, PainelGuard, UsuariosService, MonitorService, IndicadoresService, PedidoPainelService, CatalogoPainelService, ConsultaPainelService],
})
export class PainelModule {}
