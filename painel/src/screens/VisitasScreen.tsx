import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

interface Foto { id: string; tipo: string; tirada_em: string; enviada: boolean; removida: boolean; url: string | null }
interface Visita {
  id: string;
  cod_vendedor: string;
  vendedor: string | null;
  cod_cliente: string;
  cliente: string | null;
  data_visita: string;
  status: 'em_andamento' | 'concluida';
  checkin_em: string;
  checkout_em: string | null;
  checkin_lat: number | null;
  checkin_lng: number | null;
  checkin_precisao_m: number | null;
  distancia_m: number | null;
  fora_do_raio: boolean;
  sem_referencia: boolean;
  checkin_gps_falso: boolean;
  relogio_divergente: boolean;
  resultado: 'vendeu' | 'nao_vendeu' | null;
  motivo_nao_venda: string | null;
  observacao: string | null;
  validacao: 'pendente' | 'validada' | 'recusada';
  validada_por: string | null;
  validada_em: string | null;
  validacao_obs: string | null;
  fotos: Foto[];
}

const FILTROS = [
  { v: 'pendente', r: 'Pendentes' },
  { v: 'validada', r: 'Validadas' },
  { v: 'recusada', r: 'Recusadas' },
  { v: 'todas', r: 'Todas' },
];
const PERIODOS = [{ d: 7, r: '7 dias' }, { d: 15, r: '15 dias' }, { d: 30, r: '30 dias' }, { d: 90, r: '90 dias' }];

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');
const dataBR = (d: string) => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const isoDiasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('sv-SE');

/** Fila de validacao: a foto de fachada e o check-in provam que o vendedor esteve no cliente. */
export function VisitasScreen() {
  const { usuario } = useAuth();
  const podeDecidir = usuario?.papel === 'admin' || usuario?.papel === 'aprovador';
  const [validacao, setValidacao] = useState('pendente');
  const [dias, setDias] = useState(7);
  const [lista, setLista] = useState<Visita[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recusando, setRecusando] = useState<string | null>(null);
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    setLista(null);
    try {
      setLista(await api<Visita[]>(`/painel/visitas?validacao=${validacao}&ini=${isoDiasAtras(dias)}`));
    } catch (e) {
      setErro((e as Error).message);
      setLista([]);
    }
  }, [validacao, dias]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function decidir(v: Visita, validada: boolean) {
    setOcupado(v.id);
    setErro(null);
    try {
      await api(`/painel/visitas/${v.id}/validar`, { method: 'POST', body: { validada, obs } });
      setRecusando(null);
      setObs('');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <>
      <h1>Validação de visitas</h1>
      <p className="sub">Confira a foto da fachada e os alertas do check-in. As fotos são apagadas depois de alguns dias; a validação fica registrada.</p>
      <div className="chips">
        {FILTROS.map((f) => <button key={f.v} className={`chip${validacao === f.v ? ' ativo' : ''}`} onClick={() => setValidacao(f.v)}>{f.r}</button>)}
        <span style={{ width: 8 }} />
        {PERIODOS.map((p) => <button key={p.d} className={`chip${dias === p.d ? ' ativo' : ''}`} onClick={() => setDias(p.d)}>{p.r}</button>)}
        <button className="chip" onClick={carregar}>Atualizar</button>
      </div>
      {erro && <p className="erro-msg">{erro}</p>}
      {lista === null && <div className="vazio">Carregando…</div>}
      {lista?.length === 0 && !erro && <div className="vazio">Nenhuma visita neste filtro.</div>}

      {lista?.map((v) => {
        const alertas: string[] = [];
        if (v.fora_do_raio) alertas.push(`Fora do raio (${v.distancia_m} m do cliente)`);
        if (v.checkin_gps_falso) alertas.push('GPS simulado');
        if (v.sem_referencia) alertas.push('Cliente sem coordenada no cadastro');
        if (v.relogio_divergente) alertas.push('Relógio do aparelho diferente do servidor');
        const concluida = v.status === 'concluida';
        return (
          <div className="card" key={v.id}>
            <div className="linha">
              <div>
                <div className="titulo">{v.cliente ?? v.cod_cliente}</div>
                <div className="suave">
                  {v.vendedor ?? v.cod_vendedor} · {dataBR(v.data_visita)} · check-in {hora(v.checkin_em)}{v.checkout_em ? ` · saída ${hora(v.checkout_em)}` : ''}
                  {v.distancia_m != null && !v.fora_do_raio ? ` · a ${v.distancia_m} m do cliente` : ''}
                </div>
                <div className="suave">
                  {!concluida ? 'Visita em andamento' : v.resultado === 'vendeu' ? 'Vendeu' : `Não vendeu: ${v.motivo_nao_venda ?? '—'}`}
                  {v.observacao ? ` · ${v.observacao}` : ''}
                </div>
              </div>
              <span className={`selo ${v.validacao === 'validada' ? 'ok' : v.validacao === 'recusada' ? 'erro' : 'aviso'}`}>
                {v.validacao === 'pendente' ? 'Pendente' : `${v.validacao === 'validada' ? 'Validada' : 'Recusada'} por ${v.validada_por ?? '—'}${v.validada_em ? ` · ${dataHora(v.validada_em)}` : ''}`}
              </span>
            </div>

            {alertas.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {alertas.map((a) => <span key={a} className="selo aviso">{a}</span>)}
              </div>
            )}
            {v.validacao_obs && <p style={{ margin: '8px 0 0' }}><strong>Observação:</strong> {v.validacao_obs}</p>}

            <div className="fotos">
              {v.fotos.length === 0 && <span className="suave">Sem foto enviada.</span>}
              {v.fotos.map((f) =>
                f.url ? (
                  <button key={f.id} className="foto" onClick={() => setAmpliada(f.url)} title="Ampliar">
                    <img src={f.url} alt={`Foto de ${f.tipo}`} loading="lazy" />
                    <small>{f.tipo} · {hora(f.tirada_em)}</small>
                  </button>
                ) : (
                  <div key={f.id} className="foto vazia"><small>{f.removida ? 'Foto apagada (prazo de retenção)' : 'Foto ainda não enviada pelo celular'}</small></div>
                ),
              )}
            </div>

            {v.validacao === 'pendente' && concluida && podeDecidir && (
              recusando === v.id ? (
                <div>
                  <textarea placeholder="Motivo da recusa" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={200} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn erro" disabled={ocupado === v.id || obs.trim().length < 3} onClick={() => decidir(v, false)}>Confirmar recusa</button>
                    <button className="btn" onClick={() => { setRecusando(null); setObs(''); }}>Voltar</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn ok" disabled={ocupado === v.id} onClick={() => decidir(v, true)}>Validar</button>
                  <button className="btn erro" disabled={ocupado === v.id} onClick={() => { setRecusando(v.id); setObs(''); }}>Recusar</button>
                </div>
              )
            )}
            {v.validacao === 'pendente' && !concluida && <p className="suave" style={{ marginTop: 10, marginBottom: 0 }}>Só dá para validar depois que o vendedor concluir a visita.</p>}
          </div>
        );
      })}

      {ampliada && (
        <div className="lightbox" onClick={() => setAmpliada(null)}>
          <img src={ampliada} alt="Foto ampliada" />
        </div>
      )}
    </>
  );
}
