import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';

interface Carteira { rota: string; cod_vendedor: string; nome: string | null; vendedores: string[] }
interface Etapa { recurso: string; ok: boolean; ms: number; linhas?: number; erro?: string }
interface Job {
  id: number; rota: string; cod_vendedor: string; nome: string | null; recursos: Array<'carteira' | 'pedidos' | 'historico' | 'precos' | 'produtos'>;
  status: 'fila' | 'rodando' | 'ok' | 'erro'; etapa: string | null; etapas: Etapa[]; erro: string | null; pedido_por: string | null;
  criado_em: string; iniciado_em: string | null; terminou_em: string | null;
}
interface Lista { agora: string; ativas: Job[]; historico: Job[] }
interface Rodada {
  rodando: boolean; origem: 'cron' | 'painel' | null; iniciado_em: string | null; terminou_em: string | null;
  total: number; feitos: number; puladas?: number; atual: string | null;
  falhas: Array<{ cod_vendedor: string; erro: string }>; interrompida?: boolean;
}

const NOME_RECURSO = { carteira: 'Carteira e clientes', pedidos: 'Pedidos (90 dias)', historico: 'Histórico (12 meses)', precos: 'Tabelas de preço', produtos: 'Produtos (catálogo)' } as const;
const NOME_ETAPA: Record<string, string> = { carteira: 'Carteira (rota e dias de visita)', clientes: 'Cadastro dos clientes', pedidos: 'Pedidos (90 dias)', historico: 'Histórico de pedidos (12 meses)', precos: 'Tabelas de preço da carteira', produtos: 'Catálogo de produtos' };
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
function duracao(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Aba "Sincronizar": lista de carteiras (rotas), o que atualizar e o botao. Depois de pedir, vai para a aba de andamento. */
export function CarteirasTab({ aoPedir }: { aoPedir: () => void }) {
  const [carteiras, setCarteiras] = useState<Carteira[] | null>(null);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [rotas, setRotas] = useState<Set<string>>(new Set());
  const [recursos, setRecursos] = useState({ carteira: true, pedidos: true, historico: false, precos: false, produtos: false });
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<Carteira[]>('/painel/monitor/carteiras').then(setCarteiras).catch((e) => { setErro((e as Error).message); setCarteiras([]); });
    api<Rodada>('/painel/vendedores/sincronizacao').then((r) => setRodando(r.rodando)).catch(() => undefined);
  }, []);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (carteiras ?? []).filter((c) => !q || c.rota.toLowerCase().includes(q) || c.vendedores.some((v) => v.toLowerCase().includes(q)) || c.cod_vendedor.includes(q));
  }, [carteiras, busca]);

  function alternar(rota: string) {
    setRotas((s) => {
      const n = new Set(s);
      if (n.has(rota)) n.delete(rota);
      else n.add(rota);
      return n;
    });
  }

  async function sincronizar() {
    setEnviando(true);
    setErro(null);
    setAviso(null);
    try {
      await api('/painel/monitor/sincronizar', {
        method: 'POST',
        body: { rotas: [...rotas], recursos: (Object.keys(recursos) as Array<keyof typeof recursos>).filter((k) => recursos[k]) },
      });
      setRotas(new Set());
      aoPedir();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function sincronizarMarcados() {
    setErro(null);
    setAviso(null);
    try {
      await api<Rodada>('/painel/vendedores/sincronizar', { method: 'POST', body: {} });
      aoPedir();
    } catch (e) {
      setErro((e as Error).message);
      setRodando(true);
    }
  }

  const nenhumRecurso = !Object.values(recursos).some(Boolean);
  return (
    <>
      <p className="suave" style={{ marginTop: 0 }}>
        Escolha as carteiras (rotas) e o que atualizar. Pedidos levam cerca de 1 minuto por carteira. O histórico de 12 meses demora vários minutos por carteira: use só para completar os indicadores. As carteiras rodam uma de cada vez.
      </p>
      {erro && <p className="erro-msg">{erro}</p>}
      {aviso && <p style={{ color: '#166534', fontSize: 13 }}>{aviso}</p>}

      <div className="barra-acoes">
        <label className="marca"><input type="checkbox" checked={recursos.carteira} onChange={(e) => setRecursos({ ...recursos, carteira: e.target.checked })} /> Carteira e clientes</label>
        <label className="marca"><input type="checkbox" checked={recursos.pedidos} onChange={(e) => setRecursos({ ...recursos, pedidos: e.target.checked })} /> Pedidos (90 dias)</label>
        <label className="marca" title="Traz 12 meses de pedidos (so o cabecalho). Use quando o historico dos indicadores estiver incompleto. Demora varios minutos por carteira."><input type="checkbox" checked={recursos.historico} onChange={(e) => setRecursos({ ...recursos, historico: e.target.checked })} /> Histórico (12 meses)</label>
        <label className="marca" title="Preços vigentes das listas dos clientes da carteira. Não depende do vendedor usar o app."><input type="checkbox" checked={recursos.precos} onChange={(e) => setRecursos({ ...recursos, precos: e.target.checked })} /> Tabelas de preço</label>
        <label className="marca" title="Catálogo de produtos: é o mesmo para todos, então roda uma vez só mesmo com várias carteiras marcadas."><input type="checkbox" checked={recursos.produtos} onChange={(e) => setRecursos({ ...recursos, produtos: e.target.checked })} /> Produtos (catálogo)</label>
        <input className="entrada" placeholder="Buscar por rota ou vendedor" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={visiveis.length === 0} onClick={() => setRotas(new Set([...rotas, ...visiveis.map((c) => c.rota)]))}>Marcar as {visiveis.length}</button>
        <button className="btn" disabled={rotas.size === 0} onClick={() => setRotas(new Set())}>Desmarcar</button>
        <button className="btn ok" disabled={enviando || rotas.size === 0 || nenhumRecurso} onClick={sincronizar}>
          {enviando ? 'Enviando…' : rotas.size ? `Atualizar ${rotas.size} carteira${rotas.size === 1 ? '' : 's'}` : 'Atualizar'}
        </button>
      </div>

      {carteiras === null && <div className="vazio">Carregando…</div>}
      {carteiras?.length === 0 && !erro && <div className="vazio">Nenhuma carteira conhecida ainda. Importe os vendedores do SAP em Usuários → Vendedores.</div>}
      {visiveis.length > 0 && (
        <table>
          <thead><tr><th style={{ width: 36 }}></th><th>Rota</th><th>Vendedor</th></tr></thead>
          <tbody>
            {visiveis.map((c) => (
              <tr key={c.rota} onClick={() => alternar(c.rota)} style={{ cursor: 'pointer', background: rotas.has(c.rota) ? '#fff7ed' : undefined }}>
                <td><input type="checkbox" checked={rotas.has(c.rota)} onChange={() => alternar(c.rota)} onClick={(e) => e.stopPropagation()} /></td>
                <td>{c.rota}</td>
                <td>{c.vendedores.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Vendedores dos indicadores</h2>
      <p className="suave" style={{ marginTop: 0 }}>
        Os vendedores marcados para indicadores (em Usuários → Vendedores) atualizam sozinhos às 7h e às 14h, de segunda a sábado. Este botão atualiza todos agora.
      </p>
      <button className="btn" disabled={rodando} onClick={sincronizarMarcados}>{rodando ? 'Já está sincronizando…' : 'Atualizar vendedores marcados'}</button>
    </>
  );
}

/** Aba "Andamento e historico": o que esta rodando agora (com o tempo) e o historico do que ja terminou. */
export function AndamentoTab() {
  const [lista, setLista] = useState<Lista | null>(null);
  const [rodada, setRodada] = useState<Rodada | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // diferenca entre o relogio do servidor e o deste navegador: o tempo decorrido nao depende do relogio daqui
  const desvio = useRef(0);
  const [, tique] = useState(0);

  const ler = useCallback(async () => {
    try {
      const [l, r] = await Promise.all([api<Lista>('/painel/monitor/sincronizacoes'), api<Rodada>('/painel/vendedores/sincronizacao')]);
      desvio.current = Date.parse(l.agora) - Date.now();
      setLista(l);
      setRodada(r);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  const ativo = (lista?.ativas.length ?? 0) > 0 || rodada?.rodando === true;
  useEffect(() => {
    void ler();
    const t = setInterval(ler, ativo ? 3000 : 20_000);
    return () => clearInterval(t);
  }, [ler, ativo]);
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => tique((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [ativo]);

  const agora = () => Date.now() + desvio.current;

  async function cancelar() {
    if (!window.confirm('Cancelar todas as sincronizações? As que estão na fila saem agora; a que está rodando para em até cerca de 1 minuto. O que já foi baixado fica salvo.')) return;
    try {
      await api('/painel/monitor/sincronizacoes/cancelar', { method: 'POST', body: {} });
      await ler();
    } catch (e) {
      setErro((e as Error).message);
    }
  }
  const mostrarRodada = rodada && (rodada.rodando || rodada.interrompida || rodada.terminou_em);

  return (
    <>
      {erro && <p className="erro-msg">{erro}</p>}
      {!lista && !erro && <div className="vazio">Carregando…</div>}

      {lista && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: '0 0 10px' }}>Em andamento agora</h2>
            {lista.ativas.length > 0 && <button className="btn" style={{ borderColor: '#dc2626', color: '#b91c1c' }} onClick={cancelar}>Cancelar tudo ({lista.ativas.length})</button>}
          </div>
          {lista.ativas.length === 0 && !rodada?.rodando && <div className="vazio" style={{ padding: 16 }}>Nada sincronizando no momento.</div>}
          {lista.ativas.length > 0 && (
            <table>
              <thead><tr><th>Carteira</th><th>O que</th><th>Situação</th><th>Tempo</th></tr></thead>
              <tbody>
                {lista.ativas.map((j) => (
                  <tr key={j.id}>
                    <td>Rota {j.rota}<div className="suave">{j.nome ?? j.cod_vendedor}</div></td>
                    <td>{j.recursos.map((r) => NOME_RECURSO[r]).join(' + ')}</td>
                    <td>
                      <span className={`selo ${j.status === 'rodando' ? 'aviso' : ''}`}>{j.status === 'rodando' ? 'Rodando' : 'Na fila'}</span>
                      {j.status === 'rodando' && j.etapa && <div className="suave">Agora: {j.etapa}</div>}
                      {j.etapas.map((e) => <EtapaLinha key={e.recurso} e={e} />)}
                    </td>
                    <td>
                      {j.iniciado_em ? duracao(agora() - Date.parse(j.iniciado_em)) : <span className="suave">aguardando</span>}
                      <div className="suave">{j.iniciado_em ? `começou ${dataHora(j.iniciado_em)}` : `pedida ${dataHora(j.criado_em)}`}{j.pedido_por ? ` por ${j.pedido_por}` : ''}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {mostrarRodada && (
            <div className="card" style={{ padding: 12, marginTop: 12 }}>
              {rodada.rodando ? (
                <>
                  <strong>Vendedores dos indicadores: {rodada.feitos} de {rodada.total} rotas</strong>
                  {rodada.iniciado_em && <span className="suave"> · {duracao(agora() - Date.parse(rodada.iniciado_em))}</span>}
                  <div className="barra-trilho" style={{ margin: '8px 0' }}><div className="barra" style={{ width: `${rodada.total ? Math.max((rodada.feitos / rodada.total) * 100, 3) : 3}%` }} /></div>
                  <span className="suave">{rodada.atual ? `Agora: vendedor ${rodada.atual}. ` : ''}{rodada.puladas ? `${rodada.puladas} rota${rodada.puladas === 1 ? '' : 's'} já atualizada${rodada.puladas === 1 ? '' : 's'} há menos de 2 h foi pulada. ` : ''}A primeira vez de cada rota busca 12 meses de pedidos e demora mais.</span>
                </>
              ) : rodada.interrompida ? (
                <>
                  <strong style={{ color: '#b45309' }}>A última rodada dos indicadores foi interrompida em {rodada.feitos} de {rodada.total} rotas.</strong>
                  <span className="suave"> O servidor reiniciou no meio. Use "Atualizar vendedores marcados" para continuar; o que já foi baixado fica salvo.</span>
                </>
              ) : (
                <>
                  <strong>Última rodada dos indicadores ({rodada.origem === 'cron' ? 'automática' : 'pelo painel'}): {rodada.feitos - rodada.falhas.length} de {rodada.total} rotas ok</strong>
                  <span className="suave"> · terminou {dataHora(rodada.terminou_em!)}{rodada.iniciado_em ? ` · levou ${duracao(Date.parse(rodada.terminou_em!) - Date.parse(rodada.iniciado_em))}` : ''}</span>
                  {rodada.falhas.map((f) => <div key={f.cod_vendedor} className="erro-msg" style={{ margin: '4px 0 0' }}>Vendedor {f.cod_vendedor}: {f.erro}</div>)}
                </>
              )}
            </div>
          )}

          <h2>Histórico</h2>
          {lista.historico.length === 0 && <div className="vazio" style={{ padding: 16 }}>Nenhuma sincronização manual ainda.</div>}
          {lista.historico.length > 0 && (
            <table>
              <thead><tr><th>Carteira</th><th>O que</th><th>Resultado</th><th>Duração</th><th>Quando</th></tr></thead>
              <tbody>
                {lista.historico.map((j) => (
                  <tr key={j.id}>
                    <td>Rota {j.rota}<div className="suave">{j.nome ?? j.cod_vendedor}</div></td>
                    <td>{j.recursos.map((r) => NOME_RECURSO[r]).join(' + ')}</td>
                    <td>
                      <span className={`selo ${j.status === 'ok' ? 'ok' : 'erro'}`}>{j.status === 'ok' ? 'Concluída' : 'Com erro'}</span>
                      {j.etapas.map((e) => <EtapaLinha key={e.recurso} e={e} />)}
                      {j.status === 'erro' && j.erro && !j.etapas.some((e) => !e.ok) && <div className="erro-msg" style={{ margin: '4px 0 0' }}>{j.erro}</div>}
                    </td>
                    <td>{j.iniciado_em && j.terminou_em ? duracao(Date.parse(j.terminou_em) - Date.parse(j.iniciado_em)) : '—'}</td>
                    <td>{j.terminou_em ? dataHora(j.terminou_em) : '—'}<div className="suave">{j.pedido_por ?? ''}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}

function EtapaLinha({ e }: { e: Etapa }) {
  return e.ok ? (
    <div className="suave">✓ {NOME_ETAPA[e.recurso] ?? e.recurso}{e.linhas != null ? `: ${e.linhas}${e.recurso === 'carteira' ? ' clientes na rota' : e.recurso === 'clientes' ? ' clientes' : e.recurso === 'pedidos' ? ' pedidos' : ''}` : ''} · {e.ms < 1000 ? 'menos de 1 s' : duracao(e.ms)}</div>
  ) : (
    <div className="erro-msg" style={{ margin: '4px 0 0' }}>✗ {e.recurso}: {e.erro}</div>
  );
}
