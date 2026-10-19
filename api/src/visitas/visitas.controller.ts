import { BadRequestException, Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/auth.guard';
import { VendedorLogado } from '../auth/vendedor.decorator';
import { VendedorLogado as Logado } from '../auth/vendedores.service';
import { VisitasService } from './visitas.service';

const MAX_VISITAS_POR_PUSH = 50;

@Controller('visitas')
@UseGuards(SupabaseAuthGuard)
export class VisitasController {
  constructor(private readonly visitas: VisitasService) {}

  /**
   * Envia visitas (check-in e, quando ja feito, o check-out). Cada uma e tratada isoladamente.
   * Corpo: { "visitas": [ { id, cod_cliente, data_visita, checkin_em, checkin_lat, checkin_lng,
   *   checkin_precisao_m?, gps_falso?, checkout_em?, resultado?, motivo_nao_venda?, pedido_id?, observacao? } ] }
   */
  @Post('push')
  async push(@VendedorLogado() v: Logado, @Body() body: { visitas?: unknown[] }) {
    const lista = body?.visitas;
    if (!Array.isArray(lista) || lista.length === 0) {
      throw new BadRequestException('Envie { "visitas": [ ... ] } com ao menos uma visita');
    }
    if (lista.length > MAX_VISITAS_POR_PUSH) {
      throw new BadRequestException(`No maximo ${MAX_VISITAS_POR_PUSH} visitas por envio`);
    }
    const resultados = [];
    for (const x of lista) resultados.push(await this.visitas.receber(v, x));
    return { resultados };
  }

  /** Registra uma foto e devolve o caminho + token para subir o arquivo direto no Storage. */
  @Post('fotos/preparar')
  prepararFoto(@VendedorLogado() v: Logado, @Body() body: unknown) {
    return this.visitas.prepararFoto(v, body);
  }

  /** O arquivo foi enviado: marca a foto como recebida. */
  @Post('fotos/:id/confirmar')
  confirmarFoto(@VendedorLogado() v: Logado, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.visitas.confirmarFoto(v, id);
  }
}
