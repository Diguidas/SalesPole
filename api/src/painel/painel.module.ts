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
import { SincronizacaoService } from './sincronizacao.service';
import { UsuariosService } from './usuarios.service';
import { ProdutosPainelService } from './produtos-painel.service';

@Module({
  imports: [PedidosModule, SyncModule],
  controllers: [PainelController],
  providers: [PainelService, PainelGuard, UsuariosService, MonitorService, SincronizacaoService, IndicadoresService, PedidoPainelService, CatalogoPainelService, ConsultaPainelService, ProdutosPainelService],
})
export class PainelModule {}
