import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PainelGuard, Papeis, Permissoes, SoPapeis, UsuarioPainel, VendedorOk } from './painel.guard';
import { PADROES, PERMISSOES } from './permissoes';
import { IndicadoresService } from './indicadores.service';
import { MonitorService } from './monitor.service';
import { SincronizacaoService } from './sincronizacao.service';
import { PainelService } from './painel.service';
import { CatalogoPainelService } from './catalogo-painel.service';
import { ConsultaPainelService } from './consulta-painel.service';
import { PedidoPainelService } from './pedido-painel.service';
import { UsuariosService } from './usuarios.service';
import { ProdutosPainelService } from './produtos-painel.service';
import { CombosService } from './combos.service';

/** Endpoints do painel web (React). Login Microsoft via Supabase; permissao pelo papel em usuarios_painel. */
@Controller('painel')
@UseGuards(PainelGuard)
export class PainelController {
  constructor(
    private readonly painel: PainelService,
    private readonly usuarios: UsuariosService,
    private readonly monitor: MonitorService,
    private readonly sincronizacao: SincronizacaoService,
    private readonly indicadores: IndicadoresService,
    private readonly pedidoPainel: PedidoPainelService,
    private readonly catalogo: CatalogoPainelService,
    private readonly consulta: ConsultaPainelService,
    private readonly produtosPainel: ProdutosPainelService,
    private readonly combos: CombosService,
  ) {}

  @VendedorOk()
  @Get('eu')
  eu(@Req() req: { usuarioPainel: UsuarioPainel }) {
    const { escopo: _escopo, ...u } = req.usuarioPainel; // o escopo (listas de vendedores/rotas) fica so no servidor
    return u;
  }

  @Get('bonificacoes')
  bonificacoes(@Req() req: { usuarioPainel: UsuarioPainel }, @Query('status') status?: string) {
    return this.painel.bonificacoes(req.usuarioPainel.escopo, status);
  }

  @Post('bonificacoes/:id/aprovar')
  @Permissoes('aprovar_bonificacao')
  aprovar(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('id', ParseUUIDPipe) id: string) {
    return this.painel.decidirBonificacao(req.usuarioPainel, id, true);
  }

  @Post('bonificacoes/:id/rejeitar')
  @Permissoes('aprovar_bonificacao')
  rejeitar(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('id', ParseUUIDPipe) id: string, @Body() body: { motivo?: string }) {
    return this.painel.decidirBonificacao(req.usuarioPainel, id, false, body?.motivo);
  }

  // ---- consulta geral: pedidos e clientes (todos veem; cancelar pedido so admin e aprovador) ----
  @VendedorOk()
  @Get('pedidos')
  listarPedidos(
    @Req() req: { usuarioPainel: UsuarioPainel },
    @Query('origem') origem?: string, @Query('ini') ini?: string, @Query('fim') fim?: string, @Query('vendedor') vendedor?: string,
    @Query('busca') busca?: string, @Query('status') status?: string, @Query('antecipado') antecipado?: string, @Query('pendentes') pendentes?: string, @Query('pagina') pagina?: string,
  ) {
    return this.consulta.listarPedidos(req.usuarioPainel.escopo, { origem, ini, fim, vendedor, busca, status, antecipado, pendentes, pagina });
  }

  @VendedorOk()
  @Get('pedidos/:ordem')
  pedidoSap(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('ordem') ordem: string) {
    return this.consulta.pedido(ordem, req.usuarioPainel.escopo);
  }

  @VendedorOk()
  @Post('pedidos/:ordem/atualizar')
  atualizarPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('ordem') ordem: string) {
    return this.consulta.atualizarPedido(req.usuarioPainel.escopo, ordem);
  }

  @VendedorOk()
  @Post('pedidos/:ordem/cancelar')
  @Permissoes('cancelar_pedido')
  cancelarPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('ordem') ordem: string, @Body() corpo: { motivo?: string }) {
    return this.consulta.cancelarPedido(req.usuarioPainel, ordem, corpo?.motivo);
  }

  @VendedorOk()
  @Get('pedido-app/:id/pdf-dados')
  pedidoAppPdf(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('id') id: string) {
    return this.consulta.pedidoAppParaPdf(id, req.usuarioPainel.escopo);
  }

  @VendedorOk()
  @Get('clientes')
  listarClientes(
    @Req() req: { usuarioPainel: UsuarioPainel },
    @Query('vendedor') vendedor?: string, @Query('busca') busca?: string, @Query('escritorio') escritorio?: string,
    @Query('canal') canal?: string, @Query('situacao') situacao?: string, @Query('pagina') pagina?: string,
  ) {
    return this.consulta.listarClientes(req.usuarioPainel.escopo, { vendedor, busca, escritorio, canal, situacao, pagina });
  }

  @Get('clientes-filtros')
  filtrosClientes() {
    return this.consulta.filtrosClientes();
  }

  @VendedorOk()
  @Get('clientes/:cod')
  cliente(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('cod') cod: string) {
    return this.consulta.cliente(cod, req.usuarioPainel.escopo);
  }

  // ---- pedido em nome do vendedor (admin e aprovador) ----
  @VendedorOk()
  @Get('pedido-novo/vendedores')
  @Permissoes('criar_pedido')
  vendedoresParaPedido(@Req() req: { usuarioPainel: UsuarioPainel }) {
    return this.pedidoPainel.vendedores(req.usuarioPainel.escopo);
  }

  @VendedorOk()
  @Get('pedido-novo/clientes')
  @Permissoes('criar_pedido')
  clientesParaPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Query('vendedor') vendedor = '', @Query('q') q = '') {
    return this.pedidoPainel.clientes(vendedor, q, req.usuarioPainel.escopo);
  }

  @VendedorOk()
  @Get('pedido-novo/produtos')
  @Permissoes('criar_pedido')
  produtosParaPedido(@Query('cliente') cliente = '', @Query('q') q = '') {
    return this.catalogo.produtos(cliente, q);
  }

  @VendedorOk()
  @Get('pedido-novo/catalogo')
  @Permissoes('criar_pedido')
  catalogoParaPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Query('cliente') cliente = '', @Query('q') q = '', @Query('inicio') inicio = '0', @Query('todos') todos = '') {
    return this.catalogo.catalogo(cliente, q, inicio, todos === '1', req.usuarioPainel.escopo);
  }

  @VendedorOk()
  @Get('pedido-novo/produto')
  @Permissoes('criar_pedido')
  produtoParaPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Query('vendedor') vendedor = '', @Query('cliente') cliente = '', @Query('produto') produto = '') {
    return this.catalogo.produtoDetalhe(vendedor, cliente, produto, req.usuarioPainel.escopo);
  }

  @VendedorOk()
  @Get('pedido-novo/sugestoes')
  @Permissoes('criar_pedido')
  sugestoesParaPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Query('vendedor') vendedor = '', @Query('cliente') cliente = '') {
    return this.catalogo.sugestoes(vendedor, cliente, req.usuarioPainel.escopo);
  }

  @VendedorOk()
  @Get('pedido-novo/duplicar')
  @Permissoes('criar_pedido')
  duplicarPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Query('vendedor') vendedor = '', @Query('cliente') cliente = '', @Query('ordem') ordem = '') {
    return this.catalogo.duplicar(vendedor, cliente, ordem, req.usuarioPainel.escopo);
  }

  @VendedorOk()
  @Post('pedido-novo/cotar')
  @Permissoes('criar_pedido')
  cotarPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Body() corpo: { vendedor?: string; cliente?: string; itens?: unknown; tipo?: string }) {
    return this.catalogo.cotar(String(corpo?.vendedor ?? ''), String(corpo?.cliente ?? ''), corpo?.itens, req.usuarioPainel.escopo, corpo?.tipo === 'bonificacao' ? 'bonificacao' : 'venda');
  }

  @VendedorOk()
  @Post('pedido-novo/carteira')
  @Permissoes('criar_pedido')
  carregarCarteira(@Req() req: { usuarioPainel: UsuarioPainel }, @Body() corpo: { vendedor?: string }) {
    return this.pedidoPainel.carregarCarteira(String(corpo?.vendedor ?? ''), req.usuarioPainel.escopo);
  }

  @VendedorOk()
  @Post('pedidos')
  @Permissoes('criar_pedido')
  criarPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Body() corpo: Record<string, unknown>) {
    return this.pedidoPainel.criar(req.usuarioPainel, corpo ?? {});
  }

  // ---- gerencial: indicadores de vendas (todos veem) e escolha dos vendedores (so admin) ----
  @Get('indicadores/visitas')
  visitasResumo(@Req() req: { usuarioPainel: UsuarioPainel }, @Query('ini') ini?: string, @Query('fim') fim?: string) {
    return this.indicadores.visitas(ini, fim, req.usuarioPainel.escopo);
  }

  @Get('indicadores/rankings')
  rankings(@Req() req: { usuarioPainel: UsuarioPainel }, @Query('ini') ini?: string, @Query('fim') fim?: string, @Query('limite') limite?: string) {
    return this.indicadores.rankings(ini, fim, limite, req.usuarioPainel.escopo);
  }

  @Get('indicadores')
  verIndicadores(@Req() req: { usuarioPainel: UsuarioPainel }, @Query('ini') ini?: string, @Query('fim') fim?: string) {
    return this.indicadores.vendas(ini, fim, req.usuarioPainel.escopo);
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
  @SoPapeis('admin', 'aprovador', 'consulta')
  verMonitor() {
    return this.monitor.visao();
  }

  @Post('monitor/pedidos/:id/reenviar')
  @Papeis('aprovador')
  @SoPapeis('aprovador')
  reenviarPedido(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('id', ParseUUIDPipe) id: string) {
    return this.monitor.reenviarPedido(req.usuarioPainel, id);
  }

  // ---- sincronizacao manual por carteira (Monitor; so admin) ----
  @Get('monitor/carteiras')
  @Papeis('admin')
  carteirasParaSincronizar() {
    return this.sincronizacao.carteiras();
  }

  @Get('monitor/sincronizacoes')
  @Papeis('admin')
  listarSincronizacoes() {
    return this.sincronizacao.lista();
  }

  @Post('monitor/sincronizar')
  @Papeis('admin')
  sincronizarCarteiras(@Req() req: { usuarioPainel: UsuarioPainel }, @Body() corpo: { rotas?: unknown; recursos?: unknown }) {
    return this.sincronizacao.iniciar(req.usuarioPainel.email, corpo?.rotas, corpo?.recursos);
  }

  @Post('monitor/sincronizacoes/cancelar')
  @Papeis('admin')
  cancelarSincronizacoes() {
    return this.sincronizacao.cancelar();
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

  @Post('usuarios/painel/papel')
  @Papeis('admin')
  mudarPapelUsuario(@Req() req: { usuarioPainel: UsuarioPainel }, @Body() corpo: { email?: string; papel?: string }) {
    return this.usuarios.mudarPapel(req.usuarioPainel, String(corpo?.email ?? ''), String(corpo?.papel ?? ''));
  }

  @Get('usuarios/permissoes')
  @Papeis('admin')
  catalogoPermissoes() {
    return { catalogo: PERMISSOES, padroes: PADROES };
  }

  @Get('usuarios/supervisores-sap')
  @Papeis('admin')
  listarSupervisoresSap() {
    return this.usuarios.listarSupervisoresSap();
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
  visitas(@Req() req: { usuarioPainel: UsuarioPainel }, @Query('validacao') validacao?: string, @Query('ini') ini?: string, @Query('fim') fim?: string, @Query('vendedor') vendedor?: string) {
    return this.painel.visitas(req.usuarioPainel.escopo, { validacao, ini, fim, vendedor });
  }

  @Post('visitas/:id/validar')
  @Permissoes('validar_visita')
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

  // ---- produtos e listas de preco (somente leitura) ----
  @VendedorOk()
  @Get('catalogo-produtos')
  listarProdutos(@Query('busca') busca?: string, @Query('tipo') tipo?: string, @Query('situacao') situacao?: string, @Query('pagina') pagina?: string) {
    return this.produtosPainel.listarProdutos({ busca, tipo, situacao, pagina });
  }

  @VendedorOk()
  @Get('catalogo-produtos/:cod')
  produtoDetalhe(@Param('cod') cod: string) {
    return this.produtosPainel.produto(cod);
  }

  @Get('opcoes-escopo')
  opcoesEscopo() {
    return this.produtosPainel.opcoesEscopo();
  }

  @Get('listas-preco')
  listasPreco() {
    return this.produtosPainel.listasPreco();
  }

  @Get('listas-preco/:pltyp')
  listaPreco(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('pltyp') pltyp: string) {
    return this.produtosPainel.listaPreco(pltyp, req.usuarioPainel.escopo);
  }

  @Get('listas-preco/:pltyp/clientes')
  clientesDaLista(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('pltyp') pltyp: string, @Query('busca') busca?: string, @Query('pagina') pagina?: string) {
    return this.produtosPainel.clientesDaLista(pltyp, { busca, pagina }, req.usuarioPainel.escopo);
  }

  // ---- cadastros: todos veem, so admin altera ----
  @VendedorOk()
  @Get('produtos')
  produtos(@Query('q') q = '') {
    return this.painel.buscarProdutos(q);
  }

  @Get('cadastros/:nome')
  listarCadastro(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('nome') nome: string) {
    return this.painel.listarCadastro(nome, req.usuarioPainel.escopo);
  }

  // admin altera qualquer cadastro; quem tem a permissao "comunicados" altera so os avisos (dentro da equipe, se tiver escopo)
  @Post('cadastros/:nome')
  gravarCadastro(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('nome') nome: string, @Body() corpo: Record<string, unknown>) {
    this.exigirCadastro(req.usuarioPainel, nome);
    return this.painel.gravarCadastro(nome, corpo, req.usuarioPainel.escopo);
  }

  @Post('cadastros/:nome/ativo')
  ativarCadastro(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('nome') nome: string, @Body() corpo: { chave?: string; ativo?: boolean }) {
    this.exigirCadastro(req.usuarioPainel, nome);
    return this.painel.ativarCadastro(nome, String(corpo?.chave ?? ''), corpo?.ativo === true, req.usuarioPainel.escopo);
  }

  // ---- combos de desconto: todos veem, so admin altera ----
  @Get('combos')
  listarCombos() {
    return this.combos.listar();
  }

  @Post('combos')
  gravarCombo(@Req() req: { usuarioPainel: UsuarioPainel }, @Body() corpo: Record<string, unknown>) {
    this.exigirAdmin(req.usuarioPainel);
    return this.combos.gravar(corpo ?? {});
  }

  @Post('combos/:id/ativo')
  ativarCombo(@Req() req: { usuarioPainel: UsuarioPainel }, @Param('id', ParseUUIDPipe) id: string, @Body() corpo: { ativo?: boolean }) {
    this.exigirAdmin(req.usuarioPainel);
    return this.combos.ativar(id, corpo?.ativo === true);
  }

  private exigirAdmin(u: UsuarioPainel) {
    if (u.papel !== 'admin') throw new ForbiddenException('Seu perfil nao permite alterar combos');
  }

  private exigirCadastro(u: UsuarioPainel, nome: string) {
    if (u.papel === 'admin') return;
    if (nome === 'avisos' && u.permissoes.includes('comunicados')) return;
    throw new ForbiddenException('Seu perfil nao permite alterar este cadastro');
  }

}
