import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { dataBR, moeda, moeda0, NOME_DIA, NOME_DIA_CURTO, useVendedorAlvo } from './vendedor';
import { AlertasPedidos } from './AlertasPedidos';

interface ClienteDia {
  cod_cliente: string; nome: string | null; cidade: string | null; uf: string | null; sequencia: number; bloqueado: boolean; pagamento_antecipado: boolean;
  limite_disponivel: number | null; ultima_compra: string | null; dias_sem_comprar: number | null; vencido: number;
  visita_id: string | null; visita_status: string | null; visita_resultado: string | null; comprou_hoje: boolean;
}
interface Entrega { cod_cliente: string; nome: string | null; ordens: number; itens: number; com_corte: boolean }
interface Venda { mes: string; valor: number; pedidos: number; clientes: number }
interface Hoje {
  vendedor: { cod_vendedor: string; nome: string | null; rota: string };
  data: string; dia_semana: number; eh_hoje: boolean;
  vendas_mes: Venda & { anterior: Venda };
  resumo: { planejadas: number; visitadas: number; em_andamento: number; com_venda: number; bloqueados: number; com_vencido: number };
  roteiro: ClienteDia[]; entregas: Entrega[];
}
interface Aviso { id: string; titulo: string; mensagem: string; nivel: string; atualizado_em: string }
interface Pergunta { id: string; texto: string; tipo: string; opcoes: string | null; obrigatoria: boolean }

const NOME_MES = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const LIDOS = 'salespole.avisos.lidos';
const lidos = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(LIDOS) ?? '{}'); } catch { return {}; } };

/** Avisos do painel para o vendedor (os mais urgentes primeiro). Ficam escondidos depois de lidos; se forem editados, voltam. */
function Avisos({ qs }: { qs: string }) {
  const [lista, setLista] = useState<Aviso[]>([]);
  useEffect(() => {
    api<Aviso[]>(`/meu/avisos${qs ? `?${qs}` : ''}`).then((l) => { const j = lidos(); setLista(l.filter((a) => j[a.id] !== a.atualizado_em)); }).catch(() => undefined);
  }, [qs]);
  const lerAviso = (a: Aviso) => {
    try { localStorage.setItem(LIDOS, JSON.stringify({ ...lidos(), [a.id]: a.atualizado_em })); } catch { /* sem armazenamento: o aviso volta na proxima visita */ }
    setLista((l) => l.filter((x) => x.id !== a.id));
  };
  if (!lista.length) return null;
  const cor = (n: string) => (n === 'urgente' ? 'var(--c-erro)' : n === 'importante' ? 'var(--c-aviso-borda)' : 'var(--c-prim)');
  return (
    <div style={{ marginBottom: 12 }}>
      {lista.map((a) => (
        <div key={a.id} className="card" style={{ borderLeft: `4px solid ${cor(a.nivel)}`, display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="titulo">{a.titulo}</div>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{a.mensagem}</div>
          </div>
          <button className="btn" onClick={() => lerAviso(a)}>Li, fechar</button>
        </div>
      ))}
    </div>
  );
}

function Variacao({ atual, anterior }: { atual: number; anterior: number }) {
  if (!anterior) return null;
  const pct = ((atual - anterior) / anterior) * 100;
  return <div className="suave" style={{ color: pct >= 0 ? 'var(--c-ok-texto)' : 'var(--c-erro)' }}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}% vs mês anterior ({moeda0(anterior)})</div>;
}

/** Janela de conclusao da visita: vendeu ou nao vendeu (com motivo) e as perguntas cadastradas no painel. Sem GPS e sem foto. */
function ConcluirVisita({ cliente, qs, aoFechar, aoConcluir }: { cliente: ClienteDia; qs: string; aoFechar: () => void; aoConcluir: () => void }) {
  const [perguntas, setPerguntas] = useState<Pergunta[]>([]);
  const [resultado, setResultado] = useState<'vendeu' | 'nao_vendeu' | ''>(cliente.comprou_hoje ? 'vendeu' : '');
  const [motivo, setMotivo] = useState('');
  const [obs, setObs] = useState('');
  const [resp, setResp] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<Pergunta[]>(`/meu/visita-perguntas/${cliente.cod_cliente}${qs ? `?${qs}` : ''}`).then(setPerguntas).catch((e) => setErro((e as Error).message));
  }, [cliente.cod_cliente, qs]);

  const faltaPergunta = perguntas.some((p) => p.obrigatoria && !(resp[p.id] ?? '').trim());
  const pronto = !!resultado && (resultado === 'vendeu' || motivo.trim().length >= 3) && !faltaPergunta;

  async function concluir() {
    setEnviando(true);
    setErro(null);
    try {
      await api(`/meu/visitas/${cliente.visita_id}/concluir`, {
        method: 'POST',
        body: {
          resultado, motivo_nao_venda: resultado === 'nao_vendeu' ? motivo : null, observacao: obs || null,
          respostas: perguntas.filter((p) => (resp[p.id] ?? '').trim()).map((p) => ({ pergunta_id: p.id, pergunta: p.texto, resposta: resp[p.id].trim() })),
        },
      });
      aoConcluir();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="lightbox" style={{ cursor: 'default', alignItems: 'flex-start', overflow: 'auto', padding: 24 }} onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="card" style={{ width: 520, maxWidth: '100%', margin: '0 auto' }}>
        <div className="titulo" style={{ fontSize: 17 }}>Concluir visita</div>
        <div className="suave" style={{ marginBottom: 12 }}>{cliente.nome ?? cliente.cod_cliente} · {cliente.cod_cliente}</div>

        <div className="titulo" style={{ marginBottom: 6 }}>Resultado *</div>
        <div className="segmentos">
          <button className={resultado === 'vendeu' ? 'ativo' : ''} onClick={() => setResultado('vendeu')}>Vendeu</button>
          <button className={resultado === 'nao_vendeu' ? 'ativo' : ''} onClick={() => setResultado('nao_vendeu')}>Não vendeu</button>
        </div>
        {resultado === 'nao_vendeu' && (
          <label className="campo" style={{ marginTop: 10 }}>
            <span>Motivo *</span>
            <input type="text" value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: estoque cheio, loja fechada, preço…" />
          </label>
        )}

        {perguntas.length > 0 && <div className="titulo" style={{ margin: '14px 0 6px' }}>Perguntas da visita</div>}
        {perguntas.map((p) => (
          <label className="campo" key={p.id} style={{ marginBottom: 8 }}>
            <span>{p.texto}{p.obrigatoria ? ' *' : ''}</span>
            {p.tipo === 'sim_nao' ? (
              <select value={resp[p.id] ?? ''} onChange={(e) => setResp({ ...resp, [p.id]: e.target.value })}><option value="">Escolha…</option><option>Sim</option><option>Não</option></select>
            ) : p.tipo === 'opcoes' ? (
              <select value={resp[p.id] ?? ''} onChange={(e) => setResp({ ...resp, [p.id]: e.target.value })}>
                <option value="">Escolha…</option>
                {(p.opcoes ?? '').split(';').map((o) => o.trim()).filter(Boolean).map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input type="text" inputMode={p.tipo === 'numero' ? 'decimal' : undefined} value={resp[p.id] ?? ''} maxLength={500} onChange={(e) => setResp({ ...resp, [p.id]: e.target.value })} />
            )}
          </label>
        ))}

        <label className="campo" style={{ marginTop: 10 }}>
          <span>Observação <small className="suave">(opcional)</small></span>
          <input type="text" value={obs} maxLength={500} onChange={(e) => setObs(e.target.value)} />
        </label>

        {erro && <p className="erro-msg">{erro}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn" onClick={aoFechar}>Voltar</button>
          <button className="btn ok" disabled={!pronto || enviando} onClick={concluir}>{enviando ? 'Salvando…' : 'Concluir visita'}</button>
        </div>
      </div>
    </div>
  );
}

function SeloVisita({ c }: { c: ClienteDia }) {
  if (c.visita_status === 'concluida') return c.visita_resultado === 'vendeu' ? <span className="selo ok">Visitado · vendeu</span> : <span className="selo aviso">Visitado · não vendeu</span>;
  if (c.visita_status === 'em_andamento') return <span className="selo aviso">Visita em andamento</span>;
  if (c.comprou_hoje) return <span className="selo ok">Comprou hoje</span>;
  return <span className="selo">A visitar</span>;
}

/** Tela inicial de quem vende: o dia (roteiro, entregas), o mes e o que pede atencao. */
export function HojeScreen() {
  const alvo = useVendedorAlvo();
  const [dia, setDia] = useState<number | null>(null);
  const [d, setD] = useState<Hoje | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [concluindo, setConcluindo] = useState<ClienteDia | null>(null);

  const carregar = useCallback(async () => {
    if (!alvo.pronto) return;
    setErro(null);
    try {
      const q = [alvo.qs, dia ? `dia=${dia}` : ''].filter(Boolean).join('&');
      const r = await api<Hoje>(`/meu/hoje${q ? `?${q}` : ''}`);
      setD(r);
      if (dia === null) setDia(r.dia_semana);
    } catch (e) {
      setD(null);
      setErro((e as Error).message);
    }
  }, [alvo.pronto, alvo.qs, dia]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function iniciar(c: ClienteDia) {
    setOcupado(c.cod_cliente);
    setErro(null);
    try {
      await api('/meu/visitas', { method: 'POST', body: { cod_cliente: c.cod_cliente, vendedor: alvo.proprio ? undefined : alvo.vendedor } });
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const novoPedido = (c: ClienteDia) => `/novo-pedido?${alvo.proprio ? `vendedor=${d?.vendedor.cod_vendedor}&` : `vendedor=${alvo.vendedor}&`}cliente=${c.cod_cliente}`;
  const hojeDt = d ? new Date(`${d.data}T12:00:00`) : null;
  const mesNome = d ? NOME_MES[Number(d.vendas_mes.mes.slice(5, 7))] : '';

  return (
    <>
      <h1>{d?.eh_hoje === false ? `Roteiro de ${NOME_DIA[d.dia_semana].toLowerCase()}` : 'Hoje'}</h1>
      <p className="sub">
        {hojeDt ? `${hojeDt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}` : 'Seu dia de vendas'}
        {d ? ` · ${d.vendedor.nome ?? d.vendedor.cod_vendedor}` : ''}
      </p>

      {!alvo.proprio && (
        <div className="chips">
          <select className="entrada" style={{ minWidth: 240 }} value={alvo.vendedor} onChange={(e) => { setD(null); setDia(null); alvo.setVendedor(e.target.value); }}>
            <option value="">Escolha o vendedor…</option>
            {alvo.opcoes.map((v) => <option key={v.cod_vendedor} value={v.cod_vendedor}>{v.nome ?? v.cod_vendedor}</option>)}
          </select>
        </div>
      )}
      {alvo.pronto && <Avisos qs={alvo.qs} />}
      {erro && <p className="erro-msg">{erro}</p>}
      {!alvo.pronto && <div className="vazio">Escolha um vendedor para ver o dia dele.</div>}
      {alvo.pronto && !d && !erro && <div className="vazio">Carregando…</div>}

      {d && (
        <>
          <div className="cartoes">
            <div className="cartao">
              <div className="suave">Vendas em {mesNome}</div>
              <div className="numero">{moeda0(d.vendas_mes.valor)}</div>
              <div className="suave">{d.vendas_mes.pedidos} pedido{d.vendas_mes.pedidos === 1 ? '' : 's'} · {d.vendas_mes.clientes} cliente{d.vendas_mes.clientes === 1 ? '' : 's'}</div>
              <Variacao atual={d.vendas_mes.valor} anterior={d.vendas_mes.anterior.valor} />
            </div>
            <div className="cartao">
              <div className="suave">Visitas do dia</div>
              <div className="numero">{d.resumo.visitadas}<span className="suave" style={{ fontSize: 16 }}> / {d.resumo.planejadas}</span></div>
              <div className="suave">{d.resumo.em_andamento > 0 ? `${d.resumo.em_andamento} em andamento · ` : ''}{d.resumo.com_venda} com venda</div>
            </div>
            <div className="cartao">
              <div className="suave">Pedem atenção</div>
              <div className="numero">{d.resumo.com_vencido + d.resumo.bloqueados}</div>
              <div className="suave">{d.resumo.com_vencido} com título vencido · {d.resumo.bloqueados} bloqueado{d.resumo.bloqueados === 1 ? '' : 's'}</div>
            </div>
            <Link className="cartao" to="/carteira-parada"><div className="suave">Carteira parada</div><div className="numero">Ver →</div><div className="suave">quem não compra há 15, 30, 60 dias…</div></Link>
          </div>

          <AlertasPedidos qs={alvo.qs} />

          {d.entregas.length > 0 && (
            <>
              <h2>Entregas de hoje</h2>
              <table>
                <thead><tr><th>Cliente</th><th>Ordens</th><th>Itens</th><th /></tr></thead>
                <tbody>
                  {d.entregas.map((e) => (
                    <tr key={e.cod_cliente}>
                      <td><Link to={`/clientes/${e.cod_cliente}`}>{e.nome ?? e.cod_cliente}</Link></td>
                      <td>{e.ordens}</td>
                      <td>{e.itens}</td>
                      <td>{e.com_corte && <span className="selo erro" title="O SAP confirmou menos do que o cliente pediu em algum item">Item com corte</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h2>Roteiro</h2>
          <div className="chips">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => <button key={n} className={`chip${d.dia_semana === n ? ' ativo' : ''}`} onClick={() => { setD(null); setDia(n); }}>{NOME_DIA_CURTO[n]}</button>)}
          </div>
          {d.roteiro.length === 0 && <div className="vazio">Nenhum cliente no roteiro de {NOME_DIA[d.dia_semana].toLowerCase()}.</div>}
          {d.roteiro.length > 0 && (
            <table>
              <thead><tr><th style={{ width: 40 }}>#</th><th>Cliente</th><th>Última compra</th><th>Situação</th><th>Visita</th><th /></tr></thead>
              <tbody>
                {d.roteiro.map((c) => (
                  <tr key={c.cod_cliente}>
                    <td>{c.sequencia}</td>
                    <td>
                      <Link to={`/clientes/${c.cod_cliente}`}>{c.nome ?? c.cod_cliente}</Link>
                      <div className="suave">{c.cod_cliente}{c.cidade ? ` · ${c.cidade}${c.uf ? `/${c.uf}` : ''}` : ''}</div>
                    </td>
                    <td>{c.ultima_compra ? <>{dataBR(c.ultima_compra)}<div className="suave">há {c.dias_sem_comprar} dia{c.dias_sem_comprar === 1 ? '' : 's'}</div></> : <span className="suave">nunca comprou</span>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {c.bloqueado && <span className="selo erro">Bloqueado</span>}
                        {c.vencido > 0 && <span className="selo erro">Vencido {moeda0(c.vencido)}</span>}
                        {c.pagamento_antecipado && <span className="selo aviso">Antecipado</span>}
                        {!c.bloqueado && !c.pagamento_antecipado && c.limite_disponivel != null && <span className="selo" title="Limite de crédito disponível">Limite {moeda(c.limite_disponivel)}</span>}
                      </div>
                    </td>
                    <td><SeloVisita c={c} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {d.eh_hoje && !c.visita_status && <button className="btn" disabled={ocupado === c.cod_cliente} onClick={() => iniciar(c)}>{ocupado === c.cod_cliente ? 'Aguarde…' : 'Iniciar visita'}</button>}
                        {d.eh_hoje && c.visita_status === 'em_andamento' && <button className="btn ok" onClick={() => setConcluindo(c)}>Concluir visita</button>}
                        {!c.bloqueado && <Link className="btn" to={novoPedido(c)}>Novo pedido</Link>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {concluindo && (
        <ConcluirVisita cliente={concluindo} qs={alvo.qs} aoFechar={() => setConcluindo(null)} aoConcluir={() => { setConcluindo(null); void carregar(); }} />
      )}
    </>
  );
}
