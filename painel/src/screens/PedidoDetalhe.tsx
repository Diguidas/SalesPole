import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

interface PedidoSapBase {
  ordem: string; cod_cliente: string; cliente: string | null; rota: string | null; vendedor: string | null;
  dt_criacao: string; dt_entrega: string | null; valor: number | null; status: string | null; plataforma: string | null; pedido_externo: string | null;
}
interface Detalhe extends PedidoSapBase {
  vendedores: Array<{ cod_vendedor: string; nome: string | null }>;
  notas: Array<{ nota_fiscal?: string; serie?: string; danfe_url?: string; xml_url?: string; boleto_url?: string }> | number;
  itens: Array<{ item: string; cod_produto: string; denominacao: string | null; quantidade: number | null; unidade_venda: string | null; valor_unitario: number | null; recusa: string | null }>;
  cancelavel: boolean;
  cancelamentos: Array<{ resultado: string; status_antes: string | null; motivo: string | null; por: string | null; criado_em: string }>;
}

const moeda = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBR = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const tomStatus = (s: string | null) => { const t = (s ?? '').toLowerCase(); return t.startsWith('faturado') ? 'ok' : t === 'recusado' ? 'erro' : t ? 'aviso' : ''; };

/** Conteudo da gaveta de um pedido do SAP: itens, notas, cancelamento. */
export function PedidoDetalhe({ ordem, aoMudar }: { ordem: string; aoMudar?: () => void }) {
  const { usuario } = useAuth();
  const podeCancelar = usuario?.papel === 'admin' || usuario?.papel === 'aprovador';
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
      aoMudar?.();
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
      aoMudar?.();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const notas = d && Array.isArray(d.notas) ? d.notas : [];
  const total = d?.itens.reduce((a, i) => a + (i.recusa ? 0 : (i.quantidade ?? 0) * (i.valor_unitario ?? 0)), 0) ?? 0;

  return (
    <>
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
    </>
  );
}
