import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
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
      .select('id, codigo, cod_cliente, status, ordens_sap, erro, dt_entrega, recebido_em, enviado_sap_em, tentativas, duplicado_de, updated_at')
      .eq('cod_vendedor', v.codVendedor)
      .gte('recebido_em', new Date(Date.now() - 90 * 86_400_000).toISOString());
    if (desde) qApp = qApp.gt('updated_at', desde);
    const pedidosApp = this.ok(await qApp);

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
