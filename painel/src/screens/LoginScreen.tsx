import { useState, type FormEvent } from 'react';
import { entrar, useAuth } from '../auth';
import logo from '../assets/salespole.png';
import poletech from '../assets/poletech.png';

const campo = { width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #e2e8f0', font: 'inherit', marginBottom: 10 } as const;

/** Entrada por e-mail e senha (usuarios criados no Supabase Auth). Quem entrou mas nao tem acesso ao painel ve o aviso e pode sair. */
export function LoginScreen({ erro }: { erro?: string | null }) {
  const { sessao, sair } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErroLocal(null);
    try {
      await entrar(email, senha);
    } catch (err) {
      setErroLocal((err as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="login">
      <div className="caixa">
        <img className="logo" src={logo} alt="Sales Pole" />
        {sessao ? (
          <>
            {erro && <p className="erro-msg" style={{ marginTop: 24 }}>{erro}</p>}
            <button className="ms" onClick={sair} style={{ marginTop: 16 }}>Sair e trocar de conta</button>
          </>
        ) : (
          <form onSubmit={enviar} style={{ marginTop: 24, textAlign: 'left' }}>
            <input style={campo} type="email" placeholder="E-mail" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input style={campo} type="password" placeholder="Senha" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
            <button className="ms" type="submit" disabled={carregando}>{carregando ? 'Entrando…' : 'Entrar'}</button>
            {(erro || erroLocal) && <p className="erro-msg" style={{ textAlign: 'center' }}>{erroLocal ?? erro}</p>}
          </form>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 28 }}>
          <small style={{ fontSize: 10, color: '#b0b9c6' }}>desenvolvido por</small>
          <img src={poletech} alt="Pole Tech" style={{ height: 16, opacity: 0.85 }} />
        </div>
      </div>
    </div>
  );
}
