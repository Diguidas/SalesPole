import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { EquipeService } from './equipe.service';
import { PainelGuard, UsuarioPainel } from './painel.guard';

/**
 * Modo equipe do app (supervisor, gerente, gerente geral e admin). Usa o mesmo login e o mesmo cadastro de usuarios do
 * painel (usuarios_painel): quem tem acesso la, com esse papel, tem o modo equipe aqui.
 */
@Controller('equipe')
@UseGuards(PainelGuard)
export class EquipeController {
  constructor(private readonly equipe: EquipeService) {}

  @Get('eu')
  eu(@Req() req: { usuarioPainel: UsuarioPainel }) {
    return this.equipe.eu(req.usuarioPainel);
  }

  @Get('vendedores')
  vendedores(@Req() req: { usuarioPainel: UsuarioPainel }) {
    return this.equipe.listarVendedores(req.usuarioPainel);
  }

  @Get('vendas')
  vendas(@Req() req: { usuarioPainel: UsuarioPainel }) {
    return this.equipe.vendas(req.usuarioPainel);
  }

  @Get('pedidos/:ordem')
  pedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('ordem') ordem: string) {
    return this.equipe.pedido(req.usuarioPainel, ordem);
  }

  @Get('clientes/:cod')
  cliente(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('cod') cod: string) {
    return this.equipe.cliente(req.usuarioPainel, cod);
  }

  @Get('carteiras')
  carteiras(@Req() req: { usuarioPainel: UsuarioPainel }) {
    return this.equipe.carteiras(req.usuarioPainel);
  }

  @Get('clientes')
  clientes(@Req() req: { usuarioPainel: UsuarioPainel }, @Query('busca') busca?: string, @Query('pagina') pagina?: string, @Query('vendedor') vendedor?: string) {
    return this.equipe.clientes(req.usuarioPainel, busca, pagina, vendedor);
  }

  @Get('hoje')
  hoje(@Req() req: { usuarioPainel: UsuarioPainel }) {
    return this.equipe.hoje(req.usuarioPainel);
  }
}
