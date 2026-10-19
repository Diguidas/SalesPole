import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

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
  const [atencao, setAtencao] = useState<Atencao['resumo'] | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    setErro(null);
    setD(null);
    try {
      const { ini, fim } = intervalo(periodo);
      setD(await api<Vendas>(`/painel/indicadores?ini=${ini}&fim=${fim}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [periodo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // faixa "precisa de atencao": falha nela nao atrapalha o resto da pagina
  useEffect(() => {
    api<Atencao>('/painel/monitor').then((r) => setAtencao(r.resumo)).catch(() => setAtencao(null));
  }, []);

  const t = d?.total;
  const vendedores = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const todos = (d?.por_vendedor ?? []).filter((v) => !q || v.rotulo.toLowerCase().includes(q) || v.chave.includes(q));
    return verTodos || q ? todos : todos.slice(0, 10);
  }, [d, busca, verTodos]);

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
                  <Barras itens={d.por_canal} rotulo={(g) => (g.chave ? `${g.chave} · ${g.rotulo}` : 'Sem canal')} total={t.valor} limite={6} />
                </div>
                <div className="card">
                  <h3>Por escritório de vendas</h3>
                  <Barras itens={d.por_escritorio} rotulo={(g) => (g.chave ? `${g.chave} · ${g.rotulo}` : 'Sem escritório')} total={t.valor} limite={6} />
                </div>
                <div className="card">
                  <h3>Maiores vendedores</h3>
                  <Barras itens={d.por_vendedor.slice(0, 6)} rotulo={(g) => g.rotulo} total={t.valor} />
                </div>
              </div>

              <div className="card">
                <div className="linha" style={{ alignItems: 'center', marginBottom: 8 }}>
                  <h3 style={{ margin: 0 }}>Todos os vendedores</h3>
                  <input className="entrada" style={{ minWidth: 220 }} placeholder="Buscar vendedor" value={busca} onChange={(e) => setBusca(e.target.value)} />
                </div>
                <table style={{ border: 'none' }}>
                  <thead><tr><th>Vendedor</th><th style={{ textAlign: 'right' }}>Vendas</th><th style={{ textAlign: 'right' }}>% do total</th><th style={{ textAlign: 'right' }}>Pedidos</th><th style={{ textAlign: 'right' }}>Positivação</th></tr></thead>
                  <tbody>
                    {vendedores.map((v) => (
                      <tr key={v.chave}>
                        <td>{v.rotulo}</td>
                        <td style={{ textAlign: 'right' }}>{moeda(v.valor)}</td>
                        <td style={{ textAlign: 'right' }}>{t.valor ? `${((v.valor / t.valor) * 100).toFixed(1)}%` : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{inteiro(v.pedidos)}</td>
                        <td style={{ textAlign: 'right' }}>{v.positivacao_pct == null ? '—' : `${v.positivacao_pct.toFixed(0)}% (${inteiro(v.clientes)}/${inteiro(v.carteira)})`}</td>
                      </tr>
                    ))}
                    {vendedores.length === 0 && <tr><td colSpan={5} className="suave">Nenhum vendedor encontrado.</td></tr>}
                  </tbody>
                </table>
                {!busca && d.por_vendedor.length > 10 && (
                  <button className="btn" style={{ marginTop: 10 }} onClick={() => setVerTodos((v) => !v)}>{verTodos ? 'Mostrar só os 10 maiores' : `Ver todos (${d.por_vendedor.length})`}</button>
                )}
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
          <div className="coluna-valor">{abrev(g.valor)}</div>
          <div className="coluna-trilho"><div className="coluna-barra" style={{ height: `${Math.max((g.valor / max) * 100, 2)}%` }} /></div>
          <div className="coluna-rotulo">{nomeMes(g.chave)}</div>
        </div>
      ))}
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
