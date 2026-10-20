import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Papel } from '../auth';
import { PermissoesCampos, padraoDoPapel, useCatalogoPermissoes } from './PermissoesCampos';

interface Acesso { email: string; ativo: boolean; papel: string }
interface Supervisor { cod: string; nome: string | null; gerente: string | null; equipes: Array<{ escritorio: string; equipe: string }>; vendedores: number; acesso: Acesso | null }
interface Gerente { cod: string; nome: string | null; supervisores: number; vendedores: number; acesso: Acesso | null }
interface Dados { supervisores: Supervisor[]; gerentes: Gerente[] }
interface Alvo { papel: 'supervisor' | 'gerente'; cod: string; nome: string | null }
const ROTULO: Record<string, string> = { admin: 'Administrador', aprovador: 'Aprovador', consulta: 'Consulta', supervisor: 'Supervisor', gerente: 'Gerente', gerente_geral: 'Gerente geral' };

/** Supervisores e gerentes que vieram do SAP (ZSDT087): o admin escolhe um e cria o acesso dele ao painel. */
export function SupervisoresSapPanel() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const catalogo = useCatalogoPermissoes();
  const [papel, setPapel] = useState<Papel>('supervisor');
  const [perm, setPerm] = useState<Record<string, boolean>>({});
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await api<Dados>('/painel/usuarios/supervisores-sap'));
    } catch (e) {
      setErro((e as Error).message);
      setDados({ supervisores: [], gerentes: [] });
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function importar() {
    setImportando(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await api<{ supervisores: number | null }>('/painel/vendedores/importar', { method: 'POST', body: {} });
      setAviso(r.supervisores == null ? 'Vendedores importados, mas o SAP não devolveu os supervisores (o recurso novo já está ativo no SAP?).' : `${r.supervisores} vínculos de supervisor importados do SAP.`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setImportando(false);
    }
  }

  /** Promove (ou muda) o papel de quem ja tem acesso, sem mexer no resto do cadastro. */
  async function mudarPapel(emailAlvo: string, novo: string) {
    setErro(null);
    setAviso(null);
    try {
      await api('/painel/usuarios/painel/papel', { method: 'POST', body: { email: emailAlvo, papel: novo } });
      setAviso(`${emailAlvo} agora é ${ROTULO[novo] ?? novo}.`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const trocaPapel = (a: Acesso) => (
    <select value={a.papel} onChange={(e) => mudarPapel(a.email, e.target.value)} title="Mudar o papel (ex.: promover a gerente geral ou administrador)">
      {Object.entries(ROTULO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
    </select>
  );

  function abrir(a: Alvo) {
    setAlvo(a);
    setPapel(a.papel);
    setPerm(padraoDoPapel(catalogo, a.papel));
    setEmail('');
    setSenha('');
    setErro(null);
    setAviso(null);
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!alvo) return;
    setSalvando(true);
    setErro(null);
    try {
      await api('/painel/usuarios/painel', { method: 'POST', body: { email, nome: alvo.nome ?? '', papel, cod_sap: alvo.cod, ativo: true, senha, permissoes: perm } });
      setAviso(`Acesso criado para ${email}.`);
      setAlvo(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const acessoTxt = (a: Acesso | null) => (a ? <span className={`selo ${a.ativo ? 'ok' : ''}`} title={a.email}>{a.ativo ? a.email : `${a.email} (inativo)`} · {ROTULO[a.papel] ?? a.papel}</span> : <span className="suave">sem acesso</span>);

  return (
    <>
      <div className="chips">
        <button className="btn ok" onClick={importar} disabled={importando}>{importando ? 'Importando…' : 'Importar do SAP'}</button>
        <button className="chip" onClick={carregar}>Atualizar</button>
      </div>
      <p className="suave" style={{ margin: '0 0 10px' }}>Quem vem da tabela de supervisores do SAP (ZSDT087). Escolha um nome e crie o login dele; a equipe é descoberta pelo código SAP. Quem já tem acesso mostra um seletor de papel (para promover a gerente geral ou administrador). As permissões de cada um ficam na aba “Painel” → Editar.</p>
      {aviso && <p style={{ color: '#166534', fontSize: 13 }}>{aviso}</p>}
      {erro && !alvo && <p className="erro-msg">{erro}</p>}

      {alvo && (
        <form className="card" onSubmit={criar} style={{ marginBottom: 14 }}>
          <strong>Criar acesso: {alvo.papel === 'supervisor' ? 'supervisor' : 'gerente'} {alvo.nome ?? alvo.cod} (SAP {alvo.cod})</strong>
          <div className="form-grade" style={{ marginTop: 10 }}>
            <label className="campo">
              <span>Papel no painel *</span>
              <select value={papel} onChange={(e) => { setPapel(e.target.value as Papel); setPerm(padraoDoPapel(catalogo, e.target.value)); }}>
                <option value={alvo.papel}>{ROTULO[alvo.papel]} (vê só a equipe dele)</option>
                <option value="gerente_geral">Gerente geral (vê tudo)</option>
                <option value="admin">Administrador (tudo)</option>
              </select>
            </label>
            <label className="campo">
              <span>E-mail *</span>
              <input type="text" value={email} required onChange={(e) => setEmail(e.target.value)} placeholder="nome@polealimentos.com.br" />
            </label>
            <label className="campo">
              <span>Senha *</span>
              <input type="text" autoComplete="off" value={senha} required minLength={8} onChange={(e) => setSenha(e.target.value)} placeholder="Mínimo 8 caracteres" />
            </label>
            <PermissoesCampos papel={papel} valor={perm} aoMudar={setPerm} />
          </div>
          {erro && <p className="erro-msg">{erro}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn ok" type="submit" disabled={salvando}>{salvando ? 'Criando…' : 'Criar acesso'}</button>
            <button className="btn" type="button" onClick={() => setAlvo(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {dados === null && <div className="vazio">Carregando…</div>}
      {dados && dados.supervisores.length === 0 && dados.gerentes.length === 0 && !erro && (
        <div className="vazio">Nenhum supervisor veio do SAP ainda. Clique em “Importar do SAP” (precisa do recurso de supervisores ativo no SAP e da migration aplicada).</div>
      )}

      {dados && dados.gerentes.length > 0 && (
        <>
          <h3 style={{ margin: '16px 0 6px' }}>Gerentes</h3>
          <table>
            <thead><tr><th>Gerente</th><th>Código SAP</th><th>Supervisores</th><th>Vendedores</th><th>Acesso ao painel</th><th /></tr></thead>
            <tbody>
              {dados.gerentes.map((g) => (
                <tr key={g.cod}>
                  <td>{g.nome ?? '—'}</td><td>{g.cod}</td><td>{g.supervisores}</td><td>{g.vendedores}</td><td>{acessoTxt(g.acesso)}</td>
                  <td style={{ textAlign: 'right' }}>{g.acesso ? trocaPapel(g.acesso) : <button className="btn" onClick={() => abrir({ papel: 'gerente', cod: g.cod, nome: g.nome })}>Criar acesso</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {dados && dados.supervisores.length > 0 && (
        <>
          <h3 style={{ margin: '16px 0 6px' }}>Supervisores</h3>
          <table>
            <thead><tr><th>Supervisor</th><th>Código SAP</th><th>Gerente</th><th>Equipes</th><th>Vendedores</th><th>Acesso ao painel</th><th /></tr></thead>
            <tbody>
              {dados.supervisores.map((s) => (
                <tr key={s.cod}>
                  <td>{s.nome ?? '—'}</td><td>{s.cod}</td><td>{s.gerente ?? '—'}</td>
                  <td>{s.equipes.map((e) => `${e.escritorio}/${e.equipe}`).join(', ')}</td><td>{s.vendedores}</td><td>{acessoTxt(s.acesso)}</td>
                  <td style={{ textAlign: 'right' }}>{s.acesso ? trocaPapel(s.acesso) : <button className="btn" onClick={() => abrir({ papel: 'supervisor', cod: s.cod, nome: s.nome })}>Criar acesso</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
