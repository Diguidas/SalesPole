import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase/supabase.module';

type Corpo = Record<string, unknown>;

const ESCOPOS = ['geral', 'cliente', 'vendedor', 'canal', 'escritorio', 'lista_preco', 'equipe', 'tipo_estabelecimento'];
const ALVOS = ['produto', 'linha', 'grupo', 'categoria', 'marca'];
const erro = (m: string) => new UnprocessableEntityException(m);

const texto = (b: Corpo, c: string, rotulo: string, max: number, obrigatorio = false): string | null => {
  const v = b[c] == null ? '' : String(b[c]).trim();
  if (!v) {
    if (obrigatorio) throw erro(`${rotulo} e obrigatorio`);
    return null;
  }
  if (v.length > max) throw erro(`${rotulo} tem no maximo ${max} caracteres`);
  return v;
};

const numero = (v: unknown, rotulo: string, { min = 0, max = Infinity, obrigatorio = false } = {}): number | null => {
  if (v === '' || v == null) {
    if (obrigatorio) throw erro(`${rotulo} e obrigatorio`);
    return null;
  }
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw erro(`${rotulo} deve estar entre ${min} e ${max === Infinity ? 'o maximo' : max}`);
  return n;
};

const data = (b: Corpo, c: string, rotulo: string): string | null => {
  const v = b[c] == null ? '' : String(b[c]).trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw erro(`${rotulo} invalida (use AAAA-MM-DD)`);
  return v;
};

/** Cadastro de combos do painel (so admin altera; todos os usuarios do painel consultam). */
@Injectable()
export class CombosService {
  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {}

  /** Todos os combos (inclusive inativos) com os itens da condicao. */
  async listar() {
    const [c, i] = await Promise.all([
      this.sb.from('combos').select('*').order('updated_at', { ascending: false }).limit(1000),
      this.sb.from('combo_itens').select('*').limit(10000),
    ]);
    if (c.error) throw c.error;
    if (i.error) throw i.error;
    const itens = new Map<string, unknown[]>();
    for (const x of (i.data ?? []) as Array<{ combo_id: string }>) itens.set(x.combo_id, [...(itens.get(x.combo_id) ?? []), x]);
    return ((c.data ?? []) as Array<{ id: string }>).map((x) => ({ ...x, itens: itens.get(x.id) ?? [] }));
  }

  /** Cria (sem id) ou atualiza (com id) o combo e troca a lista de itens por inteiro. */
  async gravar(b: Corpo) {
    const escopo = texto(b, 'escopo', 'Para quem', 20) ?? 'geral';
    if (!ESCOPOS.includes(escopo)) throw erro('Escopo invalido');
    const escopoValor = texto(b, 'escopo_valor', 'Codigos', 400);
    if (escopo !== 'geral' && !escopoValor) throw erro('Informe o(s) codigo(s) do cliente, vendedor, canal, escritorio ou lista de preco');

    const beneficio = texto(b, 'beneficio', 'Beneficio', 20, true)!;
    if (!['produto_gratis', 'desconto_pct'].includes(beneficio)) throw erro('Beneficio invalido');
    const gratis = beneficio === 'produto_gratis';
    const brinde = gratis ? texto(b, 'brinde_cod_produto', 'Produto brinde', 40, true) : null;
    const brindeQtd = gratis ? numero(b.brinde_qtd, 'Quantidade do brinde', { min: 0.001, max: 99999, obrigatorio: true }) : null;
    const desconto = gratis ? null : numero(b.desconto_pct, 'Desconto %', { min: 0.01, max: 100, obrigatorio: true });
    // o brinde vira um pedido de bonificacao: precisa do tipo (ORD_REASON) e do centro de custo, dos cadastros do painel
    const tipoBonif = gratis ? texto(b, 'tipo_bonificacao', 'Tipo de bonificacao', 3, true) : null;
    const centroCusto = gratis ? texto(b, 'centro_custo', 'Centro de custo', 10, true) : null;
    if (gratis) {
      const [t, c] = await Promise.all([
        this.sb.from('bonificacao_tipos').select('codigo').eq('codigo', tipoBonif).eq('ativo', true).maybeSingle(),
        this.sb.from('centros_custo').select('codigo').eq('codigo', centroCusto).eq('ativo', true).maybeSingle(),
      ]);
      if (t.error) throw t.error;
      if (c.error) throw c.error;
      if (!t.data) throw erro('Tipo de bonificacao nao cadastrado ou inativo');
      if (!c.data) throw erro('Centro de custo nao cadastrado ou inativo');
    }

    const ini = data(b, 'vigencia_ini', 'Inicio da vigencia');
    const fim = data(b, 'vigencia_fim', 'Fim da vigencia');
    if (ini && fim && fim < ini) throw erro('O fim da vigencia e anterior ao inicio');

    const repete = b.repete === true || b.repete === 'true';
    const maxRep = repete ? numero(b.max_repeticoes, 'Maximo de repeticoes', { min: 1, max: 9999 }) : null;

    const itensBrutos = Array.isArray(b.itens) ? (b.itens as Corpo[]) : [];
    if (!itensBrutos.length) throw erro('Informe ao menos um item da condicao do combo');
    if (itensBrutos.length > 20) throw erro('No maximo 20 itens na condicao');
    const itens = itensBrutos.map((x, n) => {
      const alvo = String(x.alvo_tipo ?? '');
      if (!ALVOS.includes(alvo)) throw erro(`Item ${n + 1}: tipo invalido`);
      return {
        alvo_tipo: alvo,
        // varios materiais no mesmo item: codigos separados por virgula, sem repeticao
        alvo_valor: [...new Set(texto(x, 'alvo_valor', `Item ${n + 1}: valor`, 1000, true)!.split(/[,;]+/).map((v) => v.trim()).filter(Boolean))].join(','),
        qtd_minima: numero(x.qtd_minima, `Item ${n + 1}: quantidade minima`, { min: 0.001, max: 999999, obrigatorio: true })!,
      };
    });

    // faixas: degraus do beneficio pelo total de caixas da condicao (so combo sem repeticao)
    const faixasBrutas = Array.isArray(b.faixas) ? (b.faixas as Corpo[]) : [];
    if (faixasBrutas.length && repete) throw erro('Faixas nao valem em combo que se repete');
    if (faixasBrutas.length > 10) throw erro('No maximo 10 faixas');
    const faixas = faixasBrutas
      .map((x, n) => {
        const qtd = numero(x.qtd_minima, `Faixa ${n + 1}: quantidade minima`, { min: 0.001, max: 999999, obrigatorio: true })!;
        const pct = gratis ? null : numero(x.desconto_pct, `Faixa ${n + 1}: desconto %`, { min: 0.01, max: 100, obrigatorio: true });
        const qtdBrinde = gratis ? numero(x.brinde_qtd, `Faixa ${n + 1}: quantidade do brinde`, { min: 0.001, max: 99999, obrigatorio: true }) : null;
        return { qtd_minima: qtd, desconto_pct: pct, brinde_qtd: qtdBrinde };
      })
      .sort((a, c) => a.qtd_minima - c.qtd_minima);
    for (let i = 1; i < faixas.length; i++) if (faixas[i].qtd_minima === faixas[i - 1].qtd_minima) throw erro('Duas faixas com a mesma quantidade minima');

    const linha = {
      nome: texto(b, 'nome', 'Nome do combo', 80, true),
      escopo,
      escopo_valor: escopo === 'geral' ? null : [...new Set((escopoValor ?? '').split(/[,;\s]+/).filter(Boolean).map((x) => (escopo === 'vendedor' || escopo === 'cliente' ? x.replace(/^0+/, '') || '0' : x)))].join(','),
      beneficio,
      brinde_cod_produto: brinde,
      brinde_qtd: brindeQtd,
      tipo_bonificacao: tipoBonif,
      centro_custo: centroCusto,
      desconto_pct: desconto,
      desconto_extra_max_pct: gratis ? 0 : numero(b.desconto_extra_max_pct, 'Extra maximo %', { min: 0, max: 100 }) ?? 0,
      repete,
      max_repeticoes: maxRep,
      faixas,
      vigencia_ini: ini,
      vigencia_fim: fim,
      ativo: b.ativo == null ? true : b.ativo === true || b.ativo === 'true',
      updated_at: new Date().toISOString(),
    };

    const id = b.id ? String(b.id) : null;
    if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw erro('id invalido');
    const q = id ? this.sb.from('combos').update(linha).eq('id', id) : this.sb.from('combos').insert(linha);
    const { data: salvo, error: e1 } = await q.select('id').maybeSingle();
    if (e1) throw e1;
    if (!salvo) throw new NotFoundException('Combo nao encontrado');
    const comboId = (salvo as { id: string }).id;

    const { error: e2 } = await this.sb.from('combo_itens').delete().eq('combo_id', comboId);
    if (e2) throw e2;
    const { error: e3 } = await this.sb.from('combo_itens').insert(itens.map((x) => ({ ...x, combo_id: comboId })));
    if (e3) throw e3;
    return { id: comboId };
  }

  async ativar(id: string, ativo: boolean) {
    const { data: r, error: e } = await this.sb.from('combos').update({ ativo, updated_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle();
    if (e) throw e;
    if (!r) throw new NotFoundException('Combo nao encontrado');
    return { id, ativo };
  }
}
