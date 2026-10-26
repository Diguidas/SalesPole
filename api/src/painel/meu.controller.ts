import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { MeuService } from './meu.service';
import { PainelGuard, UsuarioPainel, VendedorOk } from './painel.guard';

type Req_ = { usuarioPainel: UsuarioPainel };

/**
 * O painel para quem vende (e para a supervisao ver "como o vendedor"). O vendedor so enxerga a propria carteira;
 * admin/supervisor/gerente passam `?vendedor=` com um vendedor do escopo deles.
 */
@Controller('meu')
@UseGuards(PainelGuard)
@VendedorOk()
export class MeuController {
  constructor(private readonly meu: MeuService) {}

  @Get('eu')
  eu(@Req() req: Req_, @Query('vendedor') vendedor?: string) {
    return this.meu.eu(req.usuarioPainel, vendedor);
  }

  @Get('hoje')
  hoje(@Req() req: Req_, @Query('vendedor') vendedor?: string, @Query('dia') dia?: string) {
    return this.meu.hoje(req.usuarioPainel, vendedor, dia);
  }

  @Get('alertas')
  alertas(@Req() req: Req_, @Query('vendedor') vendedor?: string, @Query('dias') dias?: string) {
    return this.meu.alertas(req.usuarioPainel, vendedor, dias);
  }

  @Get('carteira-parada')
  carteiraParada(@Req() req: Req_, @Query('vendedor') vendedor?: string, @Query('dias') dias?: string) {
    return this.meu.carteiraParada(req.usuarioPainel, vendedor, dias);
  }

  @Get('titulos')
  titulos(@Req() req: Req_, @Query('vendedor') vendedor?: string, @Query('filtro') filtro?: string) {
    return this.meu.titulos(req.usuarioPainel, vendedor, filtro);
  }

  @Get('avisos')
  avisos(@Req() req: Req_, @Query('vendedor') vendedor?: string) {
    return this.meu.avisos(req.usuarioPainel, vendedor);
  }

  @Get('bi')
  bi() {
    return this.meu.bi();
  }

  @Get('visita-perguntas/:cliente')
  perguntas(@Req() req: Req_, @Param('cliente') cliente: string, @Query('vendedor') vendedor?: string) {
    return this.meu.perguntas(req.usuarioPainel, cliente, vendedor);
  }

  @Post('visitas')
  iniciar(@Req() req: Req_, @Body() corpo: Record<string, unknown>) {
    return this.meu.iniciarVisita(req.usuarioPainel, corpo);
  }

  @Post('visitas/:id/concluir')
  concluir(@Req() req: Req_, @Param('id') id: string, @Body() corpo: Record<string, unknown>) {
    return this.meu.concluirVisita(req.usuarioPainel, id, corpo);
  }
}
