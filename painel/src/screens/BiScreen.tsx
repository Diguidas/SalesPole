import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';

interface Painel { id: string; nome: string; url: string; onde: string; ativo: boolean }

/** Abre o Power BI dentro do painel (os links vem de Cadastros → Painéis de BI). */
export function BiScreen() {
  const { usuario } = useAuth();
  const [lista, setLista] = useState<Painel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atual, setAtual] = useState<string | null>(null);

  useEffect(() => {
    api<Painel[]>('/painel/cadastros/bi')
      .then((r) => {
        const visiveis = r.filter((p) => p.ativo && p.onde !== 'app');
        setLista(visiveis);
        setAtual(visiveis[0]?.id ?? null);
      })
      .catch((e) => { setErro((e as Error).message); setLista([]); });
  }, []);

  const painel = lista?.find((p) => p.id === atual) ?? null;

  return (
    <>
      <h1>BI</h1>
      {erro && <p className="erro-msg">{erro}</p>}
      {lista === null && <div className="vazio">Carregando…</div>}
      {lista && lista.length === 0 && !erro && (
        <div className="vazio">
          Nenhum painel de BI cadastrado.
          {usuario?.papel === 'admin' && <div style={{ marginTop: 8 }}><Link to="/cadastros/bi">Cadastrar o link do Power BI</Link></div>}
        </div>
      )}
      {lista && lista.length > 0 && painel && (
        <>
          <div className="chips" style={{ alignItems: 'center' }}>
            {lista.length > 1 && lista.map((p) => <button key={p.id} className={`chip${atual === p.id ? ' ativo' : ''}`} onClick={() => setAtual(p.id)}>{p.nome}</button>)}
            <a className="chip" href={painel.url} target="_blank" rel="noreferrer"><ExternalLink size={13} style={{ verticalAlign: -2 }} /> Abrir em nova aba</a>
          </div>
          <iframe
            key={painel.id}
            title={painel.nome}
            src={painel.url}
            allowFullScreen
            style={{ width: '100%', height: 'calc(100vh - 210px)', minHeight: 480, border: '1px solid var(--c-borda)', borderRadius: 12, background: 'var(--c-card)' }}
          />
          <p className="suave" style={{ margin: '8px 0 0' }}>Se a janela ficar em branco ou pedir login, entre na sua conta da empresa no Power BI ou use "Abrir em nova aba".</p>
        </>
      )}
    </>
  );
}
