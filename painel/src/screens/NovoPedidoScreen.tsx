import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Foto, ProdutoPopup, type ProdutoLinha } from './ProdutoPopup';


interface Vendedor { cod_vendedor: string; nome: string | null; rota: string }
interface Cliente { cod_cliente: string; nome: string | null; bloqueado: boolean; pedido_minimo: number | null; pagamento_antecipado: boolean }
interface ProdutoCat {
  cod_produto: string; descricao: string; unidade: string; unidade_texto: string;
  preco_tabela: number | null; desconto_max: number; estoque_cx: number | null; disponivel: boolean;
  origem: 'busca' | 'destaque' | 'lancamento' | 'comprou' | null;
  /** so no catalogo completo: o centro do cliente tem estoque e este produto tem menos de 1 caixa */
  sem_estoque?: boolean;
}
interface Item { produto: string; descricao: string; unidade: string; unidade_texto: string; quantidade: string; desconto_manual: string; estoque_cx: number | null }
interface CotItem {
  /** proxima faixa do incentivo que da mais desconto: "faltam N cx para X%" */
  proxima_faixa?: { qtd_minima: number; desconto_pct: number; extra_max_pct: number; falta: number } | null;
  produto: string; erro?: string; aviso?: string; preco_tabela: number | null; desconto_auto?: number; desconto_manual?: number; desconto_manual_max?: number;
  desconto_total?: number; origem_desconto?: 'combo' | 'incentivo' | null; preco_final?: number; subtotal?: number; incentivo?: { qtd_minima: number; desconto_pct: number; extra_max_pct: number } | null;
}
interface BrindeCot { produto: string; descricao: string; unidade: string; unidade_texto: string; quantidade: number; combo_id: string | null; combos: string[] }
interface BrindeCombo { produto: string; descricao: string | null; quantidade: number }
/** Combos do carrinho: os que ja fecham e os que o pedido ja comeca a formar (com o que falta). */
interface ComboCot {
  aplicados: Array<{ id: string; nome: string; vezes: number; desconto_pct: number | null; brinde: BrindeCombo | null }>;
  incompletos: Array<{ id: string; nome: string; beneficio: string; desconto_pct: number | null; brinde: BrindeCombo | null; faltas: Array<{ alvo_tipo: string; alvo_valor: string; alvo_descricao: string | null; falta: number }> }>;
}
interface Cotacao { itens: CotItem[]; total: number; pedido_minimo: number | null; brindes?: BrindeCot[]; combos?: ComboCot }
interface Cad { codigo: string; descricao: string; ativo: boolean }
/** Sugestoes do cliente (GET /painel/pedido-novo/sugestoes): produtos que passaram do ritmo de compra e combos que ele quase fecha. */
interface Reposicao { cod_produto: string; descricao: string | null; intervalo_dias: number; dias_desde: number; quantidade_tipica: number; unidade: string | null; produto: ProdutoCat }
interface ComboFechar {
  id: string; nome: string; beneficio: string; desconto_pct: number | null;
  brinde: { cod_produto: string; descricao: string; quantidade: number } | null;
  faltas: Array<{ alvo_tipo: string; alvo_valor: string; falta: number }>;
}
interface Sugestoes { reposicao: Reposicao[]; combos: ComboFechar[] }
const ROTULO_ALVO: Record<string, string> = { produto: 'do produto', marca: 'da marca', linha: 'da linha', grupo: 'do grupo', categoria: 'da categoria' };
interface Resultado {
  id: string | null; status: string; codigo?: string; ordens?: Array<{ ordem: string }>; erros?: string[]; erro?: string | null;
  dt_entrega?: string | null; possivel_duplicidade?: unknown[];
}

const moeda = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const numero = (v: string) => Number(String(v).replace(',', '.'));
const qfmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString('pt-BR');
const ROTULO_ORIGEM: Record<string, string> = { destaque: 'Destaque', lancamento: 'Lançamento', comprou: 'Comprou nos últimos 90 dias' };

/** Cartao de um produto do catalogo: foto, nome (abre o pop-up com os dados), preco, estoque e o botao de adicionar. */
function CartaoProduto({ p, ja, adicionar, abrir }: { p: ProdutoCat; ja: Item | undefined; adicionar: (p: ProdutoCat) => void; abrir: (cod: string) => void }) {
  const semEstoque = p.sem_estoque ?? (p.estoque_cx != null && p.estoque_cx < 1);
  return (
    <div className={`prod-card${ja ? ' no-pedido' : ''}${p.disponivel && !semEstoque ? '' : ' indisponivel'}`}>
      <Foto cod={p.cod_produto} tamanho={64} />
      <div className="prod-info">
        <button className="link-prod prod-nome" onClick={() => abrir(p.cod_produto)} title="Ver preço, descontos, histórico e ficha do produto">{p.descricao}</button>
        <div className="suave">
          Cód. {p.cod_produto} · {p.preco_tabela ? `${moeda(p.preco_tabela)}/${p.unidade_texto}` : 'sem preço de tabela'}
          {p.estoque_cx != null ? ` · estoque ${Math.floor(p.estoque_cx).toLocaleString('pt-BR')} ${p.unidade_texto}` : ''}
        </div>
        <div className="prod-selos">
          {p.origem && ROTULO_ORIGEM[p.origem] && <span className="selo ok">{ROTULO_ORIGEM[p.origem]}</span>}
          {semEstoque && <span className="selo aviso">Sem estoque</span>}
          {!p.disponivel && <span className="selo erro">Indisponível para este cliente</span>}
        </div>
      </div>
      {p.disponivel && (
        <button className={`mais${ja ? ' verde' : ''}`} onClick={() => adicionar(p)} title="Adicionar ao pedido">
          <Plus size={20} strokeWidth={2.4} />
          {ja && <span className="mais-qtd">{ja.quantidade}</span>}
        </button>
      )}
    </div>
  );
}

/** Pedido em nome de um vendedor, como a tela do app: catalogo com fotos a esquerda e o resumo do pedido a direita. */
export function NovoPedidoScreen() {
  const [params] = useSearchParams();
  const { usuario } = useAuth();
  const [tipo, setTipo] = useState<'venda' | 'bonificacao'>('venda');
  const [tiposBon, setTiposBon] = useState<Cad[]>([]);
  const [centros, setCentros] = useState<Cad[]>([]);
  const [tipoBon, setTipoBon] = useState('');
  const [centro, setCentro] = useState('');
  const [justificativa, setJustificativa] = useState('');

  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [buscaVend, setBuscaVend] = useState('');
  const [vendedor, setVendedor] = useState<Vendedor | null>(null);

  const [buscaCli, setBuscaCli] = useState('');
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [carregandoCarteira, setCarregandoCarteira] = useState(false);
  const [erroCarteira, setErroCarteira] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [buscandoClientes, setBuscandoClientes] = useState(false);

  const [buscaProd, setBuscaProd] = useState('');
  const [catalogo, setCatalogo] = useState<ProdutoCat[]>([]);
  const [, setCarregandoCat] = useState(false);
  const [itens, setItens] = useState<Item[]>([]);
  const [cot, setCot] = useState<Cotacao | null>(null);
  const [sug, setSug] = useState<Sugestoes | null>(null);
  const [popup, setPopup] = useState<string | null>(null); // produto aberto no pop-up
  const [todos, setTodos] = useState<ProdutoCat[]>([]);
  const [proximoTodos, setProximoTodos] = useState<number | null>(null);
  const [carregandoTodos, setCarregandoTodos] = useState(false);
  const [mostrarIndisp, setMostrarIndisp] = useState(false);

  const [observacao, setObservacao] = useState('');
  const [oc, setOc] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  // veio da pagina do cliente (?vendedor=&cliente=): ja deixa os dois escolhidos
  useEffect(() => {
    const cv = params.get('vendedor') ?? (usuario?.papel === 'vendedor' ? vendedores[0]?.cod_vendedor ?? null : null);
    const cc = params.get('cliente');
    if (!cv || vendedor || vendedores.length === 0) return;
    const v = vendedores.find((x) => x.cod_vendedor === cv.replace(/^0+/, ''));
    if (!v) return;
    setVendedor(v);
    if (cc) {
      api<{ clientes: Cliente[] }>(`/painel/pedido-novo/clientes?vendedor=${v.cod_vendedor}&q=${encodeURIComponent(cc)}`)
        .then((r) => {
          const achado = r.clientes.find((x) => x.cod_cliente === cc.replace(/^0+/, ''));
          if (achado) setCliente(achado);
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendedores]);

  // vendedor no computador: a lista so tem ele, entao ja fica escolhido
  useEffect(() => {
    if (usuario?.papel === 'vendedor' && vendedores.length === 1 && !vendedor) setVendedor(vendedores[0]);
  }, [vendedores]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api<Vendedor[]>('/painel/pedido-novo/vendedores').then(setVendedores).catch((e) => setErro((e as Error).message));
    api<Cad[]>('/painel/cadastros/tipos-bonificacao').then((l) => setTiposBon(l.filter((x) => x.ativo))).catch(() => undefined);
    api<Cad[]>('/painel/cadastros/centros-custo').then((l) => setCentros(l.filter((x) => x.ativo))).catch(() => undefined);
  }, []);

  // clientes da carteira do vendedor; se a carteira ainda nao foi baixada do SAP, busca so a dele
  useEffect(() => {
    if (!vendedor || cliente || carregandoCarteira || erroCarteira) return;
    let vivo = true;
    setBuscandoClientes(true);
    const t = setTimeout(async () => {
      try {
        const url = `/painel/pedido-novo/clientes?vendedor=${vendedor.cod_vendedor}&q=${encodeURIComponent(buscaCli)}`;
        let r = await api<{ carteira_carregada: boolean; clientes: Cliente[] }>(url);
        if (!vivo) return;
        if (!r.carteira_carregada) {
          setCarregandoCarteira(true);
          try {
            await api('/painel/pedido-novo/carteira', { method: 'POST', body: { vendedor: vendedor.cod_vendedor } });
          } catch (e) {
            if (vivo) setErroCarteira((e as Error).message);
            return;
          } finally {
            if (vivo) setCarregandoCarteira(false);
          }
          if (!vivo) return;
          r = await api(url);
        }
        if (vivo) setClientes(r.clientes);
      } catch (e) {
        if (vivo) setErro((e as Error).message);
      } finally {
        if (vivo) setBuscandoClientes(false);
      }
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [vendedor, cliente, buscaCli, carregandoCarteira, erroCarteira, tentativa]);

  // catalogo do cliente: destaques e o que ele comprou; com busca, por nome ou codigo
  useEffect(() => {
    if (!cliente) {
      setCatalogo([]);
      return;
    }
    let vivo = true;
    setCarregandoCat(true);
    const t = setTimeout(() => {
      api<ProdutoCat[]>(`/painel/pedido-novo/produtos?cliente=${cliente.cod_cliente}&q=`)
        .then((r) => vivo && setCatalogo(r))
        .catch((e) => vivo && setErro((e as Error).message))
        .finally(() => vivo && setCarregandoCat(false));
    }, 0);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [cliente]);

  // catalogo completo do cliente (so o que da para vender), com busca e em paginas
  useEffect(() => {
    setTodos([]);
    setProximoTodos(null);
    if (!cliente) return;
    let vivo = true;
    setCarregandoTodos(true);
    const t = setTimeout(() => {
      api<{ itens: ProdutoCat[]; proximo: number | null }>(`/painel/pedido-novo/catalogo?cliente=${cliente.cod_cliente}&q=${encodeURIComponent(buscaProd.trim())}${mostrarIndisp ? '&todos=1' : ''}`)
        .then((r) => { if (vivo) { setTodos(r.itens); setProximoTodos(r.proximo); } })
        .catch((e) => vivo && setErro((e as Error).message))
        .finally(() => vivo && setCarregandoTodos(false));
    }, buscaProd ? 300 : 0);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [cliente, buscaProd, mostrarIndisp]);

  async function maisTodos() {
    if (!cliente || proximoTodos == null) return;
    setCarregandoTodos(true);
    try {
      const r = await api<{ itens: ProdutoCat[]; proximo: number | null }>(`/painel/pedido-novo/catalogo?cliente=${cliente.cod_cliente}&q=${encodeURIComponent(buscaProd.trim())}${mostrarIndisp ? '&todos=1' : ''}&inicio=${proximoTodos}`);
      setTodos((l) => [...l, ...r.itens.filter((x) => !l.some((y) => y.cod_produto === x.cod_produto))]);
      setProximoTodos(r.proximo);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregandoTodos(false);
    }
  }

  // cotacao (preco de tabela, incentivo e total) sempre que muda produto, quantidade ou desconto
  const chaveItens = JSON.stringify(itens.map((i) => [i.produto, i.quantidade, i.desconto_manual]));
  useEffect(() => {
    if (!vendedor || !cliente || itens.length === 0) {
      setCot(null);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      api<Cotacao>('/painel/pedido-novo/cotar', {
        method: 'POST',
        body: { vendedor: vendedor.cod_vendedor, cliente: cliente.cod_cliente, tipo, itens: itens.map((i) => ({ produto: i.produto, quantidade: i.quantidade, desconto_manual: tipo === 'venda' ? i.desconto_manual : '' })) },
      })
        .then((r) => vivo && setCot(r))
        .catch(() => vivo && setCot(null));
    }, 350);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendedor, cliente, chaveItens, tipo]);

  const vendedoresVisiveis = useMemo(() => {
    const q = buscaVend.trim().toLowerCase();
    return vendedores.filter((v) => !q || v.cod_vendedor.includes(q) || (v.nome ?? '').toLowerCase().includes(q)).slice(0, 8);
  }, [vendedores, buscaVend]);

  // sugestoes do cliente escolhido: o que passou do ritmo de compra dele e os combos que ele quase fecha
  useEffect(() => {
    setSug(null);
    if (!vendedor || !cliente) return;
    let vivo = true;
    api<Sugestoes>(`/painel/pedido-novo/sugestoes?vendedor=${vendedor.cod_vendedor}&cliente=${cliente.cod_cliente}`)
      .then((x) => vivo && setSug(x))
      .catch(() => vivo && setSug(null)); // sugestao e extra: se falhar, a tela segue sem ela
    return () => { vivo = false; };
  }, [vendedor?.cod_vendedor, cliente?.cod_cliente]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pop-up: soma a quantidade escolhida ao que ja esta no pedido (ou adiciona o produto). */
  function adicionarSomando(p: ProdutoLinha, q: number) {
    const prod = p as unknown as ProdutoCat;
    setItens((l) => (l.some((i) => i.produto === prod.cod_produto)
      ? l.map((i) => (i.produto === prod.cod_produto ? { ...i, quantidade: String(Math.round((numero(i.quantidade) + q) * 1000) / 1000) } : i))
      : [...l, { produto: prod.cod_produto, descricao: prod.descricao, unidade: prod.unidade, unidade_texto: prod.unidade_texto, quantidade: String(q), desconto_manual: '', estoque_cx: prod.estoque_cx }]));
  }

  const cotDe = (cod: string) => cot?.itens.find((c) => c.produto === cod);
  const noPedido = (cod: string) => itens.find((i) => i.produto === cod);

  function adicionar(p: ProdutoCat) {
    setItens((l) => (l.some((i) => i.produto === p.cod_produto) ? l.map((i) => (i.produto === p.cod_produto ? { ...i, quantidade: String(numero(i.quantidade) + 1) } : i)) : [...l, { produto: p.cod_produto, descricao: p.descricao, unidade: p.unidade, unidade_texto: p.unidade_texto, quantidade: '1', desconto_manual: '', estoque_cx: p.estoque_cx }]));
  }
  /** Adiciona o produto na quantidade que o cliente costuma levar (sem mexer no que ja esta no pedido). */
  function adicionarComQtd(p: ProdutoCat, q: number) {
    const qtd = String(Math.max(1, Math.round(q)));
    setItens((l) => (l.some((i) => i.produto === p.cod_produto) ? l : [...l, { produto: p.cod_produto, descricao: p.descricao, unidade: p.unidade, unidade_texto: p.unidade_texto, quantidade: qtd, desconto_manual: '', estoque_cx: p.estoque_cx }]));
  }
  // ?duplicar=<ordem>: traz os itens de um pedido anterior do cliente (so o que ainda tem preco e estoque)
  const duplicar = params.get('duplicar');
  const [duplicado, setDuplicado] = useState('');
  const [avisoDup, setAvisoDup] = useState<string[]>([]);
  useEffect(() => {
    if (!duplicar || !vendedor || !cliente || duplicado === duplicar) return;
    setDuplicado(duplicar);
    api<{ itens: Array<{ quantidade: number; produto: ProdutoCat }>; ignorados: Array<{ cod_produto: string; descricao: string | null; motivo: string }> }>(
      `/painel/pedido-novo/duplicar?vendedor=${vendedor.cod_vendedor}&cliente=${cliente.cod_cliente}&ordem=${encodeURIComponent(duplicar)}`,
    )
      .then((r) => { r.itens.forEach((i) => adicionarComQtd(i.produto, i.quantidade)); setAvisoDup(r.ignorados.map((x) => `${x.descricao ?? x.cod_produto}: ${x.motivo}`)); })
      .catch((e) => setErro((e as Error).message));
  }, [duplicar, vendedor, cliente]); // eslint-disable-line react-hooks/exhaustive-deps
  const adicionarReposicao = () => (sug?.reposicao ?? []).forEach((x) => adicionarComQtd(x.produto, x.quantidade_tipica));
  const mudarQtd = (cod: string, delta: number) =>
    setItens((l) => l.flatMap((i) => (i.produto !== cod ? [i] : numero(i.quantidade) + delta <= 0 ? [] : [{ ...i, quantidade: String(Math.round((numero(i.quantidade) + delta) * 1000) / 1000) }])));
  const editar = (cod: string, campo: 'quantidade' | 'desconto_manual', v: string) => setItens((l) => l.map((i) => (i.produto === cod ? { ...i, [campo]: v } : i)));

  const totalItens = cot?.total ?? 0;
  const minimo = tipo === 'venda' ? cot?.pedido_minimo ?? cliente?.pedido_minimo ?? null : null;
  const abaixoMinimo = !!minimo && totalItens > 0 && totalItens < minimo;
  const bonifOk = tipo === 'venda' || (!!tipoBon && !!centro && justificativa.trim().length >= 5);
  const pronto = !!vendedor && !!cliente && itens.length > 0 && itens.every((i) => numero(i.quantidade) > 0) && bonifOk && !cliente.bloqueado;

  async function enviar() {
    if (!vendedor || !cliente) return;
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const r = await api<Resultado>('/painel/pedidos', {
        method: 'POST',
        body: {
          cod_vendedor: vendedor.cod_vendedor,
          cod_cliente: cliente.cod_cliente,
          tipo,
          tipo_bonificacao: tipo === 'bonificacao' ? tipoBon : null,
          centro_custo: tipo === 'bonificacao' ? centro : null,
          justificativa: tipo === 'bonificacao' ? justificativa : null,
          observacao: observacao || null,
          ordem_compra_cliente: oc || null,
          // com desconto (incentivo e/ou do gestor) vai o preco final da unidade, como o app; sem desconto o SAP usa a tabela
          itens: itens.map((i) => {
            const c = cotDe(i.produto);
            const comDesconto = tipo === 'venda' && !!c?.preco_final && (c.desconto_total ?? 0) > 0;
            return { produto: i.produto, unidade: i.unidade, quantidade: i.quantidade, preco: comDesconto ? c!.preco_final!.toFixed(2) : null };
          }).concat(
            // brinde de combo: o servidor confere se algum combo do pedido o sustenta e cria a bonificacao
            tipo === 'venda' ? (cot?.brindes ?? []).map((b) => ({ produto: b.produto, unidade: b.unidade, quantidade: String(b.quantidade), preco: null, brinde: true, combo_id: b.combo_id }) as never) : [],
          ),
        },
      });
      setResultado(r);
      if (r.status !== 'invalido' && r.status !== 'conflito') {
        setItens([]);
        setObservacao('');
        setOc('');
        setJustificativa('');
        setCliente(null);
        setBuscaCli('');
        setBuscaProd('');
        setClientes([]);
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const secoes = useMemo(() => {
    if (buscaProd.trim()) return [];
    const dest = catalogo.filter((p) => p.origem === 'destaque' || p.origem === 'lancamento');
    const comp = catalogo.filter((p) => p.origem === 'comprou');
    return [
      ...(dest.length ? [{ titulo: 'Destaques e lançamentos', itens: dest }] : []),
      ...(comp.length ? [{ titulo: 'Comprados recentemente por este cliente (90 dias)', itens: comp }] : []),
    ];
  }, [catalogo, buscaProd]);

  return (
    <>
      <h1>Novo pedido</h1>
      <p className="sub">Cria o pedido em nome do vendedor, com as mesmas regras do app (carteira, preço de tabela, desconto por incentivo, combos com brinde, estoque). O vendedor vê o pedido no app na próxima sincronização.</p>
      {resultado && <Resumo r={resultado} />}
      {erro && <p className="erro-msg">{erro}</p>}
      {avisoDup.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--c-aviso-borda)' }}>
          <div className="titulo">Pedido duplicado: alguns itens ficaram de fora</div>
          <ul className="itens">{avisoDup.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}

      <div className="novo-grid">
        {/* ------------------------- ESQUERDA: montar o pedido ------------------------- */}
        <div>
          <div className="card">
            <div className="titulo" style={{ marginBottom: 8 }}>Tipo do pedido</div>
            <div className="segmentos">
              <button className={tipo === 'venda' ? 'ativo' : ''} onClick={() => setTipo('venda')}>Venda</button>
              <button className={tipo === 'bonificacao' ? 'ativo' : ''} onClick={() => setTipo('bonificacao')}>Bonificação</button>
            </div>
            {tipo === 'bonificacao' && (
              <div style={{ marginTop: 12 }}>
                <div className="form-grade">
                  <label className="campo">
                    <span>Tipo de bonificação *</span>
                    <select value={tipoBon} onChange={(e) => setTipoBon(e.target.value)}>
                      <option value="">Escolha…</option>
                      {tiposBon.map((t) => <option key={t.codigo} value={t.codigo}>{t.codigo} - {t.descricao}</option>)}
                    </select>
                    {tiposBon.length === 0 && <small className="suave">Nenhum tipo cadastrado (Cadastros → Tipos de bonificação).</small>}
                  </label>
                  <label className="campo">
                    <span>Centro de custo *</span>
                    <select value={centro} onChange={(e) => setCentro(e.target.value)}>
                      <option value="">Escolha…</option>
                      {centros.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} - {c.descricao}</option>)}
                    </select>
                    {centros.length === 0 && <small className="suave">Nenhum centro cadastrado (Cadastros → Centros de custo).</small>}
                  </label>
                </div>
                <label className="campo" style={{ marginTop: 10 }}>
                  <span>Justificativa * <small className="suave">(só para quem aprova; não vai ao SAP)</small></span>
                  <textarea value={justificativa} maxLength={500} onChange={(e) => setJustificativa(e.target.value)} style={{ minHeight: 60 }} />
                </label>
                <p className="suave" style={{ margin: '8px 0 0' }}>A bonificação fica aguardando aprovação (Pedidos → Bonificações) e só vai ao SAP depois de aprovada. Sem desconto: o SAP aplica a regra do tipo.</p>
              </div>
            )}
          </div>

          <div className="card">
            <div className="titulo" style={{ marginBottom: 8 }}>Vendedor</div>
            {vendedor ? (
              <div className="linha" style={{ alignItems: 'center' }}>
                <span><strong>{vendedor.nome ?? vendedor.cod_vendedor}</strong> <span className="suave">· {vendedor.cod_vendedor} · rota {vendedor.rota}</span></span>
                <button className="btn" onClick={() => { setVendedor(null); setCliente(null); setClientes([]); setBuscaCli(''); setErroCarteira(null); setCarregandoCarteira(false); setItens([]); }}>Trocar</button>
              </div>
            ) : (
              <>
                <input className="entrada" style={{ width: '100%' }} placeholder="Buscar vendedor por nome ou código" value={buscaVend} onChange={(e) => setBuscaVend(e.target.value)} autoFocus />
                <div className="opcoes">
                  {vendedoresVisiveis.map((v) => <button key={v.cod_vendedor} className="opcao-linha" onClick={() => setVendedor(v)}>{v.nome ?? '—'} <span className="suave">· {v.cod_vendedor}</span></button>)}
                  {vendedores.length === 0 && <span className="suave">Nenhum vendedor importado. Em Usuários → Vendedores, importe do SAP.</span>}
                </div>
              </>
            )}
          </div>

          {vendedor && (
            <div className="card">
              <div className="titulo" style={{ marginBottom: 8 }}>Cliente</div>
              {cliente ? (
                <div className="linha" style={{ alignItems: 'center' }}>
                  <span>
                    <strong>{cliente.nome ?? cliente.cod_cliente}</strong> <span className="suave">· {cliente.cod_cliente}</span>
                    {cliente.pagamento_antecipado && <span className="selo aviso" style={{ marginLeft: 8 }}>Pagamento antecipado</span>}
                    {cliente.bloqueado && <span className="selo erro" style={{ marginLeft: 8 }}>Bloqueado</span>}
                  </span>
                  <button className="btn" onClick={() => { setCliente(null); setItens([]); setBuscaProd(''); }}>Trocar</button>
                </div>
              ) : (
                <>
                  <input className="entrada" style={{ width: '100%' }} placeholder="Buscar cliente da carteira (nome ou código)" value={buscaCli} onChange={(e) => setBuscaCli(e.target.value)} autoFocus />
                  <div className="opcoes">
                    {carregandoCarteira && <span className="suave">Buscando a carteira de {vendedor.nome ?? vendedor.cod_vendedor} no SAP… (primeira vez deste vendedor)</span>}
                    {erroCarteira && (
                      <span>
                        <span className="erro-msg">Não consegui buscar a carteira: {erroCarteira}</span>{' '}
                        <button className="btn" onClick={() => { setErroCarteira(null); setTentativa((n) => n + 1); }}>Tentar de novo</button>
                      </span>
                    )}
                    {clientes.map((c) => (
                      <button key={c.cod_cliente} className="opcao-linha" onClick={() => setCliente(c)}>
                        {c.nome ?? 'Cliente sem cadastro baixado'} <span className="suave">· {c.cod_cliente}</span>
                        {c.bloqueado && <span className="selo erro" style={{ marginLeft: 8 }}>Bloqueado</span>}
                      </button>
                    ))}
                    {!carregandoCarteira && !erroCarteira && !buscandoClientes && clientes.length === 0 && <span className="suave">{buscaCli.trim() ? 'Nenhum cliente da carteira deste vendedor combina com a busca.' : 'Este vendedor não tem clientes na carteira.'}</span>}
                  </div>
                </>
              )}
            </div>
          )}

          {vendedor && cliente && sug && (sug.reposicao.length > 0 || (tipo === 'venda' && sug.combos.length > 0)) && (
            <div className="card">
              <div className="titulo" style={{ marginBottom: 8 }}>Sugestões para este cliente</div>
              {sug.reposicao.length > 0 && (
                <>
                  <div className="secao-titulo">Hora de repor <span className="suave">· passou do ritmo de compra dele</span></div>
                  {sug.reposicao.map((x) => {
                    const ja = noPedido(x.cod_produto);
                    return (
                      <div key={x.cod_produto} className={`prod-card${ja ? ' no-pedido' : ''}`}>
                        <Foto cod={x.cod_produto} tamanho={48} />
                        <div className="prod-info">
                          <button className="link-prod prod-nome" onClick={() => setPopup(x.cod_produto)} title="Ver os dados do produto">{x.produto.descricao}</button>
                          <div className="suave">
                            compra a cada ~{x.intervalo_dias} dias · última há {x.dias_desde} dias · costuma levar {Math.round(x.quantidade_tipica * 10) / 10} {x.unidade ?? x.produto.unidade_texto}
                          </div>
                        </div>
                        <button className={`mais${ja ? ' verde' : ''}`} onClick={() => adicionarComQtd(x.produto, x.quantidade_tipica)} title="Adicionar na quantidade que ele costuma levar">
                          <Plus size={20} strokeWidth={2.4} />
                          {ja && <span className="mais-qtd">{ja.quantidade}</span>}
                        </button>
                      </div>
                    );
                  })}
                  <div style={{ marginTop: 8 }}><button className="btn" onClick={adicionarReposicao}>Adicionar tudo ({sug.reposicao.length})</button></div>
                </>
              )}
              {tipo === 'venda' && sug.combos.length > 0 && (
                <>
                  <div className="secao-titulo">Combos para fechar <span className="suave">· com o que ele costuma comprar</span></div>
                  {sug.combos.map((c) => (
                    <div key={c.id} style={{ borderLeft: '4px solid var(--c-aviso-borda)', background: 'var(--c-aviso-fundo)', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                      <div style={{ fontWeight: 700 }}>Quase lá: {c.nome}</div>
                      <div className="suave" style={{ color: 'inherit' }}>
                        Falta {c.faltas.map((f) => `${Math.round(f.falta * 10) / 10} cx ${ROTULO_ALVO[f.alvo_tipo] ?? ''} ${f.alvo_valor}`.replace('  ', ' ')).join(' e ')} para o cliente{' '}
                        {c.brinde ? `ganhar ${c.brinde.quantidade} cx de ${c.brinde.descricao}` : `ter ${c.desconto_pct}% de desconto`}.
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {vendedor && cliente && (
            <div className="card">
              <div className="titulo" style={{ marginBottom: 8 }}>Produtos</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <input className="entrada" style={{ flex: 1, minWidth: 220 }} placeholder="Buscar produto por nome, código ou EAN" value={buscaProd} onChange={(e) => setBuscaProd(e.target.value)} />
                <label className="suave" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }} title="Por padrão só aparece o que dá para vender: com preço de tabela e estoque para este cliente">
                  <input type="checkbox" checked={mostrarIndisp} onChange={(e) => setMostrarIndisp(e.target.checked)} /> Mostrar também sem estoque ou sem preço
                </label>
              </div>

              {secoes.map((s) => (
                <div key={s.titulo}>
                  <div className="secao-titulo">{s.titulo}</div>
                  {s.itens.map((p) => <CartaoProduto key={p.cod_produto} p={p} ja={noPedido(p.cod_produto)} adicionar={adicionar} abrir={setPopup} />)}
                </div>
              ))}

              <div className="secao-titulo">
                {buscaProd.trim() ? `Resultado da busca por "${buscaProd.trim()}"` : 'Todos os produtos disponíveis para este cliente'}
                {!carregandoTodos && todos.length > 0 && <span className="suave"> · {todos.length}{proximoTodos != null ? '+' : ''}</span>}
              </div>
              {todos.map((p) => <CartaoProduto key={p.cod_produto} p={p} ja={noPedido(p.cod_produto)} adicionar={adicionar} abrir={setPopup} />)}
              {carregandoTodos && <p className="suave">Carregando produtos…</p>}
              {!carregandoTodos && todos.length === 0 && (
                <p className="suave">
                  {buscaProd.trim() ? 'Nenhum produto encontrado.' : 'Nenhum produto com preço de tabela e estoque para este cliente.'}
                  {!mostrarIndisp && ' Marque "Mostrar também sem estoque ou sem preço" para ver o que está de fora.'}
                </p>
              )}
              {!carregandoTodos && proximoTodos != null && <div style={{ marginTop: 8 }}><button className="btn" onClick={maisTodos}>Carregar mais produtos</button></div>}
            </div>
          )}
        </div>

        {/* ------------------------- DIREITA: resumo ------------------------- */}
        <aside className="resumo card">
          <div className="titulo" style={{ marginBottom: 2 }}>Resumo do pedido</div>
          <div className="suave" style={{ marginBottom: 10 }}>
            <span className={`selo ${tipo === 'venda' ? 'ok' : 'aviso'}`}>{tipo === 'venda' ? 'Venda' : 'Bonificação'}</span>
          </div>
          <div className="resumo-linha"><span className="suave">Vendedor</span><strong>{vendedor ? vendedor.nome ?? vendedor.cod_vendedor : '—'}</strong></div>
          <div className="resumo-linha"><span className="suave">Cliente</span><strong>{cliente ? cliente.nome ?? cliente.cod_cliente : '—'}</strong></div>

          <div className="resumo-itens">
            {itens.length === 0 && <p className="suave" style={{ margin: '12px 0' }}>{cliente ? 'Toque no + de um produto para adicionar.' : 'Escolha o vendedor e o cliente.'}</p>}
            {itens.map((i) => {
              const c = cotDe(i.produto);
              const q = numero(i.quantidade);
              return (
                <div className="resumo-item" key={i.produto}>
                  <Foto cod={i.produto} tamanho={44} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <button className="link-prod prod-nome" style={{ fontSize: 13 }} onClick={() => setPopup(i.produto)} title="Ver os dados do produto">{i.descricao}</button>
                    {c?.erro ? <div className="erro-msg" style={{ margin: 0 }}>{c.erro}</div> : (
                      <div className="suave">
                        {c?.preco_final != null ? (
                          <>
                            {moeda(c.preco_final)}/{i.unidade_texto}
                            {tipo === 'venda' && (c.desconto_total ?? 0) > 0 ? <> <s>{moeda(c.preco_tabela)}</s> −{c.desconto_total}%</> : null}
                          </>
                        ) : c?.aviso ? c.aviso : 'calculando…'}
                      </div>
                    )}
                    {tipo === 'venda' && (c?.desconto_auto ?? 0) > 0 && c?.origem_desconto === 'combo' && <div className="suave" style={{ color: 'var(--c-ok-texto)' }}>Combo: {c.desconto_auto}% automático</div>}
                    {tipo === 'venda' && c?.incentivo && (c.desconto_auto ?? 0) > 0 && c.origem_desconto !== 'combo' && <div className="suave" style={{ color: 'var(--c-ok-texto)' }}>Incentivo: {c.desconto_auto}% automático (a partir de {c.incentivo.qtd_minima} {i.unidade_texto})</div>}
                    {tipo === 'venda' && c?.proxima_faixa && (
                      <div className="suave" style={{ color: 'var(--c-aviso)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span>Faltam {qfmt(c.proxima_faixa.falta)} {i.unidade_texto} para {qfmt(c.proxima_faixa.desconto_pct)}% de desconto</span>
                        <button className="link-prod" style={{ display: 'inline', color: 'var(--c-prim-texto)', fontWeight: 600 }} onClick={() => mudarQtd(i.produto, Math.ceil(c.proxima_faixa!.falta))} title="Soma ao pedido o que falta para chegar na faixa">+ adicionar {Math.ceil(c.proxima_faixa.falta)}</button>
                      </div>
                    )}
                    {tipo === 'venda' && c?.preco_final != null && (c.desconto_manual_max ?? 0) > 0 && (
                      <label className="suave" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                        Desconto extra
                        <input className="entrada" style={{ minWidth: 0, width: 58, padding: '3px 6px' }} inputMode="decimal" placeholder="0" value={i.desconto_manual} onChange={(e) => editar(i.produto, 'desconto_manual', e.target.value)} />% <span>(máx. {c.desconto_manual_max}%)</span>
                      </label>
                    )}
                  </div>
                  <div className="stepper">
                    <button onClick={() => mudarQtd(i.produto, -1)} title={q <= 1 ? 'Remover' : 'Diminuir'}>{q <= 1 ? <Trash2 size={15} /> : <Minus size={15} />}</button>
                    <input value={i.quantidade} inputMode="decimal" onChange={(e) => editar(i.produto, 'quantidade', e.target.value)} />
                    <button onClick={() => mudarQtd(i.produto, 1)} title="Aumentar"><Plus size={15} /></button>
                  </div>
                  <div className="resumo-subtotal">{moeda(c?.subtotal)}</div>
                </div>
              );
            })}
          </div>

          {tipo === 'venda' && (cot?.brindes ?? []).length > 0 && (
            <div className="resumo-itens" style={{ marginTop: 8 }}>
              {(cot?.brindes ?? []).map((b) => (
                <div className="resumo-item" key={`brinde-${b.produto}`}>
                  <Foto cod={b.produto} tamanho={44} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="prod-nome" style={{ fontSize: 13 }}>{b.descricao}</div>
                    <div className="suave" style={{ color: 'var(--c-ok-texto)' }}>Brinde do combo{b.combos.length ? `: ${b.combos.join(', ')}` : ''}</div>
                  </div>
                  <div className="suave" style={{ whiteSpace: 'nowrap' }}>{b.quantidade.toLocaleString('pt-BR')} {b.unidade_texto}</div>
                  <div className="resumo-subtotal">Grátis</div>
                </div>
              ))}
            </div>
          )}

          {tipo === 'venda' && cot?.combos && (cot.combos.aplicados.length > 0 || cot.combos.incompletos.length > 0) && (
            <div style={{ marginTop: 8 }}>
              {cot.combos.aplicados.map((a) => (
                <div key={a.id} style={{ borderLeft: '4px solid var(--c-ok)', background: 'var(--c-ok-fundo)', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, color: 'var(--c-ok-texto)' }}>Combo aplicado: {a.nome}</div>
                  <div className="suave" style={{ color: 'inherit' }}>
                    {a.vezes > 1 ? `${a.vezes}x · ` : ''}
                    {a.brinde ? `ganha ${qfmt(a.brinde.quantidade)} cx de ${a.brinde.descricao ?? a.brinde.produto}` : `${qfmt(a.desconto_pct ?? 0)}% de desconto nos itens do combo`}
                  </div>
                </div>
              ))}
              {cot.combos.incompletos.map((x) => (
                <div key={x.id} style={{ borderLeft: '4px solid var(--c-aviso-borda)', background: 'var(--c-aviso-fundo)', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700 }}>Quase lá: {x.nome}</div>
                  <div className="suave" style={{ color: 'inherit' }}>
                    Falta {x.faltas.map((ft) => ft.alvo_descricao ? `${qfmt(ft.falta)} cx de ${ft.alvo_descricao}` : `${qfmt(ft.falta)} cx ${ROTULO_ALVO[ft.alvo_tipo] ?? ''} ${ft.alvo_valor}`.replace('  ', ' ')).join(' e ')} para o cliente{' '}
                    {x.brinde ? `ganhar ${qfmt(x.brinde.quantidade)} cx de ${x.brinde.descricao ?? x.brinde.produto}` : `ter ${qfmt(x.desconto_pct ?? 0)}% de desconto`}.
                  </div>
                </div>
              ))}
            </div>
          )}

          {itens.length > 0 && (
            <>
              <div className="resumo-total"><span>{tipo === 'venda' ? 'Total estimado' : 'Valor de tabela (referência)'}</span><strong>{moeda(totalItens)}</strong></div>
              {minimo ? (
                <p className={abaixoMinimo ? 'erro-msg' : 'suave'} style={{ margin: '4px 0 0', color: abaixoMinimo ? undefined : 'var(--c-ok-texto)' }}>
                  {abaixoMinimo ? `Abaixo do pedido mínimo de ${moeda(minimo)}: faltam ${moeda(minimo - totalItens)}.` : `Pedido mínimo de ${moeda(minimo)} atingido.`}
                </p>
              ) : null}
              <div className="form-grade" style={{ gridTemplateColumns: '1fr', marginTop: 12 }}>
                <label className="campo"><span>Ordem de compra do cliente</span><input type="text" maxLength={35} value={oc} onChange={(e) => setOc(e.target.value)} /></label>
                <label className="campo"><span>Observação</span><input type="text" maxLength={300} value={observacao} onChange={(e) => setObservacao(e.target.value)} /></label>
              </div>
              <button className="btn ok" style={{ width: '100%', marginTop: 14, padding: '12px 14px', fontSize: 14 }} disabled={!pronto || enviando} onClick={enviar}>
                {enviando ? 'Enviando…' : tipo === 'venda' ? 'Criar pedido' : 'Enviar bonificação para aprovação'}
              </button>
              {cliente?.bloqueado && <p className="erro-msg" style={{ marginBottom: 0 }}>Cliente bloqueado: o SAP não aceita o pedido.</p>}
              {tipo === 'bonificacao' && !bonifOk && <p className="suave" style={{ margin: '6px 0 0' }}>Preencha tipo, centro de custo e justificativa (mín. 5 caracteres).</p>}
            </>
          )}
        </aside>
      </div>

      {popup && vendedor && cliente && (
        <ProdutoPopup vendedor={vendedor.cod_vendedor} cliente={cliente.cod_cliente} cod={popup} noPedido={numero(noPedido(popup)?.quantidade ?? '0')} aoAdicionar={adicionarSomando} aoFechar={() => setPopup(null)} />
      )}
    </>
  );
}

function Resumo({ r }: { r: Resultado }) {
  const ok = r.status === 'enviado';
  const aprov = r.status === 'aguardando_aprovacao';
  const fila = r.status === 'recebido' || r.status === 'parcial';
  return (
    <div className="card" style={{ borderColor: ok ? 'var(--c-ok)' : aprov || fila ? 'var(--c-aviso-borda)' : 'var(--c-erro)' }}>
      {ok && (
        <>
          <strong style={{ color: 'var(--c-ok-texto)' }}>Pedido criado e enviado ao SAP.</strong>
          <div className="suave">Ordens: {r.ordens?.map((o) => o.ordem).join(', ') || '—'}{r.dt_entrega ? ` · entrega ${r.dt_entrega.slice(8, 10)}/${r.dt_entrega.slice(5, 7)}/${r.dt_entrega.slice(0, 4)}` : ''}</div>
        </>
      )}
      {aprov && (
        <>
          <strong style={{ color: 'var(--c-aviso)' }}>Bonificação criada e aguardando aprovação.</strong>
          <div className="suave">Aprove em Pedidos → Bonificações: depois disso o servidor envia ao SAP em até 1 minuto.</div>
        </>
      )}
      {fila && (
        <>
          <strong style={{ color: 'var(--c-aviso)' }}>Pedido gravado, mas ainda não confirmado pelo SAP.</strong>
          <div className="suave">O servidor tenta de novo sozinho a cada minuto. Acompanhe no Monitor.{r.erro ? ` Último retorno: ${r.erro}` : ''}</div>
        </>
      )}
      {(r.status === 'invalido' || r.status === 'conflito' || r.status === 'erro') && (
        <>
          <strong style={{ color: 'var(--c-erro3)' }}>O pedido não foi criado.</strong>
          <ul className="itens">{(r.erros?.length ? r.erros : [r.erro ?? 'Erro desconhecido']).map((e, n) => <li key={n}>{e}</li>)}</ul>
        </>
      )}
      {r.possivel_duplicidade && r.possivel_duplicidade.length > 0 && <div className="suave" style={{ marginTop: 6 }}>Atenção: existe pedido parecido (mesmo cliente e itens) nas últimas 24 horas.</div>}
    </div>
  );
}
