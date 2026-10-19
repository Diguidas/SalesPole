import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

interface Sinc { recurso: string; escopo: string; operacional: boolean; ultimo_sucesso: string | null; idade_min: number | null; erro: string | null; erro_em: string | null; situacao: 'ok' | 'atrasado' | 'erro' }
interface PedidoProblema {
  id: string; codigo: string; tipo: string | null; status: string; erro: string | null; tentativas: number;
  proxima_tentativa_em: string | null; recebido_em: string; parado_min: number;
  vendedor: string | null; cod_vendedor: string; cliente: string | null; cod_cliente: string;
}
interface Cancelamento { id: number; ordem: string; vendedor: string | null; cod_vendedor: string; status_antes: string | null; motivo: string | null; resultado: string; http: number | null; criado_em: string }
interface Monitor {
  gerado_em: string;
  resumo: { pedidos_com_problema: number; sincs_com_problema: number; bonificacoes_aguardando: number; visitas_pendentes: number };
  sincs: Sinc[];
  pedidos_por_status: Record<string, number>;
  pedidos_problema: PedidoProblema[];
  cancelamentos_com_problema: Cancelamento[];
}

const NOME_RECURSO: Record<string, string> = {
  vendedor: 'Vendedor e carteira', clientes: 'Clientes', produtos: 'Produtos', precos: 'Preços',
  pedidos: 'Pedidos do SAP', titulos: 'Títulos financeiros', remessas: 'Remessas', estoque: 'Estoque',
};
const NOME_STATUS: Record<string, string> = {
  recebido: 'Recebido', enviando: 'Enviando', enviado: 'Enviado ao SAP', erro: 'Com erro', parcial: 'Parcial',
  aguardando_aprovacao: 'Aguardando aprovação', aprovado: 'Aprovado', rejeitado: 'Rejeitado',
};
const SELO = { ok: 'ok', atrasado: 'aviso', erro: 'erro' } as const;

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
function idade(min: number | null) {
  if (min == null) return 'nunca';
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.floor(min / 60)} h`;
  return `há ${Math.floor(min / 1440)} dias`;
}

/** Saude do sistema: sincronizacao com o SAP, fila de pedidos e o que precisa de atencao. Atualiza sozinho a cada minuto. */
export function MonitorScreen() {
  const { usuario } = useAuth();
  const podeReenviar = usuario?.papel === 'admin' || usuario?.papel === 'aprovador';
  const [m, setM] = useState<Monitor | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setM(await api<Monitor>('/painel/monitor'));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void carregar();
    const t = setInterval(carregar, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  async function reenviar(p: PedidoProblema) {
    setOcupado(p.id);
    setAviso(null);
    setErro(null);
    try {
      const r = await api<{ status: string; erro: string | null }>(`/painel/monitor/pedidos/${p.id}/reenviar`, { method: 'POST', body: {} });
      setAviso(r.status === 'erro' ? `Pedido ${p.codigo}: o SAP recusou de novo (${r.erro ?? 'sem detalhe'}).` : `Pedido ${p.codigo} reenviado: ${NOME_STATUS[r.status] ?? r.status}.`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const r = m?.resumo;
  const tudoOk = !!r && r.pedidos_com_problema === 0 && r.sincs_com_problema === 0 && m.cancelamentos_com_problema.length === 0;

  return (
    <>
      <h1>Monitor</h1>
      <p className="sub">
        Saúde da integração com o SAP e da fila de pedidos.{m ? ` Atualizado às ${new Date(m.gerado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}; renova sozinho a cada minuto.` : ''}
      </p>
      <div className="chips"><button className="chip" onClick={carregar}>Atualizar agora</button></div>
      {erro && <p className="erro-msg">{erro}</p>}
      {aviso && <p style={{ color: '#166534', fontSize: 13 }}>{aviso}</p>}
      {!m && !erro && <div className="vazio">Carregando…</div>}

      {m && r && (
        <>
          <div className="cartoes">
            <Cartao titulo="Sincronização" valor={r.sincs_com_problema} bom="Tudo em dia" ruim="com problema" />
            <Cartao titulo="Pedidos" valor={r.pedidos_com_problema} bom="Nenhum com problema" ruim="precisam de atenção" />
            <Cartao titulo="Bonificações" valor={r.bonificacoes_aguardando} bom="Nenhuma na fila" ruim="aguardando aprovação" neutro para="/bonificacoes" />
            <Cartao titulo="Visitas" valor={r.visitas_pendentes} bom="Nenhuma na fila" ruim="aguardando validação" neutro para="/visitas" />
          </div>
          {tudoOk && <p className="suave">Nenhum problema de integração no momento.</p>}

          <h2>Sincronização com o SAP</h2>
          <table>
            <thead><tr><th>O que</th><th>Rota</th><th>Última atualização</th><th>Situação</th></tr></thead>
            <tbody>
              {m.sincs.length === 0 && <tr><td colSpan={4} className="suave">Nenhuma sincronização registrada ainda.</td></tr>}
              {m.sincs.map((s) => (
                <tr key={`${s.recurso}|${s.escopo}`}>
                  <td>{NOME_RECURSO[s.recurso] ?? s.recurso}</td>
                  <td>{s.escopo === '*' ? 'todas' : s.escopo}</td>
                  <td>{s.ultimo_sucesso ? `${dataHora(s.ultimo_sucesso)} (${idade(s.idade_min)})` : 'nunca atualizou'}</td>
                  <td>
                    <span className={`selo ${SELO[s.situacao]}`}>{s.situacao === 'ok' ? 'Em dia' : s.situacao === 'atrasado' ? 'Atrasada' : 'Com erro'}</span>
                    {s.erro && <div className="erro-msg" style={{ margin: '4px 0 0' }}>{s.erro}{s.erro_em ? ` (${dataHora(s.erro_em)})` : ''}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Pedidos dos últimos 7 dias</h2>
          <div className="chips">
            {Object.keys(m.pedidos_por_status).length === 0 && <span className="suave">Nenhum pedido no período.</span>}
            {Object.entries(m.pedidos_por_status).map(([st, n]) => (
              <span key={st} className={`selo ${st === 'erro' ? 'erro' : st === 'enviado' ? 'ok' : st === 'parcial' ? 'aviso' : ''}`}>{NOME_STATUS[st] ?? st}: {n}</span>
            ))}
          </div>

          <h2>Pedidos que precisam de atenção</h2>
          {m.pedidos_problema.length === 0 && <div className="vazio" style={{ padding: 16 }}>Nenhum pedido com erro ou parado.</div>}
          {m.pedidos_problema.map((p) => (
            <div className="card" key={p.id}>
              <div className="linha">
                <div>
                  <div className="titulo">#{p.codigo} · {p.cliente ?? p.cod_cliente}{p.tipo === 'bonificacao' ? ' · bonificação' : ''}</div>
                  <div className="suave">{p.vendedor ?? p.cod_vendedor} · recebido {dataHora(p.recebido_em)} · {p.tentativas} tentativa{p.tentativas === 1 ? '' : 's'} · parado {idade(p.parado_min).replace('há ', '')}</div>
                </div>
                <span className={`selo ${p.status === 'erro' ? 'erro' : 'aviso'}`}>{NOME_STATUS[p.status] ?? p.status}</span>
              </div>
              {p.erro && <p className="erro-msg" style={{ marginBottom: 0 }}>{p.erro}</p>}
              {p.proxima_tentativa_em && <p className="suave" style={{ margin: '6px 0 0' }}>Próxima tentativa automática: {dataHora(p.proxima_tentativa_em)}</p>}
              {p.status === 'erro' && podeReenviar && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn" disabled={ocupado === p.id} onClick={() => reenviar(p)}>{ocupado === p.id ? 'Reenviando…' : 'Reenviar ao SAP'}</button>
                  <span className="suave" style={{ marginLeft: 10 }}>Corrija a causa (cliente, estoque, cadastro) antes de reenviar.</span>
                </div>
              )}
            </div>
          ))}

          {m.cancelamentos_com_problema.length > 0 && (
            <>
              <h2>Cancelamentos que não deram certo</h2>
              <table>
                <thead><tr><th>Ordem</th><th>Vendedor</th><th>Status antes</th><th>Quando</th><th>Resultado</th></tr></thead>
                <tbody>
                  {m.cancelamentos_com_problema.map((c) => (
                    <tr key={c.id}>
                      <td>{c.ordem}</td>
                      <td>{c.vendedor ?? c.cod_vendedor}</td>
                      <td>{c.status_antes ?? '—'}</td>
                      <td>{dataHora(c.criado_em)}</td>
                      <td><span className={`selo ${c.resultado === 'erro' ? 'erro' : 'aviso'}`}>{c.resultado === 'erro' ? 'Erro do SAP' : 'SAP recusou'}{c.http ? ` (${c.http})` : ''}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </>
  );
}

function Cartao({ titulo, valor, bom, ruim, neutro, para }: { titulo: string; valor: number; bom: string; ruim: string; neutro?: boolean; para?: string }) {
  const corpo = (
    <>
      <div className="suave">{titulo}</div>
      <div className="numero" style={{ color: valor === 0 ? '#16a34a' : neutro ? '#c2410c' : '#dc2626' }}>{valor === 0 ? '✓' : valor}</div>
      <div className="suave">{valor === 0 ? bom : ruim}</div>
    </>
  );
  return para ? <Link to={para} className="cartao">{corpo}</Link> : <div className="cartao">{corpo}</div>;
}
