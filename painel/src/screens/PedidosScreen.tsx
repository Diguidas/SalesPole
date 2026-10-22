import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useGavetas } from '../gavetas';
import { PedidoDetalhe } from './PedidoDetalhe';
import { imprimirPedidoApp } from '../pdfPedido';

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
  const gavetas = useGavetas();
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
  const [gerandoPdf, setGerandoPdf] = useState<string | null>(null);

  async function gerarPdf(id: string) {
    setGerandoPdf(id);
    setErro(null);
    try {
      await imprimirPedidoApp(id);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setGerandoPdf(null);
    }
  }

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
  const carregarRef = useRef(carregar);
  carregarRef.current = carregar;

  const mudar = (fn: () => void) => { fn(); setPagina(1); };
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.por_pagina)) : 1;
  // abre o pedido numa gaveta lateral (empilha por cima de outras); a ordem fica na URL para poder compartilhar o link
  const abrir = useCallback((o: string) => {
    setParams((p) => { const n = new URLSearchParams(p); n.set('ordem', o); return n; }, { replace: true });
    gavetas.abrir({
      id: `pedido-${o}`,
      titulo: `Pedido ${o}`,
      conteudo: <PedidoDetalhe ordem={o} aoMudar={() => void carregarRef.current()} />,
      aoFechar: () => setParams((p) => { const n = new URLSearchParams(p); n.delete('ordem'); return n; }, { replace: true }),
    });
  }, [gavetas, setParams]);

  // link com ?ordem=...: abre a gaveta ao entrar na tela
  useEffect(() => {
    const o = params.get('ordem');
    if (o) abrir(o);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          {dados.origem === 'sap' ? (
            <table>
              <thead><tr><th>Ordem</th><th>Cliente</th><th>Vendedor</th><th>Criado</th><th>Entrega</th><th style={{ textAlign: 'right' }}>Valor</th><th>Status</th></tr></thead>
              <tbody>
                {(dados.itens as PedidoSap[]).map((p) => (
                  <tr key={p.ordem} onClick={() => abrir(p.ordem)} className="clicavel">
                    <td>{p.ordem}{p.notas > 0 ? <span className="suave"> · NF</span> : null}</td>
                    <td>{p.cliente ?? p.cod_cliente}{p.antecipado ? <span className="selo aviso" style={{ marginLeft: 6 }} title="Pagamento antecipado">V</span> : null}</td>
                    <td>{p.vendedor ?? '—'}</td>
                    <td>{dataBR(p.dt_criacao)}<div className="suave" style={p.antecipado && !p.faturado && p.dias >= 3 && (p.status ?? '').toLowerCase() !== 'recusado' ? { color: 'var(--c-aviso)', fontWeight: 600 } : undefined}>{p.dias === 0 ? 'hoje' : `há ${p.dias} d`}</div></td>
                    <td>{dataBR(p.dt_entrega)}</td>
                    <td style={{ textAlign: 'right' }}>{moeda(p.valor)}</td>
                    <td><span className={`selo ${tomStatus(p.status)}`}>{p.status ?? '—'}</span>{p.faturado && !(p.status ?? '').toLowerCase().startsWith('faturado') ? <div className="suave">com nota fiscal</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Código</th><th>Cliente</th><th>Vendedor</th><th>Recebido</th><th>Itens</th><th>Ordens no SAP</th><th>Status</th><th>PDF</th></tr></thead>
              <tbody>
                {(dados.itens as PedidoApp[]).map((p) => (
                  <tr key={p.id}>
                    <td>#{p.codigo}{p.tipo === 'bonificacao' ? <span className="selo aviso" style={{ marginLeft: 6 }}>bonificação</span> : null}{p.criado_por_painel ? <div className="suave">pelo painel · {p.criado_por_painel}</div> : null}</td>
                    <td>{p.cliente ?? p.cod_cliente}</td>
                    <td>{p.vendedor ?? p.cod_vendedor}</td>
                    <td>{dataHora(p.recebido_em)}</td>
                    <td>{p.qtd_itens}</td>
                    <td>{p.ordens.length ? p.ordens.map((o) => <a key={o} href="#" onClick={(e) => { e.preventDefault(); abrir(o); }} style={{ marginRight: 8 }}>{o}</a>) : '—'}</td>
                    <td>
                      <span className={`selo ${p.status === 'enviado' ? 'ok' : p.status === 'erro' || p.status === 'rejeitado' ? 'erro' : 'aviso'}`}>{STATUS_APP.find(([v]) => v === p.status)?.[1] ?? p.status}</span>
                      {p.erro ? <div className="erro-msg" style={{ margin: '4px 0 0' }}>{p.erro}</div> : null}
                      {p.motivo_rejeicao ? <div className="suave">Motivo: {p.motivo_rejeicao}</div> : null}
                    </td>
                    <td>
                      <button className="btn" disabled={gerandoPdf === p.id || p.status === 'rascunho'} onClick={() => gerarPdf(p.id)} title="Abre a confirmação do pedido; escolha Salvar como PDF">{gerandoPdf === p.id ? 'Gerando…' : 'PDF'}</button>
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

    </>
  );
}
