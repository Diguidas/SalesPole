import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/auth.guard';
import { VendedorLogado } from '../auth/vendedor.decorator';
import { VendedorLogado as Logado } from '../auth/vendedores.service';
import { PainelGuard, UsuarioPainel, VendedorOk } from './painel.guard';
import { SolicitacoesService } from './solicitacoes.service';

type ReqPainel = { usuarioPainel: UsuarioPainel };

/** Solicitacoes de cliente: o vendedor cadastra (app), o supervisor altera/exclui (app) e o painel consulta. Por enquanto so ficam guardadas. */
@Controller()
export class SolicitacoesController {
  constructor(private readonly solicitacoes: SolicitacoesService) {}

  // ---- vendedor (app) ----
  @Get('solicitacoes/opcoes')
  @UseGuards(SupabaseAuthGuard)
  opcoesVendedor() {
    return this.solicitacoes.opcoes();
  }

  @Get('solicitacoes/vendedor')
  @UseGuards(SupabaseAuthGuard)
  vendedor(@VendedorLogado() v: Logado) {
    return this.solicitacoes.dadosVendedor(v);
  }

  @Post('solicitacoes/cadastro-cliente')
  @UseGuards(SupabaseAuthGuard)
  cadastrar(@VendedorLogado() v: Logado, @Body() corpo: Record<string, unknown>) {
    return this.solicitacoes.cadastrarCliente(v, corpo);
  }

  // ---- supervisor (app, login proprio: sem X-Vendedor) ----
  @VendedorOk()
  @Get('equipe/solicitacoes/opcoes')
  @UseGuards(PainelGuard)
  opcoesSupervisor() {
    return this.solicitacoes.opcoes();
  }

  @Get('equipe/solicitacoes/cliente/:cod')
  @UseGuards(PainelGuard)
  cliente(@Req() req: ReqPainel, @Param('cod') cod: string) {
    return this.solicitacoes.clienteDoSupervisor(req.usuarioPainel, cod);
  }

  @Post('equipe/solicitacoes/:tipo')
  @UseGuards(PainelGuard)
  criar(@Req() req: ReqPainel, @Param('tipo') tipo: string, @Body() corpo: Record<string, unknown>) {
    return this.solicitacoes.criarDoSupervisor(req.usuarioPainel, tipo, corpo);
  }

  // ---- painel ----
  @VendedorOk()
  @Get('painel/solicitacoes')
  @UseGuards(PainelGuard)
  listar(@Req() req: ReqPainel, @Query('tipo') tipo?: string, @Query('busca') busca?: string, @Query('pagina') pagina?: string) {
    return this.solicitacoes.listar(req.usuarioPainel.escopo, { tipo, busca, pagina });
  }

  // criar pelo painel: admin, supervisor, gerente e gerente geral (cadastro em nome de um vendedor da equipe)
  @VendedorOk()
  @Get('painel/solicitacoes/vendedores')
  @UseGuards(PainelGuard)
  vendedoresPainel(@Req() req: ReqPainel) {
    return this.solicitacoes.vendedoresDoPainel(req.usuarioPainel);
  }

  @VendedorOk()
  @Get('painel/solicitacoes/vendedor/:cod')
  @UseGuards(PainelGuard)
  vendedorPainel(@Req() req: ReqPainel, @Param('cod') cod: string) {
    return this.solicitacoes.dadosVendedorDoPainel(req.usuarioPainel, cod);
  }

  @VendedorOk()
  @Post('painel/solicitacoes/cadastro-cliente')
  @UseGuards(PainelGuard)
  cadastrarPainel(@Req() req: ReqPainel, @Body() corpo: Record<string, unknown>) {
    return this.solicitacoes.cadastrarClientePeloPainel(req.usuarioPainel, corpo);
  }

  @VendedorOk()
  @Get('painel/solicitacoes/:id')
  @UseGuards(PainelGuard)
  detalhe(@Req() req: ReqPainel, @Param('id', ParseUUIDPipe) id: string) {
    return this.solicitacoes.detalhe(req.usuarioPainel.escopo, id);
  }
}
