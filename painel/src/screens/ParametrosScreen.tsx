import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

interface Resposta {
  parametros: Array<{ chave: string; valor: unknown; descricao: string | null; updated_at: string }>;
  status_sap: string[];
}

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Parametros que mudam o comportamento do app/servidor sem precisar publicar nada. */
export function ParametrosScreen() {
  const { usuario } = useAuth();
  const admin = usuario?.papel === 'admin';
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await api<Resposta>('/painel/parametros'));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const atual = dados?.parametros.find((p) => p.chave === 'status_cancelaveis');

  return (
    <>
      <h1>Parâmetros</h1>
      <p className="sub">Ajustes que valem para todos os vendedores. A mudança chega ao app na próxima sincronização.</p>
      {!admin && <p className="suave">Seu perfil só permite consultar.</p>}
      {erro && <p className="erro-msg">{erro}</p>}
      {!dados && !erro && <div className="vazio">Carregando…</div>}
      {dados && (
        <StatusCancelaveis
          key={atual?.updated_at ?? 'novo'}
          inicial={Array.isArray(atual?.valor) ? (atual!.valor as string[]) : []}
          conhecidos={dados.status_sap}
          atualizadoEm={atual?.updated_at}
          podeEditar={admin}
          aoSalvar={carregar}
        />
      )}
    </>
  );
}

function StatusCancelaveis({ inicial, conhecidos, atualizadoEm, podeEditar, aoSalvar }: { inicial: string[]; conhecidos: string[]; atualizadoEm?: string; podeEditar: boolean; aoSalvar: () => Promise<void> }) {
  const [marcados, setMarcados] = useState<string[]>(inicial);
  const [novo, setNovo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const igual = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const opcoes = [...conhecidos, ...marcados.filter((m) => !conhecidos.some((c) => igual(c, m)))];
  const estaMarcado = (s: string) => marcados.some((m) => igual(m, s));
  const mudou = marcados.length !== inicial.length || marcados.some((m) => !inicial.some((i) => igual(i, m)));

  function alternar(s: string) {
    setSalvo(false);
    setMarcados((a) => (estaMarcado(s) ? a.filter((m) => !igual(m, s)) : [...a, s]));
  }

  function adicionar() {
    const t = novo.trim();
    if (!t) return;
    if (!estaMarcado(t)) setMarcados((a) => [...a, t]);
    setNovo('');
    setSalvo(false);
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await api('/painel/parametros/status_cancelaveis', { method: 'POST', body: { valor: marcados } });
      setSalvo(true);
      await aoSalvar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card">
      <div className="linha">
        <div>
          <div className="titulo">Cancelamento de pedido pelo app</div>
          <div className="suave">Em quais status do SAP o vendedor vê o botão "Cancelar pedido". O SAP ainda confere e recusa o que já foi faturado.</div>
        </div>
        <span className={`selo ${inicial.length ? 'ok' : 'aviso'}`}>{inicial.length ? `Ligado em ${inicial.length} status` : 'Desligado'}</span>
      </div>

      <div className="form-grade" style={{ marginTop: 14 }}>
        {opcoes.map((s) => (
          <label key={s} className="campo campo-check" style={{ paddingTop: 0 }}>
            <input type="checkbox" checked={estaMarcado(s)} disabled={!podeEditar} onChange={() => alternar(s)} />
            {s}
          </label>
        ))}
      </div>

      {podeEditar && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <input
            className="entrada"
            placeholder="Outro status (texto exato do SAP)"
            value={novo}
            maxLength={60}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                adicionar();
              }
            }}
          />
          <button className="btn" type="button" onClick={adicionar} disabled={!novo.trim()}>Adicionar</button>
        </div>
      )}

      {marcados.length === 0 && <p className="suave" style={{ marginTop: 12 }}>Nenhum status marcado: o cancelamento fica <strong>desligado</strong>.</p>}
      {erro && <p className="erro-msg">{erro}</p>}
      {podeEditar && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 14 }}>
          <button className="btn ok" onClick={salvar} disabled={salvando || !mudou}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          {salvo && !mudou && <span className="suave">Salvo. O app recebe na próxima sincronização.</span>}
        </div>
      )}
      {atualizadoEm && <p className="suave" style={{ marginTop: 12, marginBottom: 0 }}>Última alteração: {dataHora(atualizadoEm)}</p>}
    </div>
  );
}
