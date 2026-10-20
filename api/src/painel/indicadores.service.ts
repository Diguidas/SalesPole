import { BadGatewayException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod } from '../auth/vendedores.service';
import { SUPABASE } from '../supabase/supabase.module';
import { RodadaIndicadores, SyncService } from '../sync/sync.service';

type Linha = Record<string, any>;
interface Grupo { chave: string; rotulo: string; valor: number; pedidos: number; clientes: number }

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const hojeSp = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** Indicadores gerenciais (vendas em R$ por mes, vendedor, escritorio e canal) e a escolha de quais vendedores entram. */
@Injectable()
export class IndicadoresService {
  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly sync: SyncService,
  ) {}

  // ---------------- vendedores ----------------

  /** Todos os vendedores conhecidos, com a marcacao de indicadores, se usam o app e quando os pedidos foram atualizados. */
  async vendedores() {
    const [ven, app, est] = await Promise.all([
      this.sb.from('vendedores').select('cod_vendedor, nome, rota, indicadores').order('nome').limit(5000),
      this.sb.from('usuarios_vendedor').select('email, cod_vendedor, ativo').order('email').limit(5000),
      this.sb.from('sync_estado').select('escopo, ultimo_sucesso, ultimo_erro, ultimo_erro_em').eq('recurso', 'pedidos').limit(5000),
    ]);
    for (const r of [ven, app, est]) if (r.error) throw r.error;
    // logins do app por vendedor (um vendedor pode ter mais de um e-mail)
    const acessos = new Map<string, Array<{ email: string; ativo: boolean }>>();
    for (const u of (app.data ?? []) as Linha[]) {
      const cod = normCod(u.cod_vendedor);
      acessos.set(cod, [...(acessos.get(cod) ?? []), { email: u.email, ativo: u.ativo === true }]);
    }
    const porRota = new Map(((est.data ?? []) as Linha[]).map((e) => [e.escopo, e]));

    // quem tem login mas ainda nao foi sincronizado nao esta em `vendedores`: entra na lista mesmo assim
    const base = [...((ven.data ?? []) as Linha[])];
    const conhecidos = new Set(base.map((v) => v.cod_vendedor as string));
    for (const cod of acessos.keys()) if (!conhecidos.has(cod)) base.push({ cod_vendedor: cod, nome: null, rota: null, indicadores: false });

    return base.map((v) => {
      const e = v.rota ? porRota.get(v.rota) : undefined;
      const erro = !!e?.ultimo_erro && (!e.ultimo_sucesso || Date.parse(e.ultimo_erro_em) > Date.parse(e.ultimo_sucesso));
      return {
        cod_vendedor: v.cod_vendedor,
        nome: v.nome,
        rota: v.rota,
        indicadores: v.indicadores === true,
        acessos: acessos.get(normCod(v.cod_vendedor)) ?? [],
        usa_app: (acessos.get(normCod(v.cod_vendedor)) ?? []).some((a) => a.ativo),
        pedidos_atualizados_em: e?.ultimo_sucesso ?? null,
        erro: erro ? e!.ultimo_erro : null,
      };
    });
  }

  /** Traz do SAP a lista de vendedores (cadastro); quem entra nos indicadores continua sendo escolha do administrador. */
  async importar() {
    try {
      return await this.sync.importarVendedores();
    } catch (e) {
      throw new BadGatewayException(`SAP nao respondeu: ${(e as Error).message}`);
    }
  }

  /** Botao "Sincronizar agora": comeca a rodada em segundo plano; o painel acompanha por `andamento()`. */
  sincronizarAgora(): RodadaIndicadores {
    return this.sync.iniciarSincronizacaoMarcados();
  }

  /** Andamento em memoria (rapido, so desta API). */
  andamento(): RodadaIndicadores {
    return this.sync.rodadaIndicadores;
  }

  /** Andamento para o painel: sobrevive a reinicio da API (e avisa quando uma rodada foi interrompida). */
  andamentoCompleto(): Promise<RodadaIndicadores> {
    return this.sync.andamentoRodada();
  }

  async marcar(codigos: unknown, ativo: boolean) {
    if (!Array.isArray(codigos) || codigos.length === 0) throw new UnprocessableEntityException('Informe os vendedores');
    if (codigos.length > 2000) throw new UnprocessableEntityException('Vendedores demais de uma vez');
    const lista = [...new Set(codigos.map((c) => normCod(String(c))))];
    const { data, error } = await this.sb.from('vendedores').update({ indicadores: ativo }).in('cod_vendedor', lista).select('cod_vendedor');
    if (error) throw error;
    return { alterados: (data ?? []).length };
  }

  // ---------------- indicadores ----------------

  /**
   * Vendas do periodo (padrao: ultimos 12 meses) em R$, sem pedidos recusados, por mes, vendedor (rota),
   * escritorio e canal. `clientes` e a positivacao: clientes distintos que compraram no recorte.
   */
  async vendas(ini?: string, fim?: string) {
    if ((ini && !DIA.test(ini)) || (fim && !DIA.test(fim))) throw new UnprocessableEntityException('datas devem ser AAAA-MM-DD');
    const hoje = hojeSp();
    const dFim = fim || hoje;
    // padrao: do primeiro dia do mes de 11 meses atras ate hoje (12 meses, o atual incluso)
    const [ano, mesAtual] = hoje.split('-').map(Number);
    const base = ano * 12 + (mesAtual - 1) - 11;
    const dIni = ini || `${Math.floor(base / 12)}-${String((base % 12) + 1).padStart(2, '0')}-01`;
    if (dIni > dFim) throw new UnprocessableEntityException('O inicio e depois do fim');

    // as quatro visoes numa so consulta (quatro em paralelo se atrapalhavam e estouravam o timeout do banco)
    const { data: vendas, error: eVendas } = await this.sb.rpc('fn_indicadores_vendas_todas', { p_ini: dIni, p_fim: dFim });
    if (eVendas) throw new Error(`fn_indicadores_vendas_todas: ${eVendas.message}`);
    const consulta = (dim: string): Grupo[] =>
      ((vendas ?? []) as Linha[]).filter((x) => x.dim === dim).map((x) => ({ chave: x.chave ?? '', rotulo: x.rotulo ?? '', valor: Number(x.valor), pedidos: Number(x.pedidos), clientes: Number(x.clientes) }));
    const [mes, rota, escritorio, canal] = [consulta('mes'), consulta('rota'), consulta('escritorio'), consulta('canal')];
    const [cart, ven] = await Promise.all([
      this.sb.rpc('fn_indicadores_carteira'),
      this.sb.from('vendedores').select('cod_vendedor, nome, rota').limit(5000),
    ]);
    if (cart.error) throw new Error(`fn_indicadores_carteira: ${cart.error.message}`);
    if (ven.error) throw ven.error;

    const tamanho = new Map(((cart.data ?? []) as Linha[]).map((c) => [c.rota, Number(c.clientes)]));
    const nomes = new Map<string, string[]>();
    for (const v of (ven.data ?? []) as Linha[]) if (v.rota && v.nome) nomes.set(v.rota, [...(nomes.get(v.rota) ?? []), v.nome]);

    const total = rota.reduce((a, g) => ({ valor: a.valor + g.valor, pedidos: a.pedidos + g.pedidos, clientes: a.clientes + g.clientes }), { valor: 0, pedidos: 0, clientes: 0 });
    const carteira = [...tamanho.values()].reduce((a, n) => a + n, 0);

    const ordenar = (l: Grupo[]) => [...l].sort((a, b) => b.valor - a.valor);
    return {
      periodo: { ini: dIni, fim: dFim },
      total: { ...total, vendedores_com_vendas: rota.length, vendedores_na_base: nomes.size || tamanho.size, ticket_medio: total.pedidos ? total.valor / total.pedidos : 0, carteira, positivacao_pct: carteira ? (total.clientes / carteira) * 100 : null },
      por_mes: [...mes].sort((a, b) => a.chave.localeCompare(b.chave)),
      por_escritorio: ordenar(escritorio),
      por_canal: ordenar(canal),
      por_vendedor: ordenar(rota).map((g) => ({
        ...g,
        rotulo: nomes.get(g.chave)?.join(' / ') || `Rota ${g.chave}`,
        carteira: tamanho.get(g.chave) ?? 0,
        positivacao_pct: tamanho.get(g.chave) ? (g.clientes / tamanho.get(g.chave)!) * 100 : null,
      })),
    };
  }
}
