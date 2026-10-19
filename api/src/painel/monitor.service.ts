import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { PedidosService } from '../pedidos/pedidos.service';
import { SUPABASE } from '../supabase/supabase.module';
import { UsuarioPainel } from './painel.guard';

/** Recursos que o cron atualiza a cada 15 min (seg-sab, 6h-21h); os demais rodam 1x por dia as 5h. */
const OPERACIONAIS = ['pedidos', 'titulos', 'remessas', 'estoque'];
const ATRASO_OPERACIONAL_MIN = 180;
const ATRASO_DIARIO_H = 30;
const MIN = 60_000;

type Linha = Record<string, any>;

/** Hora e dia da semana (0=dom) em Sao Paulo, onde roda a operacao. */
function agoraSp(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(d);
  const hora = Number(p.find((x) => x.type === 'hour')!.value) % 24;
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.find((x) => x.type === 'weekday')!.value);
  return { hora, dia };
}

/** Saude do sistema para o painel: sincronizacoes com o SAP, fila de pedidos e o que precisa de atencao. */
@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);

  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly pedidos: PedidosService,
  ) {}

  async visao(agora = new Date()) {
    const desde7 = new Date(agora.getTime() - 7 * 86_400_000).toISOString();
    const [sync, ped, cancel, bon, vis] = await Promise.all([
      this.sb.from('sync_estado').select('recurso, escopo, ultimo_sucesso, ultimo_erro, ultimo_erro_em').order('recurso'),
      this.sb
        .from('pedidos_app')
        .select('id, codigo, cod_vendedor, cod_cliente, tipo, status, erro, tentativas, proxima_tentativa_em, recebido_em, updated_at')
        .gte('recebido_em', desde7)
        .order('recebido_em', { ascending: false })
        .limit(5000),
      this.sb.from('pedido_cancelamentos').select('id, ordem, cod_vendedor, status_antes, motivo, resultado, http, mensagens, criado_em').gte('criado_em', desde7).order('criado_em', { ascending: false }).limit(200),
      this.sb.from('pedidos_app').select('id').eq('tipo', 'bonificacao').eq('status', 'aguardando_aprovacao').limit(1000),
      this.sb.from('visitas').select('id').eq('status', 'concluida').eq('validacao', 'pendente').limit(1000),
    ]);
    for (const r of [sync, ped, cancel, bon, vis]) if (r.error) throw r.error;

    // ---- sincronizacao com o SAP ----
    const { hora, dia } = agoraSp(agora);
    const horarioComercial = dia >= 1 && dia <= 6 && hora >= 7 && hora < 21;
    const sincs = ((sync.data ?? []) as Linha[]).map((s) => {
      const idadeMin = s.ultimo_sucesso ? Math.floor((agora.getTime() - Date.parse(s.ultimo_sucesso)) / MIN) : null;
      const erroRecente = !!s.ultimo_erro && (!s.ultimo_sucesso || Date.parse(s.ultimo_erro_em) > Date.parse(s.ultimo_sucesso));
      const operacional = OPERACIONAIS.includes(s.recurso);
      const atrasado =
        idadeMin === null ? true : operacional ? horarioComercial && idadeMin > ATRASO_OPERACIONAL_MIN : idadeMin > ATRASO_DIARIO_H * 60;
      return {
        recurso: s.recurso,
        escopo: s.escopo,
        operacional,
        ultimo_sucesso: s.ultimo_sucesso,
        idade_min: idadeMin,
        erro: erroRecente ? s.ultimo_erro : null,
        erro_em: erroRecente ? s.ultimo_erro_em : null,
        situacao: erroRecente ? 'erro' : atrasado ? 'atrasado' : 'ok',
      };
    });

    // ---- pedidos ----
    const lista = (ped.data ?? []) as Linha[];
    const porStatus: Record<string, number> = {};
    for (const p of lista) porStatus[p.status] = (porStatus[p.status] ?? 0) + 1;
    const agoraMs = agora.getTime();
    const problemas = lista
      .filter((p) => {
        if (p.status === 'erro' || p.status === 'parcial') return true;
        const parado = agoraMs - Date.parse(p.updated_at);
        return (p.status === 'recebido' && parado > 5 * MIN) || (p.status === 'enviando' && parado > 10 * MIN);
      })
      .slice(0, 100);

    const cods = [...new Set(problemas.map((p) => p.cod_cliente))];
    const vends = [...new Set([...problemas.map((p) => p.cod_vendedor), ...((cancel.data ?? []) as Linha[]).map((c) => c.cod_vendedor)])];
    const [cli, ven] = await Promise.all([
      cods.length ? this.sb.from('clientes').select('cod_cliente, nome_fantasia, razao_social').in('cod_cliente', cods) : Promise.resolve({ data: [], error: null }),
      vends.length ? this.sb.from('vendedores').select('cod_vendedor, nome').in('cod_vendedor', vends) : Promise.resolve({ data: [], error: null }),
    ]);
    if (cli.error) throw cli.error;
    if (ven.error) throw ven.error;
    const nCli = new Map(((cli.data ?? []) as Linha[]).map((c) => [c.cod_cliente, c.nome_fantasia || c.razao_social]));
    const nVen = new Map(((ven.data ?? []) as Linha[]).map((v) => [v.cod_vendedor, v.nome]));

    const cancelamentos = ((cancel.data ?? []) as Linha[])
      .filter((c) => c.resultado !== 'cancelado')
      .slice(0, 50)
      .map((c) => ({ ...c, vendedor: nVen.get(c.cod_vendedor) ?? null }));

    return {
      gerado_em: agora.toISOString(),
      resumo: {
        pedidos_com_problema: problemas.length,
        sincs_com_problema: sincs.filter((s) => s.situacao !== 'ok').length,
        bonificacoes_aguardando: (bon.data ?? []).length,
        visitas_pendentes: (vis.data ?? []).length,
      },
      sincs,
      pedidos_por_status: porStatus,
      pedidos_problema: problemas.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        tipo: p.tipo,
        status: p.status,
        erro: p.erro,
        tentativas: p.tentativas,
        proxima_tentativa_em: p.proxima_tentativa_em,
        recebido_em: p.recebido_em,
        parado_min: Math.floor((agoraMs - Date.parse(p.updated_at)) / MIN),
        vendedor: nVen.get(p.cod_vendedor) ?? null,
        cod_vendedor: p.cod_vendedor,
        cliente: nCli.get(p.cod_cliente) ?? null,
        cod_cliente: p.cod_cliente,
      })),
      cancelamentos_com_problema: cancelamentos,
    };
  }

  /** Reenvia ao SAP um pedido em 'erro' (depois de corrigir a causa). Registra no historico do pedido. */
  async reenviarPedido(u: UsuarioPainel, id: string) {
    const { data, error } = await this.sb.from('pedidos_app').select('id, status').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Pedido nao encontrado');
    if (data.status !== 'erro') throw new ConflictException(`O pedido esta em "${data.status}": so se reenvia pedido com erro`);

    await this.sb.from('pedido_eventos').insert({ pedido_id: id, tipo: 'reenvio_painel', detalhe: { por: u.email } });
    this.logger.log(`Reenvio do pedido ${id} pedido por ${u.email}`);
    const r = await this.pedidos.tentarEnviar(id, true);
    return { id, status: r.status, erro: r.erro ?? null };
  }
}
