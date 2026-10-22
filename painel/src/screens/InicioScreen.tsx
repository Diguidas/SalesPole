import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ehHierarquia, useAuth } from '../auth';

interface Grupo { chave: string; rotulo: string; valor: number; pedidos: number; clientes: number }
interface Vendedor extends Grupo { carteira: number; positivacao_pct: number | null }
interface Vendas {
  periodo: { ini: string; fim: string };
  total: { vendedores_com_vendas: number; vendedores_na_base: number; valor: number; pedidos: number; clientes: number; ticket_medio: number; carteira: number; positivacao_pct: number | null };
  por_mes: Grupo[];
  por_escritorio: Grupo[];
  por_canal: Grupo[];
  por_vendedor: Vendedor[];
}
interface ItemRanking { chave: string; rotulo: string; valor: number }
interface Rankings { atualizando: boolean; dims: Record<string, ItemRanking[]> }
interface VisitaVendedor { cod_vendedor: string; nome: string | null; visitas: number; concluidas: number; vendeu: number; fora_do_raio: number; pendentes: number; recusadas: number }
interface ResumoVisitas {
  total: { visitas: number; concluidas: number; vendeu: number; fora_do_raio: number; pendentes: number; recusadas: number; vendedores: number };
  por_vendedor: VisitaVendedor[];
}
interface Atencao { resumo: { pedidos_com_problema: number; sincs_com_problema: number; bonificacoes_aguardando: number; visitas_pendentes: number } }

const PERIODOS = [
  { id: 'mes', r: 'Este mês' },
  { id: '3', r: '3 meses' },
  { id: '6', r: '6 meses' },
  { id: '12', r: '12 meses' },
];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const inteiro = (v: number) => v.toLocaleString('pt-BR');
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
/** Valor curto para o topo das colunas: R$ 1,2 mi / R$ 350 mil. */
function abrev(v: number) {
  if (v >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (v >= 1e3) return `R$ ${Math.round(v / 1e3).toLocaleString('pt-BR')} mil`;
  return moeda(v);
}

/** Primeiro dia do mes de `meses - 1` meses atras ate hoje (o mes atual conta como o 1o). */
function intervalo(id: string) {
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const meses = id === 'mes' ? 1 : Number(id);
  const [a, m] = hoje.split('-').map(Number);
  const base = a * 12 + (m - 1) - (meses - 1);
  return { ini: `${Math.floor(base / 12)}-${String((base % 12) + 1).padStart(2, '0')}-01`, fim: hoje };
}

/** Pagina inicial: o que precisa de atencao e como estao as vendas (valor em R$ dos pedidos do SAP, sem os recusados). */
export function InicioScreen() {
  const { usuario } = useAuth();
  const [periodo, setPeriodo] = useState('3');
  const [d, setD] = useState<Vendas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rk, setRk] = useState<Rankings | null>(null);
  const [erroRk, setErroRk] = useState<string | null>(null);
  const [vis, setVis] = useState<ResumoVisitas | null>(null);
  const [erroVis, setErroVis] = useState<string | null>(null);
  const [atencao, setAtencao] = useState<Atencao['resumo'] | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    setD(null);
    try {
          setD(await api<Vendas>(`/painel/indicadores?ini=${ini}&fim=${fim}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [periodo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // visitas do periodo (tabela pequena: consulta direta)
  useEffect(() => {
    let vivo = true;
    setVis(null);
    setErroVis(null);
    const { ini, fim } = intervalo(periodo);
    api<ResumoVisitas>(`/painel/indicadores/visitas?ini=${ini}&fim=${fim}`)
      .then((r) => vivo && setVis(r))
      .catch((e) => vivo && setErroVis((e as Error).message));
    return () => { vivo = false; };
  }, [periodo]);

  // rankings (todos os cards numa chamada so, do resumo mensal); se o resumo ainda esta sendo montado, tenta de novo
  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tentativas = 0;
    setRk(null);
    setErroRk(null);
    const { ini, fim } = intervalo(periodo);
    const buscar = () => {
      api<Rankings>(`/painel/indicadores/rankings?ini=${ini}&fim=${fim}&limite=10`)
        .then((r) => {
          if (!vivo) return;
          setRk(r);
          if (r.atualizando && ++tentativas < 60) timer = setTimeout(buscar, 4000);
        })
        .catch((e) => vivo && setErroRk((e as Error).message));
    };
    buscar();
    return () => { vivo = false; if (timer) clearTimeout(timer); };
  }, [periodo]);

  // faixa "precisa de atencao": falha nela nao atrapalha o resto da pagina
  useEffect(() => {
    if (ehHierarquia(usuario?.papel)) return; // o monitor e do sistema: nao e liberado para a hierarquia
    api<Atencao>('/painel/monitor').then((r) => setAtencao(r.resumo)).catch(() => setAtencao(null));
  }, []);

  const t = d?.total;
  const { ini, fim } = intervalo(periodo);

  const pendencias = atencao
    ? [
        { n: atencao.bonificacoes_aguardando, texto: 'bonificações para aprovar', para: '/bonificacoes' },
        { n: atencao.visitas_pendentes, texto: 'visitas para validar', para: '/visitas' },
        { n: atencao.pedidos_com_problema, texto: 'pedidos com problema', para: '/monitor' },
        { n: atencao.sincs_com_problema, texto: 'sincronizações com problema', para: '/monitor' },
      ].filter((p) => p.n > 0)
    : null;

  const nome = (usuario?.nome || usuario?.email || '').split(/[\s@]/)[0];

  return (
    <>
      <h1>Olá{nome ? `, ${nome}` : ''}</h1>
      <p className="sub">Resumo das vendas e do que precisa da sua atenção.</p>

      <div className="faixa">
        {pendencias === null ? null : pendencias.length === 0 ? (
          <span className="selo ok">Tudo em dia: nada esperando por você</span>
        ) : (
          pendencias.map((p) => (
            <Link key={p.texto} to={p.para} className="pendencia"><strong>{inteiro(p.n)}</strong> {p.texto}</Link>
          ))
        )}
      </div>

      <div className="chips">
        {PERIODOS.map((p) => <button key={p.id} className={`chip${periodo === p.id ? ' ativo' : ''}`} onClick={() => setPeriodo(p.id)}>{p.r}</button>)}
        <button className="chip" onClick={carregar}>Atualizar</button>
      </div>
      {erro && <p className="erro-msg">{erro}</p>}
      {!d && !erro && <div className="vazio">Carregando…</div>}

      {d && t && (
        <>
          <div className="cartoes">
            <Kpi titulo="Vendas" valor={moeda(t.valor)} nota={`${inteiro(t.pedidos)} pedidos`} />
            <Kpi titulo="Ticket médio" valor={moeda(t.ticket_medio)} nota="por pedido" />
            <Kpi titulo="Clientes positivados" valor={inteiro(t.clientes)} nota={t.positivacao_pct == null ? 'sem carteira' : `${t.positivacao_pct.toFixed(0)}% de ${inteiro(t.carteira)} da carteira`} />
            <Kpi titulo="Vendedores" valor={inteiro(t.vendedores_com_vendas)} nota={`com vendas, de ${inteiro(t.vendedores_na_base)} na base`} />
          </div>

          {t.pedidos === 0 ? (
            <div className="card vazio">
              Nenhuma venda neste período. Os vendedores só entram aqui depois de marcados em <Link to="/usuarios">Usuários → Vendedores</Link> (ou se usam o app) e de uma sincronização.
            </div>
          ) : (
            <>
              <div className="grade-2">
                <div className="card">
                  <h3>Vendas por mês</h3>
                  <Colunas itens={d.por_mes} />
                </div>
                <div className="card">
                  <h3>Por canal</h3>
                  <Barras itens={d.por_canal} rotulo={(g) => (g.chave ? `${g.chave} · ${g.rotulo}` : 'Sem canal')} total={t.valor} limite={10} />
                </div>
                <div className="card">
                  <h3>Por escritório de vendas</h3>
                  <Barras itens={d.por_escritorio} rotulo={(g) => (g.chave ? `${g.chave} · ${g.rotulo}` : 'Sem escritório')} total={t.valor} limite={10} />
                </div>
                <CartaoRanking titulo="Por grupo de cliente" dim="rede" rk={rk} erro={erroRk} total={t.valor} />
                <CartaoRanking titulo="Maiores vendedores" dim="vendedor" rk={rk} erro={erroRk} total={t.valor} />
                <CartaoRanking titulo="Produtos mais vendidos" dim="produto" rk={rk} erro={erroRk} total={t.valor} />
                <CartaoRanking titulo="Maiores clientes" dim="cliente" rk={rk} erro={erroRk} total={t.valor} />
                <CartaoRanking titulo="Por grupo de produto" dim="grupo" rk={rk} erro={erroRk} total={t.valor} />
                <CartaoRanking titulo="Por linha" dim="linha" rk={rk} erro={erroRk} total={t.valor} />
                <CartaoRanking titulo="Por categoria" dim="categoria" rk={rk} erro={erroRk} total={t.valor} />
                <CartaoRanking titulo="Por marca" dim="marca" rk={rk} erro={erroRk} total={t.valor} />
                <CartaoVisitas vis={vis} erro={erroVis} />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function Kpi({ titulo, valor, nota }: { titulo: string; valor: string; nota: string }) {
  return (
    <div className="cartao">
      <div className="suave">{titulo}</div>
      <div className="numero">{valor}</div>
      <div className="suave">{nota}</div>
    </div>
  );
}

/** Colunas verticais (uma por mes). */
function Colunas({ itens }: { itens: Grupo[] }) {
  const max = Math.max(...itens.map((i) => i.valor), 1);
  return (
    <div className="colunas">
      {itens.map((g) => (
        <div className="coluna" key={g.chave} title={`${nomeMes(g.chave)}: ${moeda(g.valor)} · ${inteiro(g.pedidos)} pedidos`}>
          <div className="coluna-valor">{abrev(g.valor).replace("R$ ", "")}</div>
          <div className="coluna-trilho"><div className="coluna-barra" style={{ height: `${Math.max((g.valor / max) * 100, 2)}%` }} /></div>
          <div className="coluna-rotulo">{nomeMes(g.chave)}</div>
        </div>
      ))}
    </div>
  );
}

/** Top 10 de uma dimensao (dados vem de uma chamada so, feita pela pagina para o periodo escolhido). */
function CartaoRanking({ titulo, dim, rk, erro, total }: { titulo: string; dim: string; rk: Rankings | null; erro: string | null; total: number }) {
  const nome = (g: ItemRanking) => {
    if (dim === 'vendedor') return g.rotulo;
    if (!g.chave && !g.rotulo) return 'Sem classificação';
    if (!g.rotulo || g.rotulo === g.chave) return g.chave;
    return dim === 'marca' ? g.rotulo : `${g.chave} · ${g.rotulo}`;
  };
  return (
    <div className="card">
      <h3>{titulo}</h3>
      {erro ? <p className="erro-msg">{erro}</p>
        : !rk ? <div className="suave">Carregando…</div>
        : rk.atualizando ? <div className="suave">Preparando os dados deste período (só na primeira vez, leva alguns instantes)…</div>
        : <Barras itens={(rk.dims[dim] ?? []).map((g) => ({ ...g, pedidos: 0, clientes: 0 }))} rotulo={nome} total={total} />}
    </div>
  );
}

/** Visitas do periodo: totais e os vendedores que mais visitaram, com o % de visitas que viraram venda. */
function CartaoVisitas({ vis, erro }: { vis: ResumoVisitas | null; erro: string | null }) {
  const t = vis?.total;
  const lista = (vis?.por_vendedor ?? []).slice(0, 10);
  const max = Math.max(...lista.map((v) => v.visitas), 1);
  return (
    <div className="card">
      <h3>Visitas</h3>
      {erro ? <p className="erro-msg">{erro}</p> : !vis || !t ? <div className="suave">Carregando…</div> : t.visitas === 0 ? <div className="suave">Nenhuma visita no período.</div> : (
        <>
          <p className="suave" style={{ margin: '0 0 8px' }}>
            <strong>{inteiro(t.visitas)}</strong> visitas · {inteiro(t.concluidas)} concluídas · <strong>{t.concluidas ? ((t.vendeu / t.concluidas) * 100).toFixed(0) : 0}%</strong> com venda
            {t.fora_do_raio > 0 ? ` · ${inteiro(t.fora_do_raio)} fora do raio` : ''}{t.pendentes > 0 ? ` · ${inteiro(t.pendentes)} a validar` : ''}
          </p>
          {lista.map((v) => (
            <div className="barra-linha" key={v.cod_vendedor}>
              <div className="barra-rotulo" title={v.nome ?? v.cod_vendedor}>{v.nome ?? v.cod_vendedor}</div>
              <div className="barra-trilho"><div className="barra" style={{ width: `${Math.max((v.visitas / max) * 100, 1)}%` }} /></div>
              <div className="barra-valor">{inteiro(v.visitas)}<small> · {v.concluidas ? ((v.vendeu / v.concluidas) * 100).toFixed(0) : 0}% venda</small></div>
            </div>
          ))}
          {t.pendentes > 0 && <p style={{ margin: '8px 0 0' }}><Link to="/visitas">Validar visitas pendentes →</Link></p>}
        </>
      )}
    </div>
  );
}

function Barras({ itens, rotulo, total, limite }: { itens: Grupo[]; rotulo: (g: Grupo) => string; total: number; limite?: number }) {
  if (itens.length === 0) return <div className="suave">Sem vendas no período.</div>;
  const lista = limite ? itens.slice(0, limite) : itens;
  const resto = limite ? itens.slice(limite) : [];
  const max = Math.max(...itens.map((i) => i.valor), 1);
  return (
    <div>
      {lista.map((g) => (
        <div className="barra-linha" key={g.chave || '_'}>
          <div className="barra-rotulo" title={rotulo(g)}>{rotulo(g)}</div>
          <div className="barra-trilho"><div className="barra" style={{ width: `${Math.max((g.valor / max) * 100, 1)}%` }} /></div>
          <div className="barra-valor">{abrev(g.valor)}<small> · {total ? ((g.valor / total) * 100).toFixed(0) : 0}%</small></div>
        </div>
      ))}
      {resto.length > 0 && <div className="suave" style={{ marginTop: 6 }}>+ {resto.length} outros ({abrev(resto.reduce((a, g) => a + g.valor, 0))})</div>}
    </div>
  );
}
