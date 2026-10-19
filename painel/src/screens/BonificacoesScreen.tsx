import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

interface Bonificacao {
  id: string;
  codigo: string;
  cod_cliente: string;
  cliente: string | null;
  vendedor: string | null;
  cod_vendedor: string;
  tipo_bonificacao: string | null;
  tipo_descricao: string | null;
  centro_custo: string | null;
  centro_descricao: string | null;
  justificativa: string | null;
  motivo_rejeicao: string | null;
  recebido_em: string;
  decidido_por: string | null;
  decidido_em: string | null;
  itens: Array<{ produto: string; descricao: string | null; unidade: string; quantidade: string }>;
}

const FILTROS = [
  { v: 'aguardando_aprovacao', r: 'Aguardando' },
  { v: 'aprovado', r: 'Aprovadas' },
  { v: 'rejeitado', r: 'Rejeitadas' },
];

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Fila de aprovacao de bonificacao: o vendedor ve o resultado no app (aba Analise). */
export function BonificacoesScreen() {
  const { usuario } = useAuth();
  const podeDecidir = usuario?.papel === 'admin' || usuario?.papel === 'aprovador';
  const [status, setStatus] = useState('aguardando_aprovacao');
  const [lista, setLista] = useState<Bonificacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rejeitando, setRejeitando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    setLista(null);
    try {
      setLista(await api<Bonificacao[]>(`/painel/bonificacoes?status=${status}`));
    } catch (e) {
      setErro((e as Error).message);
      setLista([]);
    }
  }, [status]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function decidir(b: Bonificacao, aprovar: boolean) {
    setOcupado(b.id);
    setErro(null);
    try {
      await api(`/painel/bonificacoes/${b.id}/${aprovar ? 'aprovar' : 'rejeitar'}`, { method: 'POST', body: aprovar ? {} : { motivo } });
      setRejeitando(null);
      setMotivo('');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <>
      <h1>Bonificações</h1>
      <p className="sub">Aprove ou rejeite. Aprovada, a bonificação segue ao SAP em até 1 minuto; rejeitada, o vendedor vê o motivo no app.</p>
      <div className="chips">
        {FILTROS.map((f) => (
          <button key={f.v} className={`chip${status === f.v ? ' ativo' : ''}`} onClick={() => setStatus(f.v)}>{f.r}</button>
        ))}
        <button className="chip" onClick={carregar}>Atualizar</button>
      </div>
      {erro && <p className="erro-msg">{erro}</p>}
      {lista === null && <div className="vazio">Carregando…</div>}
      {lista?.length === 0 && !erro && <div className="vazio">Nada por aqui.</div>}
      {lista?.map((b) => (
        <div className="card" key={b.id}>
          <div className="linha">
            <div>
              <div className="titulo">#{b.codigo} · {b.cliente ?? b.cod_cliente}</div>
              <div className="suave">
                Vendedor: {b.vendedor ?? b.cod_vendedor} · {dataHora(b.recebido_em)}
              </div>
              <div className="suave">
                Tipo: {b.tipo_bonificacao ? `${b.tipo_bonificacao} - ${b.tipo_descricao ?? ''}` : '—'} · Centro de custo: {b.centro_custo ? `${b.centro_custo} - ${b.centro_descricao ?? ''}` : '—'}
              </div>
            </div>
            {status !== 'aguardando_aprovacao' && (
              <span className={`selo ${status === 'aprovado' ? 'ok' : 'erro'}`}>
                {status === 'aprovado' ? 'Aprovada' : 'Rejeitada'} por {b.decidido_por ?? '—'}{b.decidido_em ? ` · ${dataHora(b.decidido_em)}` : ''}
              </span>
            )}
          </div>
          {b.justificativa && <p style={{ margin: '10px 0 0' }}><strong>Justificativa:</strong> {b.justificativa}</p>}
          {b.motivo_rejeicao && <p style={{ margin: '6px 0 0' }}><strong>Motivo da rejeição:</strong> {b.motivo_rejeicao}</p>}
          <ul className="itens">
            {b.itens.map((i, n) => (
              <li key={n}>{i.quantidade} {i.unidade} · {i.produto} {i.descricao ? `- ${i.descricao}` : ''}</li>
            ))}
          </ul>
          {status === 'aguardando_aprovacao' && podeDecidir && (
            rejeitando === b.id ? (
              <div>
                <textarea placeholder="Motivo da rejeição (o vendedor vai ver)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn erro" disabled={ocupado === b.id || motivo.trim().length < 3} onClick={() => decidir(b, false)}>Confirmar rejeição</button>
                  <button className="btn" onClick={() => { setRejeitando(null); setMotivo(''); }}>Voltar</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn ok" disabled={ocupado === b.id} onClick={() => decidir(b, true)}>Aprovar</button>
                <button className="btn erro" disabled={ocupado === b.id} onClick={() => { setRejeitando(b.id); setMotivo(''); }}>Rejeitar</button>
              </div>
            )
          )}
        </div>
      ))}
    </>
  );
}
