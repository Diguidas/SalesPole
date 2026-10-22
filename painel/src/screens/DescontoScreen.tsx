import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Cadastro } from './CadastroScreen';
import { CADASTROS } from './cadastros';
import { FONTE_DO_ESCOPO, useOpcoesEscopo } from '../opcoes';
import { FichasEscolha, SeletorMultiplo, nomesDe, type TipoSeletor } from './SeletorMultiplo';

interface Faixa { qtd_minima: number | string; desconto_pct: number | string | null; brinde_qtd: number | string | null }
interface ItemCombo { id?: string; alvo_tipo: string; alvo_valor: string; qtd_minima: number | string }
interface Combo {
  id: string; nome: string; escopo: string; escopo_valor: string | null; beneficio: 'produto_gratis' | 'desconto_pct';
  brinde_cod_produto: string | null; brinde_qtd: number | null; tipo_bonificacao: string | null; centro_custo: string | null; desconto_pct: number | null; desconto_extra_max_pct: number;
  repete: boolean; max_repeticoes: number | null; faixas: Faixa[]; vigencia_ini: string | null; vigencia_fim: string | null; ativo: boolean; itens: ItemCombo[];
}
type Form = Omit<Combo, 'id' | 'brinde_qtd' | 'desconto_pct' | 'desconto_extra_max_pct' | 'max_repeticoes'> & {
  id?: string; brinde_qtd: string; desconto_pct: string; desconto_extra_max_pct: string; max_repeticoes: string;
};

const ESCOPOS = [
  { v: 'geral', r: 'Todos' },
  { v: 'cliente', r: 'Cliente' },
  { v: 'vendedor', r: 'Vendedor' },
  { v: 'canal', r: 'Canal' },
  { v: 'escritorio', r: 'Escritório de vendas' },
  { v: 'lista_preco', r: 'Lista de preço' },
  { v: 'equipe', r: 'Equipe do vendedor' },
  { v: 'tipo_estabelecimento', r: 'Tipo de estabelecimento' },
];
const ALVOS = [
  { v: 'produto', r: 'Produto' },
  { v: 'marca', r: 'Marca' },
  { v: 'linha', r: 'Linha' },
  { v: 'grupo', r: 'Grupo' },
  { v: 'categoria', r: 'Categoria' },
];
const ROTULO_ALVO = Object.fromEntries(ALVOS.map((a) => [a.v, a.r.replace(' (ID)', '')]));
const ROTULO_ESCOPO = Object.fromEntries(ESCOPOS.map((e) => [e.v, e.r]));

const dataBR = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const num = (v: number | string | null | undefined) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));

const vazio = (): Form => ({
  nome: '', escopo: 'geral', escopo_valor: '', beneficio: 'produto_gratis', brinde_cod_produto: '', brinde_qtd: '1', tipo_bonificacao: '', centro_custo: '', desconto_pct: '', desconto_extra_max_pct: '0',
  repete: false, max_repeticoes: '', faixas: [], vigencia_ini: '', vigencia_fim: '', ativo: true, itens: [{ alvo_tipo: 'produto', alvo_valor: '', qtd_minima: '1' }],
});

const paraForm = (c: Combo): Form => ({
  ...c, escopo_valor: c.escopo_valor ?? '', brinde_cod_produto: c.brinde_cod_produto ?? '', tipo_bonificacao: c.tipo_bonificacao ?? '', centro_custo: c.centro_custo ?? '', brinde_qtd: c.brinde_qtd == null ? '1' : String(c.brinde_qtd),
  desconto_pct: c.desconto_pct == null ? '' : String(c.desconto_pct), desconto_extra_max_pct: String(c.desconto_extra_max_pct ?? 0),
  max_repeticoes: c.max_repeticoes == null ? '' : String(c.max_repeticoes), vigencia_ini: c.vigencia_ini ?? '', vigencia_fim: c.vigencia_fim ?? '',
  faixas: (c.faixas ?? []).map((x) => ({ qtd_minima: String(x.qtd_minima), desconto_pct: x.desconto_pct == null ? '' : String(x.desconto_pct), brinde_qtd: x.brinde_qtd == null ? '' : String(x.brinde_qtd) })),
  itens: c.itens.map((i) => ({ ...i, qtd_minima: String(i.qtd_minima) })),
});

/** Tela unica de descontos: incentivo por quantidade (aba Incentivo) e combos (aba Combo). */
export function DescontoScreen() {
  const [params, setParams] = useSearchParams();
  const aba = params.get('aba') === 'incentivo' ? 'incentivo' : 'combo';
  const trocar = (a: string) => setParams({ aba: a });
  return (
    <>
      <h1>Desconto</h1>
      <p className="sub">Regras de desconto do pedido: por quantidade de um produto (incentivo) ou pela composição do pedido (combo).</p>
      <div className="chips">
        <button className={`chip${aba === 'combo' ? ' ativo' : ''}`} onClick={() => trocar('combo')}>Combo</button>
        <button className={`chip${aba === 'incentivo' ? ' ativo' : ''}`} onClick={() => trocar('incentivo')}>Incentivo</button>
      </div>
      {aba === 'incentivo' ? <Cadastro def={CADASTROS.incentivos} /> : <ComboAba />}
    </>
  );
}

function resumoCondicao(c: Combo) {
  return c.itens.map((i) => {
    const valores = i.alvo_valor.split(',').filter(Boolean);
    return `${num(i.qtd_minima)} cx ${ROTULO_ALVO[i.alvo_tipo] ?? i.alvo_tipo} ${valores.length > 1 ? `(um de: ${valores.join(', ')})` : valores[0] ?? ''}`;
  }).join(' + ');
}
function resumoBeneficio(c: Combo) {
  const base = c.beneficio === 'produto_gratis' ? `Ganha ${num(c.brinde_qtd)} cx do produto ${c.brinde_cod_produto}` : `${num(c.desconto_pct)}% de desconto`;
  const faixas = (c.faixas ?? []).map((x) => `${num(x.qtd_minima)}+ cx: ${c.beneficio === 'produto_gratis' ? `${num(x.brinde_qtd)} cx` : `${num(x.desconto_pct)}%`}`).join(' · ');
  const texto = c.repete ? `${base} (repete${c.max_repeticoes ? `, até ${c.max_repeticoes}x` : ''})` : base;
  return faixas ? `${texto}; faixas ${faixas}` : texto;
}

function ComboAba() {
  const { usuario } = useAuth();
  const admin = usuario?.papel === 'admin';
  const [lista, setLista] = useState<Combo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [inativos, setInativos] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setLista(await api<Combo[]>('/painel/combos'));
    } catch (e) {
      setErro((e as Error).message);
      setLista([]);
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSalvando(true);
    setErro(null);
    try {
      await api('/painel/combos', { method: 'POST', body: form });
      setForm(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(c: Combo) {
    setErro(null);
    try {
      await api(`/painel/combos/${c.id}/ativo`, { method: 'POST', body: { ativo: !c.ativo } });
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  const visiveis = (lista ?? []).filter((c) => inativos || c.ativo);
  const qtdInativos = (lista ?? []).filter((c) => !c.ativo).length;

  return (
    <>
      <h2>Combos</h2>
      <p className="suave">O cliente ganha um brinde ou um desconto quando o pedido reúne os itens da condição. O vendedor vê o que foi aplicado e pode ajustar o desconto até o extra máximo do combo.</p>
      <div className="chips">
        {admin && <button className="btn ok" onClick={() => { setForm(vazio()); setErro(null); }}>+ Novo combo</button>}
        <button className={`chip${inativos ? ' ativo' : ''}`} onClick={() => setInativos((v) => !v)}>Mostrar inativos{qtdInativos ? ` (${qtdInativos})` : ''}</button>
        <button className="chip" onClick={carregar}>Atualizar</button>
      </div>
      {!admin && <p className="suave">Seu perfil só permite consultar.</p>}
      {erro && !form && <p className="erro-msg">{erro}</p>}

      {form && <FormCombo form={form} setForm={setForm} salvar={salvar} salvando={salvando} erro={erro} cancelar={() => setForm(null)} />}

      {lista === null && <div className="vazio">Carregando…</div>}
      {lista && visiveis.length === 0 && !erro && <div className="vazio">Nenhum combo cadastrado.</div>}
      {visiveis.length > 0 && (
        <table>
          <thead><tr><th>Combo</th><th>Condição</th><th>Benefício</th><th>Para quem</th><th>Vigência</th><th>Situação</th>{admin && <th />}</tr></thead>
          <tbody>
            {visiveis.map((c) => (
              <tr key={c.id} style={c.ativo ? undefined : { opacity: 0.55 }}>
                <td>{c.nome}</td>
                <td>{resumoCondicao(c)}</td>
                <td>{resumoBeneficio(c)}{c.desconto_extra_max_pct ? <div className="suave">vendedor pode dar +{num(c.desconto_extra_max_pct)}%</div> : null}</td>
                <td>{ROTULO_ESCOPO[c.escopo]}{c.escopo_valor ? `: ${c.escopo_valor}` : ''}</td>
                <td>{c.vigencia_ini || c.vigencia_fim ? `${dataBR(c.vigencia_ini) || '…'} a ${dataBR(c.vigencia_fim) || '…'}` : 'Sem limite'}</td>
                <td><span className={`selo ${c.ativo ? 'ok' : ''}`}>{c.ativo ? 'Ativo' : 'Inativo'}</span></td>
                {admin && (
                  <td>
                    <button className="btn" onClick={() => { setForm(paraForm(c)); setErro(null); }}>Editar</button>{' '}
                    <button className="btn" onClick={() => alternar(c)}>{c.ativo ? 'Desativar' : 'Reativar'}</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function FormCombo({ form, setForm, salvar, salvando, erro, cancelar }: {
  form: Form; setForm: (f: Form) => void; salvar: (e: FormEvent) => void; salvando: boolean; erro: string | null; cancelar: () => void;
}) {
  const [sugestoes, setSugestoes] = useState<Array<{ cod_produto: string; descricao: string }>>([]);
  const [buscaEm, setBuscaEm] = useState<string>('');
  const opcoes = useOpcoesEscopo();
  // painel de escolha multipla: qual campo esta aberto (item da condicao ou lista de preco do escopo)
  const [escolha, setEscolha] = useState<{ alvo: 'item' | 'escopo'; n: number; tipo: TipoSeletor; titulo: string; valor: string; fonte?: string } | null>(null);
  // cadastros que o brinde usa: ele vira um pedido de bonificacao automatico (tipo = ORD_REASON, centro de custo = KOSTL)
  const [tipos, setTipos] = useState<Array<{ codigo: string; descricao: string | null; ativo?: boolean }>>([]);
  const [centros, setCentros] = useState<Array<{ codigo: string; descricao: string | null; ativo?: boolean }>>([]);
  useEffect(() => {
    api<typeof tipos>('/painel/cadastros/tipos-bonificacao').then(setTipos).catch(() => undefined);
    api<typeof centros>('/painel/cadastros/centros-custo').then(setCentros).catch(() => undefined);
  }, []);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const setFaixa = (n: number, parte: Partial<Faixa>) => setForm({ ...form, faixas: form.faixas.map((x, i) => (i === n ? { ...x, ...parte } : x)) });
  const setItem = (n: number, parte: Partial<ItemCombo>) => setForm({ ...form, itens: form.itens.map((x, i) => (i === n ? { ...x, ...parte } : x)) });

  // sugestoes de produto (codigo ou parte do nome) para o brinde e para os itens do tipo produto
  useEffect(() => {
    if (buscaEm.trim().length < 2) return setSugestoes([]);
    let vivo = true;
    const t = setTimeout(() => {
      api<Array<{ cod_produto: string; descricao: string }>>(`/painel/produtos?q=${encodeURIComponent(buscaEm)}`)
        .then((r) => vivo && setSugestoes(r))
        .catch(() => vivo && setSugestoes([]));
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [buscaEm]);

  return (
    <form className="card" onSubmit={salvar}>
      <div className="titulo" style={{ marginBottom: 12 }}>{form.id ? 'Editar combo' : 'Novo combo'}</div>
      <datalist id="combo-produtos">{sugestoes.map((s) => <option key={s.cod_produto} value={s.cod_produto}>{s.descricao}</option>)}</datalist>

      <div className="form-grade">
        <label className="campo"><span>Nome do combo *</span><input type="text" required maxLength={80} value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Ex.: Frango + Linguiça ganha Hambúrguer" /></label>
        <label className="campo"><span>Para quem vale</span>
          <select value={form.escopo} onChange={(e) => set('escopo', e.target.value)}>{ESCOPOS.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}</select>
        </label>
        {FONTE_DO_ESCOPO[form.escopo] && (
          <div className="campo"><span>{ROTULO_ESCOPO[form.escopo]}(s) *</span>
            <button type="button" className="campo-escolha" onClick={() => setEscolha({ alvo: 'escopo', n: 0, tipo: 'opcoes', fonte: FONTE_DO_ESCOPO[form.escopo], titulo: `${ROTULO_ESCOPO[form.escopo]}: escolha uma ou mais opções`, valor: form.escopo_valor ?? '' })}>
              <FichasEscolha valor={form.escopo_valor ?? ''} vazio="Clique para escolher" nomes={nomesDe(opcoes?.[FONTE_DO_ESCOPO[form.escopo]])} />
            </button>
            <input tabIndex={-1} aria-hidden style={{ opacity: 0, height: 0, padding: 0, border: 0 }} required value={form.escopo_valor ?? ''} onChange={() => undefined} />
          </div>
        )}
        {form.escopo !== 'geral' && !FONTE_DO_ESCOPO[form.escopo] && (
          <label className="campo"><span>Código(s) do {ROTULO_ESCOPO[form.escopo].toLowerCase()} *</span>
            <input type="text" required maxLength={400} value={form.escopo_valor ?? ''} onChange={(e) => set('escopo_valor', e.target.value)} />
            <small className="suave">Vários códigos separados por vírgula.</small>
          </label>
        )}
        <label className="campo"><span>Início da vigência</span><input type="date" value={form.vigencia_ini ?? ''} onChange={(e) => set('vigencia_ini', e.target.value)} /></label>
        <label className="campo"><span>Fim da vigência</span><input type="date" value={form.vigencia_fim ?? ''} onChange={(e) => set('vigencia_fim', e.target.value)} /></label>
      </div>

      <h3 style={{ margin: '16px 0 8px' }}>Condição: o pedido precisa ter</h3>
      {form.itens.map((it, n) => (
        <div key={n} className="form-grade" style={{ marginBottom: 8, alignItems: 'end' }}>
          <label className="campo"><span>Tipo</span>
            <select value={it.alvo_tipo} onChange={(e) => setItem(n, { alvo_tipo: e.target.value, alvo_valor: '' })}>{ALVOS.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}</select>
          </label>
          <div className="campo"><span>{ROTULO_ALVO[it.alvo_tipo]}(s) — qualquer um destes *</span>
            <button type="button" className="campo-escolha" onClick={() => setEscolha({ alvo: 'item', n, tipo: it.alvo_tipo === 'produto' ? 'produto' : 'opcoes', fonte: it.alvo_tipo, titulo: `Escolha ${ROTULO_ALVO[it.alvo_tipo].toLowerCase()}(s) da condição`, valor: it.alvo_valor })}>
              <FichasEscolha valor={it.alvo_valor} vazio="Clique para escolher" nomes={it.alvo_tipo === 'produto' ? undefined : nomesDe(opcoes?.[it.alvo_tipo])} />
            </button>
            <input tabIndex={-1} aria-hidden style={{ opacity: 0, height: 0, padding: 0, border: 0 }} required value={it.alvo_valor} onChange={() => undefined} />
          </div>
          <label className="campo"><span>Quantidade mínima (caixas) *</span>
            <input type="text" inputMode="decimal" required value={String(it.qtd_minima)} onChange={(e) => setItem(n, { qtd_minima: e.target.value })} />
          </label>
          <div>{form.itens.length > 1 && <button type="button" className="btn" onClick={() => setForm({ ...form, itens: form.itens.filter((_, i) => i !== n) })}>Remover</button>}</div>
        </div>
      ))}
      {form.itens.length < 20 && <button type="button" className="btn" onClick={() => setForm({ ...form, itens: [...form.itens, { alvo_tipo: 'produto', alvo_valor: '', qtd_minima: '1' }] })}>+ Item da condição</button>}

      <h3 style={{ margin: '16px 0 8px' }}>Benefício: o cliente ganha</h3>
      <div className="form-grade">
        <label className="campo"><span>Tipo de benefício</span>
          <select value={form.beneficio} onChange={(e) => set('beneficio', e.target.value as Form['beneficio'])}>
            <option value="produto_gratis">Produto grátis</option>
            <option value="desconto_pct">Desconto (%) nos itens da condição</option>
          </select>
        </label>
        {form.beneficio === 'produto_gratis' ? (
          <>
            <label className="campo"><span>Produto brinde *</span>
              <input type="text" required maxLength={40} list="combo-produtos" value={form.brinde_cod_produto ?? ''} onChange={(e) => { set('brinde_cod_produto', e.target.value); setBuscaEm(e.target.value); }} placeholder="Código ou parte do nome" />
            </label>
            <label className="campo"><span>Quantidade do brinde (caixas) *</span><input type="text" inputMode="decimal" required value={form.brinde_qtd} onChange={(e) => set('brinde_qtd', e.target.value)} /></label>
            <label className="campo"><span>Tipo de bonificação *</span>
              <select required value={form.tipo_bonificacao ?? ''} onChange={(e) => set('tipo_bonificacao', e.target.value)}>
                <option value="">Selecione…</option>
                {tipos.filter((t) => t.ativo !== false).map((t) => <option key={t.codigo} value={t.codigo}>{t.codigo} · {t.descricao}</option>)}
              </select>
            </label>
            <label className="campo"><span>Centro de custo *</span>
              <select required value={form.centro_custo ?? ''} onChange={(e) => set('centro_custo', e.target.value)}>
                <option value="">Selecione…</option>
                {centros.filter((c) => c.ativo !== false).map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.descricao}</option>)}
              </select>
              <small className="suave">O brinde sai como pedido de bonificação automático, com esse tipo e centro de custo.</small>
            </label>
          </>
        ) : (
          <label className="campo"><span>Desconto (%) *</span><input type="text" inputMode="decimal" required value={form.desconto_pct} onChange={(e) => set('desconto_pct', e.target.value)} /></label>
        )}
        {form.beneficio === 'desconto_pct' && (
          <label className="campo"><span>Extra máximo do vendedor (%)</span>
            <input type="text" inputMode="decimal" value={form.desconto_extra_max_pct} onChange={(e) => set('desconto_extra_max_pct', e.target.value)} />
            <small className="suave">Quanto o vendedor pode dar além do combo. 0 = nenhum.</small>
          </label>
        )}
        <label className="campo campo-check"><input type="checkbox" checked={form.repete} onChange={(e) => set('repete', e.target.checked)} />Repete a cada combo completo</label>
        {form.repete && (
          <label className="campo"><span>Máximo de repetições</span><input type="text" inputMode="numeric" value={form.max_repeticoes} onChange={(e) => set('max_repeticoes', e.target.value.replace(/\D/g, ''))} /><small className="suave">Vazio = sem limite.</small></label>
        )}
      </div>

      {!form.repete && (
        <>
          <h3 style={{ margin: '16px 0 4px' }}>Faixas (opcional)</h3>
          <p className="suave" style={{ margin: '0 0 8px' }}>O benefício sobe conforme o total de caixas dos itens da condição. Sem faixa atingida vale o benefício acima.</p>
          {form.faixas.map((fx, n) => (
            <div key={n} className="form-grade" style={{ marginBottom: 8, alignItems: 'end' }}>
              <label className="campo"><span>A partir de (caixas) *</span>
                <input type="text" inputMode="decimal" required value={String(fx.qtd_minima)} onChange={(e) => setFaixa(n, { qtd_minima: e.target.value })} />
              </label>
              {form.beneficio === 'produto_gratis' ? (
                <label className="campo"><span>Brinde (caixas) *</span>
                  <input type="text" inputMode="decimal" required value={String(fx.brinde_qtd ?? '')} onChange={(e) => setFaixa(n, { brinde_qtd: e.target.value })} />
                </label>
              ) : (
                <label className="campo"><span>Desconto (%) *</span>
                  <input type="text" inputMode="decimal" required value={String(fx.desconto_pct ?? '')} onChange={(e) => setFaixa(n, { desconto_pct: e.target.value })} />
                </label>
              )}
              <div><button type="button" className="btn" onClick={() => setForm({ ...form, faixas: form.faixas.filter((_, i) => i !== n) })}>Remover</button></div>
            </div>
          ))}
          {form.faixas.length < 10 && <button type="button" className="btn" onClick={() => setForm({ ...form, faixas: [...form.faixas, { qtd_minima: '', desconto_pct: '', brinde_qtd: '' }] })}>+ Faixa</button>}
        </>
      )}

      {escolha && (
        <SeletorMultiplo
          titulo={escolha.titulo} tipo={escolha.tipo} valor={escolha.valor} opcoes={escolha.fonte && opcoes ? opcoes[escolha.fonte] ?? [] : null} aoFechar={() => setEscolha(null)}
          aoConfirmar={(csv) => {
            if (escolha.alvo === 'escopo') set('escopo_valor', csv);
            else setItem(escolha.n, { alvo_valor: csv });
            setEscolha(null);
          }}
        />
      )}

      {erro && <p className="erro-msg">{erro}</p>}
      <div className="chips" style={{ marginTop: 12 }}>
        <button className="btn ok" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        <button className="btn" type="button" onClick={cancelar}>Cancelar</button>
      </div>
    </form>
  );
}
