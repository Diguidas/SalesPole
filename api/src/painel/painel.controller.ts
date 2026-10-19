import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PainelGuard, Papeis, UsuarioPainel } from './painel.guard';
import { IndicadoresService } from './indicadores.service';
import { MonitorService } from './monitor.service';
import { PainelService } from './painel.service';
import { CatalogoPainelService } from './catalogo-painel.service';
import { ConsultaPainelService } from './consulta-painel.service';
import { PedidoPainelService } from './pedido-painel.service';
import { UsuariosService } from './usuarios.service';

/** Endpoints do painel web (React). Login Microsoft via Supabase; permissao pelo papel em usuarios_painel. */
@Controller('painel')
@UseGuards(PainelGuard)
export class PainelController {
  constructor(
    private readonly painel: PainelService,
    private readonly usuarios: UsuariosService,
    private readonly monitor: MonitorService,
    private readonly indicadores: IndicadoresService,
    private readonly pedidoPainel: PedidoPainelService,
    private readonly catalogo: CatalogoPainelService,
    private readonly consulta: ConsultaPainelService,
  ) {}

  @Get('eu')
  eu(@Req() req: { usuarioPainel: UsuarioPainel }) {
    return req.usuarioPainel;
  }

  @Get('bonificacoes')
  bonificacoes(@Query('status') status?: string) {
    return this.painel.bonificacoes(status);
  }

  @Post('bonificacoes/:id/aprovar')
  @Papeis('aprovador')
  aprovar(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('id', ParseUUIDPipe) id: string) {
    return this.painel.decidirBonificacao(req.usuarioPainel, id, true);
  }

  @Post('bonificacoes/:id/rejeitar')
  @Papeis('aprovador')
  rejeitar(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('id', ParseUUIDPipe) id: string, @Body() body: { motivo?: string }) {
    return this.painel.decidirBonificacao(req.usuarioPainel, id, false, body?.motivo);
  }

  // ---- consulta geral: pedidos e clientes (todos veem; cancelar pedido so admin e aprovador) ----
  @Get('pedidos')
  listarPedidos(
    @Query('origem') origem?: string, @Query('ini') ini?: string, @Query('fim') fim?: string, @Query('vendedor') vendedor?: string,
    @Query('busca') busca?: string, @Query('status') status?: string, @Query('antecipado') antecipado?: string, @Query('pendentes') pendentes?: string, @Query('pagina') pagina?: string,
  ) {
    return this.consulta.listarPedidos({ origem, ini, fim, vendedor, busca, status, antecipado, pendentes, pagina });
  }

  @Get('pedidos/:ordem')
  pedidoSap(@Param('ordem') ordem: string) {
    return this.consulta.pedido(ordem);
  }

  @Post('pedidos/:ordem/atualizar')
  atualizarPedido(@Param('ordem') ordem: string) {
    return this.consulta.atualizarPedido(ordem);
  }

  @Post('pedidos/:ordem/cancelar')
  @Papeis('aprovador')
  cancelarPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('ordem') ordem: string, @Body() corpo: { motivo?: string }) {
    return this.consulta.cancelarPedido(req.usuarioPainel, ordem, corpo?.motivo);
  }

  @Get('clientes')
  listarClientes(
    @Query('vendedor') vendedor?: string, @Query('busca') busca?: string, @Query('escritorio') escritorio?: string,
    @Query('canal') canal?: string, @Query('situacao') situacao?: string, @Query('pagina') pagina?: string,
  ) {
    return this.consulta.listarClientes({ vendedor, busca, escritorio, canal, situacao, pagina });
  }

  @Get('clientes-filtros')
  filtrosClientes() {
    return this.consulta.filtrosClientes();
  }

  @Get('clientes/:cod')
  cliente(@Param('cod') cod: string) {
    return this.consulta.cliente(cod);
  }

  // ---- pedido em nome do vendedor (admin e aprovador) ----
  @Get('pedido-novo/vendedores')
  @Papeis('aprovador')
  vendedoresParaPedido() {
    return this.pedidoPainel.vendedores();
  }

  @Get('pedido-novo/clientes')
  @Papeis('aprovador')
  clientesParaPedido(@Query('vendedor') vendedor = '', @Query('q') q = '') {
    return this.pedidoPainel.clientes(vendedor, q);
  }

  @Get('pedido-novo/produtos')
  @Papeis('aprovador')
  produtosParaPedido(@Query('cliente') cliente = '', @Query('q') q = '') {
    return this.catalogo.produtos(cliente, q);
  }

  @Post('pedido-novo/cotar')
  @Papeis('aprovador')
  cotarPedido(@Body() corpo: { vendedor?: string; cliente?: string; itens?: unknown }) {
    return this.catalogo.cotar(String(corpo?.vendedor ?? ''), String(corpo?.cliente ?? ''), corpo?.itens);
  }

  @Post('pedido-novo/carteira')
  @Papeis('aprovador')
  carregarCarteira(@Body() corpo: { vendedor?: string }) {
    return this.pedidoPainel.carregarCarteira(String(corpo?.vendedor ?? ''));
  }

  @Post('pedidos')
  @Papeis('aprovador')
  criarPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Body() corpo: Record<string, unknown>) {
    return this.pedidoPainel.criar(req.usuarioPainel, corpo ?? {});
  }

  // ---- gerencial: indicadores de vendas (todos veem) e escolha dos vendedores (so admin) ----
  @Get('indicadores')
  verIndicadores(@Query('ini') ini?: string, @Query('fim') fim?: string) {
    return this.indicadores.vendas(ini, fim);
  }

  @Get('vendedores')
  @Papeis('admin')
  listarVendedores() {
    return this.indicadores.vendedores();
  }

  @Post('vendedores/importar')
  @Papeis('admin')
  importarVendedores() {
    return this.indicadores.importar();
  }

  @Post('vendedores/sincronizar')
  @Papeis('admin')
  sincronizarVendedores() {
    return this.indicadores.sincronizarAgora();
  }

  @Get('vendedores/sincronizacao')
  @Papeis('admin')
  andamentoSincronizacao() {
    return this.indicadores.andamentoCompleto();
  }

  @Post('vendedores/indicadores')
  @Papeis('admin')
  marcarVendedores(@Body() corpo: { codigos?: unknown; ativo?: boolean }) {
    return this.indicadores.marcar(corpo?.codigos, corpo?.ativo === true);
  }

  // ---- monitor: saude do sistema (todos veem; reenviar so admin/aprovador) ----
  @Get('monitor')
  verMonitor() {
    return this.monitor.visao();
  }

  @Post('monitor/pedidos/:id/reenviar')
  @Papeis('aprovador')
  reenviarPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('id', ParseUUIDPipe) id: string) {
    return this.monitor.reenviarPedido(req.usuarioPainel, id);
  }

  // ---- usuarios (so admin): quem entra no painel e quem usa o app ----
  @Get('usuarios/painel')
  @Papeis('admin')
  listarUsuariosPainel() {
    return this.usuarios.listarPainel();
  }

  @Post('usuarios/painel')
  @Papeis('admin')
  gravarUsuarioPainel(@Req() req: { usuarioPainel: UsuarioPainel }, @Body() corpo: Record<string, unknown>) {
    return this.usuarios.gravarPainel(req.usuarioPainel, corpo ?? {});
  }

  @Get('usuarios/vendedores')
  @Papeis('admin')
  listarUsuariosVendedores() {
    return this.usuarios.listarVendedores();
  }

  @Post('usuarios/vendedores')
  @Papeis('admin')
  gravarUsuarioVendedor(@Req() req: { usuarioPainel: UsuarioPainel }, @Body() corpo: Record<string, unknown>) {
    return this.usuarios.gravarVendedor(req.usuarioPainel, corpo ?? {});
  }

  // ---- visitas: validacao da visita e da foto (aprovador/admin) ----
  @Get('visitas')
  visitas(@Query('validacao') validacao?: string, @Query('ini') ini?: string, @Query('fim') fim?: string, @Query('vendedor') vendedor?: string) {
    return this.painel.visitas({ validacao, ini, fim, vendedor });
  }

  @Post('visitas/:id/validar')
  @Papeis('aprovador')
  validarVisita(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('id', ParseUUIDPipe) id: string, @Body() corpo: { validada?: boolean; obs?: string }) {
    return this.painel.validarVisita(req.usuarioPainel, id, corpo?.validada === true, corpo?.obs);
  }

  // ---- parametros: todos veem, so admin altera ----
  @Get('parametros')
  parametros() {
    return this.painel.parametros();
  }

  @Post('parametros/:chave')
  @Papeis('admin')
  gravarParametro(@Param('chave') chave: string, @Body() corpo: { valor?: unknown }) {
    return this.painel.gravarParametro(chave, corpo?.valor);
  }

  // ---- cadastros: todos veem, so admin altera ----
  @Get('produtos')
  produtos(@Query('q') q = '') {
    return this.painel.buscarProdutos(q);
  }

  @Get('cadastros/:nome')
  listarCadastro(@Param('nome') nome: string) {
    return this.painel.listarCadastro(nome);
  }

  @Post('cadastros/:nome')
  @Papeis('admin')
  gravarCadastro(@Param('nome') nome: string, @Body() corpo: Record<string, unknown>) {
    return this.painel.gravarCadastro(nome, corpo);
  }

  @Post('cadastros/:nome/ativo')
  @Papeis('admin')
  ativarCadastro(@Param('nome') nome: string, @Body() corpo: { chave?: string; ativo?: boolean }) {
    return this.painel.ativarCadastro(nome, String(corpo?.chave ?? ''), corpo?.ativo === true);
  }

}
