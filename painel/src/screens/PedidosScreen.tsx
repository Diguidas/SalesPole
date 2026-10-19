import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

interface PedidoSap {
  ordem: string; cod_cliente: string; cliente: string | null; rota: string | null; vendedor: string | null;
  dt_criacao: string; dt_entrega: string | null; valor: number | null; status: string | null; tp_ped: string | null;
  plataforma: string | null; pedido_externo: string | null; notas: number; antecipado: boolean; faturado: boolean; dias: number;
}
interface PedidoApp {
  id: string; codigo: string; tipo: string; status: string; erro: string | null; motivo_rejeicao: string | null; recebido_em: string;
  criado_por_painel: string | null; ordens: string[]; qtd_itens: number; cod_cliente: string; cliente: string | null; cod_vendedor: string; vendedor: string | null;
}
interface Lista<T> { origem: string; pagina: number; por_pagina: number; total: number; itens: T[] }
interface Detalhe extends Omit<PedidoSap, 'notas'> {
  vendedores: Array<{ cod_vendedor: string; nome: string | null }>;
  notas: Array<{ nota_fiscal?: string; serie?: string; danfe_url?: string; xml_url?: string; boleto_url?: string }> | number;
  itens: Array<{ item: string; cod_produto: string; denominacao: string | null; quantidade: number | null; unidade_venda: string | null; valor_unitario: number | null; recusa: string | null }>;
  cancelavel: boolean;
  cancelamentos: Array<{ resultado: string; status_antes: string | null; motivo: string | null; por: string | null; criado_em: string }>;
}
interface Vendedor { cod_vendedor: string; nome: string | null }

const PERIODOS = [{ d: 7, r: '7 dias' }, { d: 30, r: '30 dias' }, { d: 90, r: '90 dias' }, { d: 365, r: '12 meses' }];
const STATUS_SAP = ['Faturado', 'Faturado Parcial', 'A Faturar', 'Aguardando Liberação', 'Liberado para faturamento', 'Recusado'];
const STATUS_APP = [['recebido', 'Recebido'], ['enviando', 'Enviando'], ['enviado', 'Enviado ao SAP'], ['erro', 'Com erro'], ['parcial', 'Parcial'], ['aguardando_aprovacao', 'Aguardando aprovação'], ['aprovado', 'Aprovado'], ['rejeitado', 'Rejeitado']];

const moeda = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBR = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const hojeIso = () => new Date().toLocaleDateString('sv-SE');
const isoDiasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('sv-SE');
const tomStatus = (s: string | null) => { const t = (s ?? '').toLowerCase(); return t.startsWith('faturado') ? 'ok' : t === 'recusado' ? 'erro' : t ? 'aviso' : ''; };

/** Consulta geral de pedidos: os do SAP (com detalhe e cancelamento) e os criados pelo app e pelo painel. */
export function PedidosScreen() {
  const { usuario } = useAuth();
  const [params, setParams] = useSearchParams();
  const [origem, setOrigem] = useState<'sap' | 'app'>('sap');
  const [dias, setDias] = useState(30);
  const [vendedor, setVendedor] = useState(params.get('vendedor') ?? '');
  const [status, setStatus] = useState('');
  // clientes V (pagamento antecipado): acompanhar se o pedido ja foi liberado e faturado
  const [antecipado, setAntecipado] = useState(params.get('antecipado') === '1');
  const [pendentes, setPendentes] = useState(params.get('pendentes') === '1');
  const [busca, setBusca] = useState(params.get('busca') ?? '');
  const [buscaAplicada, setBuscaAplicada] = useState(params.get('busca') ?? '');
  const [pagina, setPagina] = useState(1);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [dados, setDados] = useState<Lista<PedidoSap | PedidoApp> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(params.get('ordem'));

  useEffect(() => {
    api<Vendedor[]>('/painel/pedido-novo/vendedores').then(setVendedores).catch(() => undefined);
  }, []);

  const carregar = useCallback(async () => {
    setErro(null);
    setDados(null);
    try {
      const q = new URLSearchParams({ origem, ini: isoDiasAtras(dias), fim: hojeIso(), pagina: String(pagina) });
      if (vendedor) q.set('vendedor', vendedor);
      if (status) q.set('status', status);
      if (origem === 'sap' && antecipado) q.set('antecipado', '1');
      if (origem === 'sap' && pendentes) q.set('pendentes', '1');
      if (buscaAplicada) q.set('busca', buscaAplicada);
      setDados(await api<Lista<PedidoSap | PedidoApp>>(`/painel/pedidos?${q}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [origem, dias, vendedor, status, antecipado, pendentes, buscaAplicada, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const mudar = (fn: () => void) => { fn(); setPagina(1); };
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.por_pagina)) : 1;
  const abrir = (o: string | null) => { setAberto(o); const p = new URLSearchParams(params); if (o) p.set('ordem', o); else p.delete('ordem'); setParams(p, { replace: true }); };

  return (
    <>
      <h1>Pedidos</h1>
      <p className="sub">Os pedidos do SAP trazem itens, notas e cancelamento; os criados no app e no painel mostram a fila e o que ainda não chegou ao SAP. Para clientes de pagamento antecipado (V), use o filtro e acompanhe se já foram faturados.</p>

      <div className="chips">
        <div className="segmentos">
          <button className={origem === 'sap' ? 'ativo' : ''} onClick={() => mudar(() => { setOrigem('sap'); setStatus(''); })}>Pedidos do SAP</button>
          <button className={origem === 'app' ? 'ativo' : ''} onClick={() => mudar(() => { setOrigem('app'); setStatus(''); })}>Criados no app / painel</button>
        </div>
        {PERIODOS.map((p) => <button key={p.d} className={`chip${dias === p.d ? ' ativo' : ''}`} onClick={() => mudar(() => setDias(p.d))}>{p.r}</button>)}
        {origem === 'sap' && (
          <>
            <span style={{ width: 8 }} />
            <button className={`chip${antecipado ? ' ativo' : ''}`} title="Só pedidos de clientes com pagamento antecipado" onClick={() => mudar(() => { const novo = !antecipado; setAntecipado(novo); setPendentes(novo); })}>Clientes V (antecipado)</button>
            <button className={`chip${pendentes ? ' ativo' : ''}`} title="Esconde os faturados e os recusados" onClick={() => mudar(() => setPendentes((v) => !v))}>Só não faturados</button>
          </>
        )}
      </div>
      <div className="chips">
        <select className="entrada" style={{ minWidth: 200 }} value={vendedor} onChange={(e) => mudar(() => setVendedor(e.target.value))}>
          <option value="">Todos os vendedores</option>
          {vendedores.map((v) => <option key={v.cod_vendedor} value={v.cod_vendedor}>{v.nome ?? v.cod_vendedor}</option>)}
        </select>
        <select className="entrada" style={{ minWidth: 190 }} value={status} onChange={(e) => mudar(() => setStatus(e.target.value))}>
          <option value="">Todos os status</option>
          {origem === 'sap' ? STATUS_SAP.map((s) => <option key={s} value={s}>{s}</option>) : STATUS_APP.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        <form style={{ display: 'flex', gap: 6 }} onSubmit={(e) => { e.preventDefault(); mudar(() => setBuscaAplicada(busca)); }}>
          <input className="entrada" placeholder={origem === 'sap' ? 'Ordem, cliente ou pedido externo' : 'Código do pedido ou cliente'} value={busca} onChange={(e) => setBusca(e.target.value)} />
          <button className="btn" type="submit">Buscar</button>
        </form>
        <button className="chip" onClick={carregar}>Atualizar</button>
      </div>

      {erro && <p className="erro-msg">{erro}</p>}
      {!dados && !erro && <div className="vazio">Carregando…</div>}
      {dados && dados.itens.length === 0 && !erro && <div className="vazio">Nenhum pedido neste filtro.</div>}

      {dados && dados.itens.length > 0 && (
        <>
          <p className="suave" style={{ margin: '0 0 6px' }}>{dados.total.toLocaleString('pt-BR')} pedido{dados.total === 1 ? '' : 's'} · página {dados.pagina} de {totalPaginas}</p>
          {origem === 'sap' ? (
            <table>
              <thead><tr><th>Ordem</th><th>Cliente</th><th>Vendedor</th><th>Criado</th><th>Entrega</th><th style={{ textAlign: 'right' }}>Valor</th><th>Status</th></tr></thead>
              <tbody>
                {(dados.itens as PedidoSap[]).map((p) => (
                  <tr key={p.ordem} onClick={() => abrir(p.ordem)} className="clicavel">
                    <td>{p.ordem}{p.notas > 0 ? <span className="suave"> · NF</span> : null}</td>
                    <td>{p.cliente ?? p.cod_cliente}{p.antecipado ? <span className="selo aviso" style={{ marginLeft: 6 }} title="Pagamento antecipado">V</span> : null}</td>
                    <td>{p.vendedor ?? '—'}</td>
                    <td>{dataBR(p.dt_criacao)}<div className="suave" style={p.antecipado && !p.faturado && p.dias >= 3 && (p.status ?? '').toLowerCase() !== 'recusado' ? { color: '#b45309', fontWeight: 600 } : undefined}>{p.dias === 0 ? 'hoje' : `há ${p.dias} d`}</div></td>
                    <td>{dataBR(p.dt_entrega)}</td>
                    <td style={{ textAlign: 'right' }}>{moeda(p.valor)}</td>
                    <td><span className={`selo ${tomStatus(p.status)}`}>{p.status ?? '—'}</span>{p.faturado && !(p.status ?? '').toLowerCase().startsWith('faturado') ? <div className="suave">com nota fiscal</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Código</th><th>Cliente</th><th>Vendedor</th><th>Recebido</th><th>Itens</th><th>Ordens no SAP</th><th>Status</th></tr></thead>
              <tbody>
                {(dados.itens as PedidoApp[]).map((p) => (
                  <tr key={p.id}>
                    <td>#{p.codigo}{p.tipo === 'bonificacao' ? <span className="selo aviso" style={{ marginLeft: 6 }}>bonificação</span> : null}{p.criado_por_painel ? <div className="suave">pelo painel · {p.criado_por_painel}</div> : null}</td>
                    <td>{p.cliente ?? p.cod_cliente}</td>
                    <td>{p.vendedor ?? p.cod_vendedor}</td>
                    <td>{dataHora(p.recebido_em)}</td>
                    <td>{p.qtd_itens}</td>
                    <td>{p.ordens.length ? p.ordens.map((o) => <a key={o} href="#" onClick={(e) => { e.preventDefault(); mudar(() => { setOrigem('sap'); setBuscaAplicada(o); setBusca(o); setDias(365); }); abrir(o); }} style={{ marginRight: 8 }}>{o}</a>) : '—'}</td>
                    <td>
                      <span className={`selo ${p.status === 'enviado' ? 'ok' : p.status === 'erro' || p.status === 'rejeitado' ? 'erro' : 'aviso'}`}>{STATUS_APP.find(([v]) => v === p.status)?.[1] ?? p.status}</span>
                      {p.erro ? <div className="erro-msg" style={{ margin: '4px 0 0' }}>{p.erro}</div> : null}
                      {p.motivo_rejeicao ? <div className="suave">Motivo: {p.motivo_rejeicao}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button className="btn" disabled={pagina <= 1} onClick={() => setPagina((n) => n - 1)}>← Anterior</button>
            <span className="suave">Página {pagina} de {totalPaginas}</span>
            <button className="btn" disabled={pagina >= totalPaginas} onClick={() => setPagina((n) => n + 1)}>Próxima →</button>
          </div>
        </>
      )}

      {aberto && <DetalhePedido ordem={aberto} podeCancelar={usuario?.papel === 'admin' || usuario?.papel === 'aprovador'} aoFechar={() => abrir(null)} aoMudar={carregar} />}
    </>
  );
}

function DetalhePedido({ ordem, podeCancelar, aoFechar, aoMudar }: { ordem: string; podeCancelar: boolean; aoFechar: () => void; aoMudar: () => void }) {
  const [d, setD] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const carregar = useCallback(async () => {
    try {
      setD(await api<Detalhe>(`/painel/pedidos/${ordem}`));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [ordem]);

  useEffect(() => {
    setD(null);
    void carregar();
  }, [carregar]);

  async function atualizar() {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      setD(await api<Detalhe>(`/painel/pedidos/${ordem}/atualizar`, { method: 'POST', body: {} }));
      setAviso('Dados atualizados do SAP.');
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function cancelar() {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      await api(`/painel/pedidos/${ordem}/cancelar`, { method: 'POST', body: { motivo } });
      setCancelando(false);
      setMotivo('');
      setAviso('Pedido cancelado no SAP.');
      await carregar();
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const notas = d && Array.isArray(d.notas) ? d.notas : [];
  const total = d?.itens.reduce((a, i) => a + (i.recusa ? 0 : (i.quantidade ?? 0) * (i.valor_unitario ?? 0)), 0) ?? 0;

  return (
    <div className="gaveta-fundo" onClick={aoFechar}>
      <div className="gaveta" onClick={(e) => e.stopPropagation()}>
        <div className="linha" style={{ alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Pedido {ordem}</h2>
          <button className="btn" onClick={aoFechar}>Fechar</button>
        </div>
        {!d && !erro && <div className="vazio">Carregando…</div>}
        {erro && <p className="erro-msg">{erro}</p>}
        {aviso && <p style={{ color: '#166534', fontSize: 13 }}>{aviso}</p>}
        {d && (
          <>
            <div className="card" style={{ padding: 12 }}>
              <div className="linha">
                <div>
                  <div className="titulo"><Link to={`/clientes/${d.cod_cliente}`}>{d.cliente ?? d.cod_cliente}</Link> <span className="suave">· {d.cod_cliente}</span></div>
                  <div className="suave">Vendedor: {d.vendedores.map((v) => v.nome ?? v.cod_vendedor).join(' / ') || '—'}{d.rota ? ` · rota ${d.rota}` : ''}</div>
                  <div className="suave">Criado {dataBR(d.dt_criacao)} · entrega {dataBR(d.dt_entrega)}{d.plataforma ? ` · ${d.plataforma}` : ''}{d.pedido_externo ? ` · externo ${d.pedido_externo}` : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`selo ${tomStatus(d.status)}`}>{d.status ?? '—'}</span>
                  <div className="titulo" style={{ marginTop: 6 }}>{moeda(d.valor)}</div>
                </div>
              </div>
            </div>

            <div className="titulo" style={{ margin: '12px 0 6px' }}>Itens</div>
            {d.itens.length === 0 ? (
              <p className="suave">Os itens deste pedido ainda não foram baixados. Clique em "Atualizar do SAP".</p>
            ) : (
              <table>
                <thead><tr><th>Produto</th><th style={{ textAlign: 'right' }}>Qtd</th><th style={{ textAlign: 'right' }}>Unitário</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
                <tbody>
                  {d.itens.map((i) => (
                    <tr key={i.item} style={{ opacity: i.recusa ? 0.6 : 1 }}>
                      <td>{i.denominacao ?? i.cod_produto} <span className="suave">· {i.cod_produto}</span>{i.recusa ? <div className="erro-msg" style={{ margin: 0 }}>Recusado: {i.recusa}</div> : null}</td>
                      <td style={{ textAlign: 'right' }}>{i.quantidade ?? '—'} {i.unidade_venda ?? ''}</td>
                      <td style={{ textAlign: 'right' }}>{moeda(i.valor_unitario)}</td>
                      <td style={{ textAlign: 'right' }}>{i.recusa ? '—' : moeda((i.quantidade ?? 0) * (i.valor_unitario ?? 0))}</td>
                    </tr>
                  ))}
                  <tr><td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Total dos itens</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{moeda(total)}</td></tr>
                </tbody>
              </table>
            )}

            {notas.length > 0 && (
              <>
                <div className="titulo" style={{ margin: '12px 0 6px' }}>Notas fiscais</div>
                {notas.map((n, k) => (
                  <div key={k} className="suave">NF {n.nota_fiscal ?? '—'}{n.serie ? `/${n.serie}` : ''} {n.danfe_url ? <a href={n.danfe_url} target="_blank" rel="noreferrer">DANFE</a> : null} {n.xml_url ? <a href={n.xml_url} target="_blank" rel="noreferrer">XML</a> : null} {n.boleto_url ? <a href={n.boleto_url} target="_blank" rel="noreferrer">Boleto</a> : null}</div>
                ))}
              </>
            )}

            {d.cancelamentos.length > 0 && (
              <>
                <div className="titulo" style={{ margin: '12px 0 6px' }}>Histórico de cancelamento</div>
                {d.cancelamentos.map((c, k) => (
                  <div key={k} className="suave">{dataHora(c.criado_em)} · <strong>{c.resultado === 'cancelado' ? 'Cancelado' : c.resultado === 'recusado' ? 'SAP recusou' : 'Erro'}</strong> · {c.por ? `por ${c.por}` : 'pelo vendedor no app'}{c.motivo ? ` · motivo: ${c.motivo}` : ''}</div>
                ))}
              </>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn" disabled={ocupado} onClick={atualizar}>{ocupado ? 'Aguarde…' : 'Atualizar do SAP'}</button>
              {podeCancelar && d.cancelavel && !cancelando && <button className="btn erro" disabled={ocupado} onClick={() => setCancelando(true)}>Cancelar pedido</button>}
            </div>
            {podeCancelar && !d.cancelavel && <p className="suave" style={{ marginTop: 8 }}>Neste status ({d.status ?? 'sem status'}) o cancelamento não está liberado. Os status liberados ficam em Parâmetros.</p>}
            {cancelando && (
              <div className="card" style={{ marginTop: 10, borderColor: '#dc2626' }}>
                <strong>Cancelar o pedido {ordem} no SAP?</strong>
                <div className="suave">Isso não pode ser desfeito. O SAP ainda recusa o que já foi faturado.</div>
                <textarea placeholder="Motivo (opcional, fica registrado)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn erro" disabled={ocupado} onClick={cancelar}>{ocupado ? 'Cancelando…' : 'Confirmar cancelamento'}</button>
                  <button className="btn" onClick={() => setCancelando(false)}>Voltar</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
