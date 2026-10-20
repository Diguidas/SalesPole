import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';

interface Acesso { email: string; ativo: boolean }
interface Vendedor {
  cod_vendedor: string;
  nome: string | null;
  rota: string | null;
  indicadores: boolean;
  usa_app: boolean;
  acessos: Acesso[];
  pedidos_atualizados_em: string | null;
  erro: string | null;
}

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Vendedores: quem entra nos indicadores (lista vem do SAP) e quem tem acesso ao app (e-mail e senha), na mesma tabela.
 * Quem usa o app ja e sincronizado de qualquer forma; os marcados so para indicadores atualizam 2x por dia.
 */
export function VendedoresPanel() {
  const [lista, setLista] = useState<Vendedor[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'marcados' | 'app' | 'sem'>('todos');
  const [ocupado, setOcupado] = useState(false);
  const [acesso, setAcesso] = useState<{ vendedor: Vendedor; email: string; senha: string; ativo: boolean; novo: boolean } | null>(null);
  const [salvandoAcesso, setSalvandoAcesso] = useState(false);
  const [erroAcesso, setErroAcesso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setLista(await api<Vendedor[]>('/painel/vendedores'));
    } catch (e) {
      setErro((e as Error).message);
      setLista([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function importar() {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await api<{ total: number; novos: number }>('/painel/vendedores/importar', { method: 'POST', body: {} });
      setAviso(`${r.total} vendedores no SAP, ${r.novos} novo${r.novos === 1 ? '' : 's'}. Marque os que entram nos indicadores.`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function marcar(codigos: string[], ativo: boolean) {
    if (!codigos.length) return;
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      await api('/painel/vendedores/indicadores', { method: 'POST', body: { codigos, ativo } });
      setLista((l) => (l ?? []).map((v) => (codigos.includes(v.cod_vendedor) ? { ...v, indicadores: ativo } : v)));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function salvarAcesso(e: FormEvent) {
    e.preventDefault();
    if (!acesso) return;
    setSalvandoAcesso(true);
    setErroAcesso(null);
    try {
      const r = await api<{ login: 'criada' | 'atualizada' | null }>('/painel/usuarios/vendedores', {
        method: 'POST',
        body: { email: acesso.email, cod_vendedor: acesso.vendedor.cod_vendedor, ativo: acesso.ativo, senha: acesso.senha },
      });
      setAviso(r.login === 'criada' ? 'Acesso salvo e login criado.' : r.login === 'atualizada' ? 'Acesso salvo e senha trocada.' : 'Acesso salvo.');
      setAcesso(null);
      await carregar();
    } catch (err) {
      setErroAcesso((err as Error).message);
    } finally {
      setSalvandoAcesso(false);
    }
  }

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (lista ?? []).filter(
      (v) =>
        (filtro === 'todos' || (filtro === 'marcados' ? v.indicadores : filtro === 'app' ? v.usa_app : !v.indicadores && !v.usa_app)) &&
        (!q || v.cod_vendedor.includes(q) || (v.nome ?? '').toLowerCase().includes(q) || (v.rota ?? '').toLowerCase().includes(q) || v.acessos.some((a) => a.email.includes(q))),
    );
  }, [lista, busca, filtro]);

  const marcados = (lista ?? []).filter((v) => v.indicadores).length;
  const doApp = (lista ?? []).filter((v) => v.usa_app).length;
  const FILTROS = [['todos', 'Todos'], ['marcados', 'Nos indicadores'], ['app', 'Com acesso ao app'], ['sem', 'Sem nada']] as const;

  return (
    <>
      <p className="suave" style={{ marginTop: 0 }}>
        {lista ? `${lista.length} vendedores · ${marcados} nos indicadores · ${doApp} com acesso ao app. ` : ''}
        Os marcados para indicadores atualizam 2 vezes por dia (7h e 14h, de segunda a sábado). Quem tem acesso ao app é atualizado a cada 15 minutos. Para sincronizar na hora, use Monitor → Sincronização.
      </p>
      <div className="chips">
        <button className="btn ok" disabled={ocupado} onClick={importar}>{ocupado ? 'Aguarde…' : 'Importar vendedores do SAP'}</button>
        <input className="entrada" placeholder="Buscar por nome, código, rota ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <div className="chips">
        {FILTROS.map(([v, r]) => <button key={v} className={`chip${filtro === v ? ' ativo' : ''}`} onClick={() => setFiltro(v)}>{r}</button>)}
        <button className="chip" onClick={carregar}>Atualizar</button>
      </div>

      {aviso && <p style={{ color: '#166534', fontSize: 13 }}>{aviso}</p>}
      {erro && <p className="erro-msg">{erro}</p>}

      {acesso && (
        <form className="card" onSubmit={salvarAcesso}>
          <div className="titulo" style={{ marginBottom: 4 }}>{acesso.novo ? 'Dar acesso ao app' : 'Editar acesso ao app'}</div>
          <div className="suave" style={{ marginBottom: 12 }}>{acesso.vendedor.nome ?? 'Vendedor'} · código {acesso.vendedor.cod_vendedor}</div>
          <div className="form-grade">
            <label className="campo">
              <span>E-mail de login *</span>
              <input type="text" value={acesso.email} disabled={!acesso.novo} required onChange={(e) => setAcesso({ ...acesso, email: e.target.value })} placeholder="nome@polealimentos.com.br" />
              {acesso.novo && <small className="suave">Pode ser fictício (ex.: {acesso.vendedor.cod_vendedor}@vendedor.polealimentos.com.br): nenhum e-mail é enviado.</small>}
            </label>
            <label className="campo">
              <span>{acesso.novo ? 'Senha *' : 'Nova senha'}</span>
              <input type="text" autoComplete="off" value={acesso.senha} required={acesso.novo} minLength={8} onChange={(e) => setAcesso({ ...acesso, senha: e.target.value })} placeholder={acesso.novo ? 'Mínimo 8 caracteres' : 'Deixe vazio para manter a atual'} />
            </label>
            <label className="campo campo-check">
              <input type="checkbox" checked={acesso.ativo} onChange={(e) => setAcesso({ ...acesso, ativo: e.target.checked })} />
              Acesso ativo
            </label>
          </div>
          {erroAcesso && <p className="erro-msg">{erroAcesso}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn ok" type="submit" disabled={salvandoAcesso}>{salvandoAcesso ? 'Salvando…' : 'Salvar'}</button>
            <button className="btn" type="button" onClick={() => setAcesso(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {lista === null && <div className="vazio">Carregando…</div>}
      {lista?.length === 0 && !erro && <div className="vazio">Nenhum vendedor cadastrado ainda. Use "Importar vendedores do SAP".</div>}

      {visiveis.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <button className="btn" disabled={ocupado} onClick={() => marcar(visiveis.filter((v) => !v.indicadores).map((v) => v.cod_vendedor), true)}>Marcar os {visiveis.length} da lista nos indicadores</button>
            <button className="btn" disabled={ocupado} onClick={() => marcar(visiveis.filter((v) => v.indicadores).map((v) => v.cod_vendedor), false)}>Desmarcar os da lista</button>
          </div>
          <table>
            <thead><tr><th>Vendedor</th><th>Rota</th><th>Acesso ao app</th><th>Indicadores</th><th>Pedidos atualizados</th></tr></thead>
            <tbody>
              {visiveis.map((v) => (
                <tr key={v.cod_vendedor}>
                  <td>{v.nome ?? '—'}<div className="suave">{v.cod_vendedor}</div></td>
                  <td>{v.rota ?? '—'}</td>
                  <td>
                    {v.acessos.map((a) => (
                      <div key={a.email} style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: a.ativo ? 1 : 0.55 }}>
                        <span className={`selo ${a.ativo ? 'ok' : ''}`}>{a.ativo ? 'Ativo' : 'Inativo'}</span>
                        <span>{a.email}</span>
                        <button className="btn" style={{ padding: '2px 8px' }} onClick={() => { setErroAcesso(null); setAcesso({ vendedor: v, email: a.email, senha: '', ativo: a.ativo, novo: false }); }}>Editar</button>
                      </div>
                    ))}
                    <button className="btn" style={{ padding: '2px 8px', marginTop: v.acessos.length ? 4 : 0 }} onClick={() => { setErroAcesso(null); setAcesso({ vendedor: v, email: '', senha: '', ativo: true, novo: true }); }}>
                      {v.acessos.length ? '+ Outro acesso' : 'Dar acesso'}
                    </button>
                  </td>
                  <td>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={v.indicadores} disabled={ocupado} onChange={(e) => marcar([v.cod_vendedor], e.target.checked)} />
                      {v.usa_app && !v.indicadores ? <span className="suave">já entra pelo app</span> : null}
                    </label>
                  </td>
                  <td>
                    {v.erro ? <span className="selo erro" title={v.erro}>Erro</span> : v.pedidos_atualizados_em ? dataHora(v.pedidos_atualizados_em) : v.indicadores || v.usa_app ? <span className="suave">aguardando a 1ª sincronização</span> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
