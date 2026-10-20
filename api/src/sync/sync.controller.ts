import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAuthGuard } from '../auth/auth.guard';
import { VendedorLogado } from '../auth/vendedor.decorator';
import { VendedoresService, VendedorLogado as Logado } from '../auth/vendedores.service';
import { SUPABASE } from '../supabase/supabase.module';
import { SyncService } from './sync.service';

const REFRESH_MIN_INTERVALO_MS = 60_000;

@Controller('sync')
@UseGuards(SupabaseAuthGuard)
export class SyncController {
  private ultimoRefresh = new Map<string, number>();

  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly sync: SyncService,
    private readonly vendedores: VendedoresService,
  ) {}

  /**
   * Baixa o que mudou na carteira do vendedor desde `since` (ISO). Sem `since`,
   * baixa tudo.
   *
   * - `carteira`: SEMPRE completa (o app apaga localmente clientes que sairam).
   * - clientes, produtos, pedidos, pedido_itens, titulos, estoque, pedidos_app: DELTA
   *   (linhas novas ou alteradas; nunca vem remocao).
   * - precos_lista, precos_grupo, remessas: CONJUNTO COMPLETO, e so quando
   *   mudaram desde `since`. Se aparecerem em `completos`, o app SUBSTITUI o
   *   que tem localmente; se nao aparecerem, nada mudou.
   */
  @Get('pull')
  async pull(@VendedorLogado() v: Logado, @Query('since') since?: string) {
    if (since && Number.isNaN(Date.parse(since))) {
      throw new BadRequestException('since deve ser uma data ISO');
    }
    const desde = since ?? null;

    let rota = v.rota;
    if (!rota) {
      // primeiro acesso do vendedor: ainda nao sincronizamos a carteira dele
      rota = await this.sync.sincronizarCarteira(v.codVendedor);
      this.vendedores.invalidar(v.email);
    }

    const { data: vend } = await this.sb
      .from('vendedores')
      .select('nome')
      .eq('cod_vendedor', v.codVendedor)
      .maybeSingle();

    // cursor com a hora do banco (menos uma margem), nao a do servidor da API
    const cursor = await this.rpc<string>('fn_cursor_pull');

    const delta = { p_rota: rota, p_since: desde };
    const [carteira, clientes, produtos, pedidos, pedidoItens, titulos, estoque] = await Promise.all([
      this.sb.from('rota_clientes').select('cod_cliente, dia_semana, sequencia').eq('rota', rota).then(this.ok),
      this.rpcTodos('fn_clientes_da_rota', delta, ['cod_cliente']),
      this.rpcTodos('fn_produtos_delta', { p_since: desde }, ['cod_produto']),
      this.rpcTodos('fn_pedidos_da_rota', delta, ['ordem']),
      this.rpcTodos('fn_itens_pedidos_da_rota', delta, ['ordem', 'item']),
      this.rpcTodos('fn_titulos_da_rota', delta, ['cod_cliente', 'nfe', 'parcela']),
      this.rpcTodos('fn_estoque_da_rota', delta, ['centro', 'cod_produto']),
    ]);

    // pedidos criados no app por este vendedor (ultimos 90 dias): o app descobre aqui
    // o codigo definitivo, as ordens do SAP e o status mesmo depois de uma retentativa
    let qApp = this.sb
      .from('pedidos_app')
      .select('id, codigo, cod_cliente, status, ordens_sap, erro, dt_entrega, recebido_em, enviado_sap_em, tentativas, duplicado_de, updated_at, tipo, tipo_bonificacao, centro_custo, justificativa, motivo_rejeicao')
      .eq('cod_vendedor', v.codVendedor)
      .gte('recebido_em', new Date(Date.now() - 90 * 86_400_000).toISOString());
    if (desde) qApp = qApp.gt('updated_at', desde);
    const pedidosApp = this.ok(await qApp);

    // cadastros do painel (pequenos): vao inteiros em todo pull; o app substitui o que tem
    const hojeIso = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const [tiposBonificacao, centrosCusto, destaques, incentivosBrutos, feriados] = await Promise.all([
      this.sb.from('bonificacao_tipos').select('codigo, descricao').eq('ativo', true).order('codigo').then(this.ok),
      this.sb.from('centros_custo').select('codigo, descricao').eq('ativo', true).order('codigo').then(this.ok),
      this.sb.from('produto_destaques').select('cod_produto, destaque, lancamento, ordem').eq('ativo', true).order('ordem').then(this.ok),
      this.sb
        .from('incentivos_desconto')
        .select('id, cod_produto, escopo, escopo_valor, linha_id, grupo_id, categoria_id, marca, qtd_minima, desconto_pct, desconto_extra_max_pct, vigencia_ini, vigencia_fim')
        .eq('ativo', true)
        .then(this.ok),
      // feriados de hoje em diante (o app filtra os do estado/cidade de cada cliente)
      this.sb.from('feriados').select('data, descricao, uf, cidade').eq('ativo', true).gte('data', hojeIso).order('data').then(this.ok),
    ]);
    const incentivos = (incentivosBrutos as Array<{ escopo: string; escopo_valor: string | null; vigencia_ini: string | null; vigencia_fim: string | null }>).filter(
      (r) =>
        (!r.vigencia_ini || r.vigencia_ini <= hojeIso) &&
        (!r.vigencia_fim || r.vigencia_fim >= hojeIso) &&
        (r.escopo !== 'vendedor' || r.escopo_valor === v.codVendedor),
    );

    // perguntas da visita: as do vendedor logado e as gerais; escritorio/canal/cliente o app filtra pelo cliente visitado
    const perguntas = (
      (await this.sb
        .from('visita_perguntas')
        .select('id, texto, tipo, opcoes, obrigatoria, escopo, escopo_valor, ordem')
        .eq('ativo', true)
        .order('ordem')
        .then(this.ok)) as Array<{ escopo: string; escopo_valor: string | null }>
    ).filter((p) => p.escopo !== 'vendedor' || (p.escopo_valor ?? '').split(',').includes(v.codVendedor));

    // avisos do painel (pop-up no app): vigentes hoje e os do vendedor logado; escritorio/canal o app confere pelos clientes dele
    const avisos = (
      (await this.sb
        .from('avisos')
        .select('id, titulo, mensagem, nivel, escopo, escopo_valor, vigencia_ini, vigencia_fim, updated_at')
        .eq('ativo', true)
        .order('updated_at', { ascending: false })
        .limit(50)
        .then(this.ok)) as Array<{ escopo: string; escopo_valor: string | null; vigencia_ini: string | null; vigencia_fim: string | null }>
    ).filter(
      (a) =>
        (!a.vigencia_ini || a.vigencia_ini <= hojeIso) &&
        (!a.vigencia_fim || a.vigencia_fim >= hojeIso) &&
        (a.escopo !== 'vendedor' || (a.escopo_valor ?? '').split(',').includes(v.codVendedor)),
    );

    // visitas dos ultimos dias: o app reconhece a visita feita em outro aparelho e mostra a validacao do painel
    const desdeVisitas = new Date(Date.now() - 3 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const visitas = await this.sb
      .from('visitas')
      .select('id, cod_cliente, data_visita, status, checkin_em, checkin_lat, checkin_lng, checkin_precisao_m, checkin_gps_falso, distancia_m, fora_do_raio, sem_referencia, checkout_em, resultado, motivo_nao_venda, observacao, pedido_id, validacao, validacao_obs')
      .eq('cod_vendedor', v.codVendedor)
      .gte('data_visita', desdeVisitas)
      .order('data_visita')
      .then(this.ok);

    const resposta: Record<string, unknown> = {
      cursor,
      rota,
      vendedor: { cod: v.codVendedor, nome: vend?.nome ?? null, email: v.email },
      carteira,
      clientes,
      produtos,
      pedidos,
      pedidos_app: pedidosApp,
      pedido_itens: pedidoItens,
      titulos,
      estoque,
      tipos_bonificacao: tiposBonificacao,
      centros_custo: centrosCusto,
      destaques,
      incentivos,
      feriados,
      visitas,
      visita_perguntas: perguntas,
      avisos,
    };

    // conjuntos completos: so quando o sync correspondente rodou depois de `since`
    const completos: string[] = [];
    if (await this.mudou('precos', rota, desde)) {
      resposta.precos_lista = await this.rpcTodos('fn_precos_lista_da_rota', { p_rota: rota }, ['pltyp', 'cod_produto', 'datab']);
      resposta.precos_grupo = await this.rpcTodos('fn_precos_grupo_da_rota', { p_rota: rota }, ['pltyp', 'kdgrp', 'cod_produto', 'datab']);
      completos.push('precos_lista', 'precos_grupo');
    }
    if (await this.mudou('remessas', rota, desde)) {
      resposta.remessas = await this.rpcTodos('fn_remessas_da_rota', { p_rota: rota }, ['ordem', 'item', 'data_remessa']);
      completos.push('remessas');
    }
    // historico longo (12 meses): totais prontos, so quando houve sync de pedidos (ou a carga historica) desde o ultimo pull
    if ((await this.mudou('pedidos', rota, desde)) || (await this.mudou('historico', rota, desde))) {
      resposta.historico_mes = await this.rpcTodos('fn_historico_cliente_mes', { p_rota: rota, p_meses: 12 }, ['cod_cliente', 'mes']);
      resposta.historico_produto = await this.rpcTodos('fn_historico_cliente_produto', { p_rota: rota, p_meses: 12 }, ['cod_cliente', 'cod_produto']);
    }

    // parametros do painel que o app precisa conhecer (hoje: em que status o pedido pode ser cancelado)
    const { data: par } = await this.sb.from('parametros').select('chave, valor').in('chave', ['status_cancelaveis']);
    resposta.parametros = Object.fromEntries(((par ?? []) as Array<{ chave: string; valor: unknown }>).map((x) => [x.chave, x.valor]));

    resposta.completos = completos;

    return resposta;
  }

  /** Botao "sincronizar" do app: atualiza agora o operacional (no maximo 1x por minuto). */
  @Post('refresh')
  async refresh(@VendedorLogado() v: Logado) {
    const agora = Date.now();
    const ultimo = this.ultimoRefresh.get(v.codVendedor) ?? 0;
    if (agora - ultimo < REFRESH_MIN_INTERVALO_MS) {
      throw new HttpException('Aguarde um minuto para sincronizar de novo', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.ultimoRefresh.set(v.codVendedor, agora);

    const rota = await this.sync.sincronizarCarteira(v.codVendedor);
    this.vendedores.invalidar(v.email);
    const resultados = await this.sync.sincronizarOperacional(v.codVendedor, rota);

    return { rota, sincronizadoEm: new Date().toISOString(), resultados };
  }

  /**
   * Busca UMA ordem no SAP agora (cabecalho + itens) e devolve no formato do pull.
   * Usado logo depois de criar o pedido, para o vendedor ver como ficou sem esperar a proxima sincronizacao.
   */
  @Post('ordem/:ordem')
  async ordem(@VendedorLogado() v: Logado, @Param('ordem') ordem: string) {
    if (!/^\d{1,10}$/.test(ordem)) throw new BadRequestException('Numero de ordem invalido');
    let r;
    try {
      r = await this.sync.sincronizarOrdem(v.codVendedor, ordem);
    } catch (e) {
      throw new BadGatewayException(`SAP nao respondeu: ${(e as Error).message}`);
    }
    if (!r) throw new NotFoundException('Ordem ainda nao encontrada no SAP');
    return { pedido: r.pedido, itens: r.itens };
  }

  /** Houve sync bem-sucedido do recurso depois de `since`? (sem `since`: sempre) */
  private async mudou(recurso: string, escopo: string, since: string | null): Promise<boolean> {
    if (!since) return true;
    const { data, error } = await this.sb
      .from('sync_estado')
      .select('ultimo_sucesso')
      .eq('recurso', recurso)
      .eq('escopo', escopo)
      .maybeSingle();
    if (error) throw error;
    return !!data?.ultimo_sucesso && Date.parse(data.ultimo_sucesso) > Date.parse(since);
  }

  private async rpc<T = unknown[]>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  }

  /**
   * Funcoes que devolvem listas: o PostgREST entrega no maximo 1000 linhas por chamada (e sem avisar).
   * Le em paginas de 1000, em ordem estavel pela chave, ate acabar. Sem isso o app recebia so as
   * primeiras 1000 linhas e o cursor avancava, deixando o resto de fora para sempre.
   */
  private async rpcTodos(fn: string, args: Record<string, unknown>, ordem: string[]): Promise<unknown[]> {
    const PAGINA = 1000;
    const todos: unknown[] = [];
    for (let de = 0; ; de += PAGINA) {
      let q = this.sb.rpc(fn, args);
      for (const col of ordem) q = q.order(col);
      const { data, error } = await q.range(de, de + PAGINA - 1);
      if (error) throw new Error(`${fn}: ${error.message}`);
      const linhas = (data ?? []) as unknown[];
      todos.push(...linhas);
      if (linhas.length < PAGINA) return todos;
    }
  }

  private ok = ({ data, error }: { data: unknown; error: { message: string } | null }) => {
    if (error) throw new Error(error.message);
    return data;
  };
}
