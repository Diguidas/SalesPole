import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth, type Papel } from '../auth';
import { VendedoresPanel } from './VendedoresScreen';
import { SupervisoresSapPanel } from './SupervisoresSapPanel';
import { PermissoesCampos, padraoDoPapel, useCatalogoPermissoes } from './PermissoesCampos';

type Aba = 'painel' | 'vendedores' | 'supervisores';

interface UsuarioPainel { email: string; nome: string | null; papel: Papel; cod_sap?: string | null; permissoes?: string[]; ativo: boolean }
interface UsuarioApp { email: string; cod_vendedor: string; vendedor: string | null; ativo: boolean }
type Linha = UsuarioPainel | UsuarioApp;

const PAPEIS = [
  { v: 'admin', r: 'Administrador (tudo)' },
  { v: 'aprovador', r: 'Aprovador (aprova bonificação e valida visitas)' },
  { v: 'consulta', r: 'Consulta (só vê)' },
  { v: 'supervisor', r: 'Supervisor (só a equipe dele: pedidos, clientes, visitas, bonificações)' },
  { v: 'gerente', r: 'Gerente (só as equipes dos supervisores dele)' },
  { v: 'gerente_geral', r: 'Gerente geral (vê tudo, sem cadastros e sistema)' },
];
const ROTULO_PAPEL: Record<Papel, string> = { admin: 'Administrador', aprovador: 'Aprovador', consulta: 'Consulta', supervisor: 'Supervisor', gerente: 'Gerente', gerente_geral: 'Gerente geral' };
/** Papéis ligados ao SAP: a equipe vem da ZSDT087 pelo código do fornecedor (LIFNR). */
const PAPEIS_SAP: string[] = ['supervisor', 'gerente'];

/** Gestao de acessos: quem entra no painel e quem usa o app (e-mail -> vendedor). So administrador. */
export function UsuariosScreen() {
  const { usuario } = useAuth();
  const [aba, setAba] = useState<Aba>('painel');

  if (usuario?.papel !== 'admin') {
    return (
      <>
        <h1>Usuários</h1>
        <p className="sub">Só administradores gerenciam usuários.</p>
      </>
    );
  }
  return (
    <>
      <h1>Usuários</h1>
      <p className="sub">Quem acessa o painel e quem usa o app de vendas (e entra nos indicadores). O login é por e-mail e senha.</p>
      <div className="chips">
        <button className={`chip${aba === 'painel' ? ' ativo' : ''}`} onClick={() => setAba('painel')}>Painel</button>
        <button className={`chip${aba === 'vendedores' ? ' ativo' : ''}`} onClick={() => setAba('vendedores')}>Vendedores</button>
        <button className={`chip${aba === 'supervisores' ? ' ativo' : ''}`} onClick={() => setAba('supervisores')}>Supervisores e gerentes (SAP)</button>
      </div>
      {aba === 'painel' ? <Lista key="painel" aba="painel" meuEmail={usuario.email} /> : aba === 'supervisores' ? <SupervisoresSapPanel /> : <VendedoresPanel />}
    </>
  );
}

function Lista({ aba, meuEmail }: { aba: Aba; meuEmail: string }) {
  const [lista, setLista] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState<{ novo: boolean; v: Record<string, string | boolean> } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const catalogo = useCatalogoPermissoes();
  // permissoes marcadas no formulario (so no cadastro do painel)
  const [perm, setPerm] = useState<Record<string, boolean>>({});

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setLista(await api<Linha[]>(`/painel/usuarios/${aba}`));
    } catch (e) {
      setErro((e as Error).message);
      setLista([]);
    }
  }, [aba]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function abrir(l?: Linha) {
    setErro(null);
    setAviso(null);
    if (!l) {
      setForm({ novo: true, v: aba === 'painel' ? { email: '', nome: '', papel: 'consulta', cod_sap: '', ativo: true, senha: '' } : { email: '', cod_vendedor: '', ativo: true, senha: '' } });
      setPerm(padraoDoPapel(catalogo, 'consulta'));
    }
    else if (aba === 'painel') {
      const u = l as UsuarioPainel;
      setForm({ novo: false, v: { email: u.email, nome: u.nome ?? '', papel: u.papel, cod_sap: u.cod_sap ?? '', ativo: u.ativo, senha: '' } });
      setPerm(Object.fromEntries((catalogo?.catalogo ?? []).map((p) => [p.chave, (u.permissoes ?? []).includes(p.chave)])));
    } else {
      const u = l as UsuarioApp;
      setForm({ novo: false, v: { email: u.email, cod_vendedor: u.cod_vendedor, ativo: u.ativo, senha: '' } });
    }
  }

  async function enviar(corpo: Record<string, unknown>) {
    return api<{ login: 'criada' | 'atualizada' | null }>(`/painel/usuarios/${aba}`, { method: 'POST', body: corpo });
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await enviar(aba === 'painel' ? { ...form.v, permissoes: perm } : form.v);
      setAviso(r.login === 'criada' ? 'Usuário salvo e login criado.' : r.login === 'atualizada' ? 'Usuário salvo e senha trocada.' : 'Usuário salvo.');
      setForm(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(l: Linha) {
    setErro(null);
    setAviso(null);
    try {
      await enviar({ ...l, ativo: !l.ativo });
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  const set = (k: string, v: string | boolean) => setForm((f) => (f ? { ...f, v: { ...f.v, [k]: v } } : f));

  return (
    <>
      <div className="chips">
        <button className="btn ok" onClick={() => abrir()}>+ Novo usuário</button>
        <button className="chip" onClick={carregar}>Atualizar</button>
      </div>
      {aviso && <p style={{ color: '#166534', fontSize: 13 }}>{aviso}</p>}
      {erro && !form && <p className="erro-msg">{erro}</p>}

      {form && (
        <form className="card" onSubmit={salvar}>
          <div className="titulo" style={{ marginBottom: 12 }}>{form.novo ? 'Novo usuário' : 'Editar usuário'}</div>
          <div className="form-grade">
            <label className="campo">
              <span>E-mail *</span>
              <input type="text" value={String(form.v.email)} disabled={!form.novo} required onChange={(e) => set('email', e.target.value)} placeholder="nome@polealimentos.com.br" />
              {aba === 'vendedores' && form.novo && <small className="suave">Pode ser fictício (ex.: 100409@vendedor.polealimentos.com.br): nenhum e-mail é enviado.</small>}
            </label>
            {aba === 'painel' ? (
              <>
                <label className="campo">
                  <span>Nome</span>
                  <input type="text" value={String(form.v.nome)} maxLength={80} onChange={(e) => set('nome', e.target.value)} />
                </label>
                <label className="campo">
                  <span>Papel *</span>
                  <select value={String(form.v.papel)} onChange={(e) => { set('papel', e.target.value); setPerm(padraoDoPapel(catalogo, e.target.value)); }}>
                    {PAPEIS.map((p) => <option key={p.v} value={p.v}>{p.r}</option>)}
                  </select>
                </label>
                {(PAPEIS_SAP.includes(String(form.v.papel)) || String(form.v.cod_sap ?? '') !== '') && (
                  <label className="campo">
                    <span>Código SAP {PAPEIS_SAP.includes(String(form.v.papel)) ? '*' : '(opcional)'}</span>
                    <input type="text" inputMode="numeric" value={String(form.v.cod_sap ?? '')} required={PAPEIS_SAP.includes(String(form.v.papel))} maxLength={10} onChange={(e) => set('cod_sap', e.target.value)} placeholder="Ex.: 100409 (LIFNR do supervisor/gerente)" />
                    <small className="suave">É por esse código que o sistema acha a equipe: supervisor pelo escritório/equipe, gerente pelos supervisores dele.</small>
                  </label>
                )}
                <PermissoesCampos papel={String(form.v.papel)} valor={perm} aoMudar={setPerm} />
              </>
            ) : (
              <label className="campo">
                <span>Código do vendedor (SAP) *</span>
                <input type="text" inputMode="numeric" value={String(form.v.cod_vendedor)} required maxLength={10} onChange={(e) => set('cod_vendedor', e.target.value)} placeholder="Ex.: 100409" />
              </label>
            )}
            <label className="campo">
              <span>{form.novo ? 'Senha *' : 'Nova senha'}</span>
              <input type="text" autoComplete="off" value={String(form.v.senha)} required={form.novo} minLength={8} onChange={(e) => set('senha', e.target.value)} placeholder={form.novo ? 'Mínimo 8 caracteres' : 'Deixe vazio para manter a atual'} />
              <small className="suave">{form.novo ? 'Cria o login. Se o e-mail já tem login, a senha é trocada.' : 'Preencha só para trocar a senha.'}</small>
            </label>
            <label className="campo campo-check">
              <input type="checkbox" checked={form.v.ativo === true} onChange={(e) => set('ativo', e.target.checked)} />
              Ativo
            </label>
          </div>
          {erro && <p className="erro-msg">{erro}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn ok" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            <button className="btn" type="button" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {lista === null && <div className="vazio">Carregando…</div>}
      {lista?.length === 0 && !erro && <div className="vazio">Nenhum usuário cadastrado.</div>}
      {lista && lista.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>E-mail</th>
              {aba === 'painel' ? <><th>Nome</th><th>Papel</th></> : <><th>Vendedor</th><th>Código</th></>}
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.map((l) => (
              <tr key={l.email} style={{ opacity: l.ativo ? 1 : 0.55 }}>
                <td>{l.email}{l.email === meuEmail ? ' (você)' : ''}</td>
                {aba === 'painel' ? (
                  <><td>{(l as UsuarioPainel).nome ?? '—'}</td><td>{ROTULO_PAPEL[(l as UsuarioPainel).papel]}{(l as UsuarioPainel).cod_sap ? <span className="suave"> · SAP {(l as UsuarioPainel).cod_sap}</span> : null}</td></>
                ) : (
                  <><td>{(l as UsuarioApp).vendedor ?? '—'}</td><td>{(l as UsuarioApp).cod_vendedor}</td></>
                )}
                <td><span className={`selo ${l.ativo ? 'ok' : ''}`}>{l.ativo ? 'Ativo' : 'Inativo'}</span></td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn" onClick={() => abrir(l)}>Editar</button>{' '}
                  {l.email !== meuEmail && <button className="btn" onClick={() => alternar(l)}>{l.ativo ? 'Desativar' : 'Reativar'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
