import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ehHierarquia, tem, useAuth } from '../auth';
import { CADASTROS, traco, type Campo, type DefCadastro } from './cadastros';

type Linha = Record<string, unknown> & { ativo?: boolean };
type Valores = Record<string, string | boolean>;

const paraTexto = (v: unknown) => (v == null ? '' : String(v));

function valoresIniciais(def: DefCadastro, linha?: Linha): Valores {
  const v: Valores = {};
  for (const c of def.campos) {
    if (c.tipo === 'bool') v[c.chave] = linha ? linha[c.chave] === true : false;
    else if (c.tipo === 'select') v[c.chave] = paraTexto(linha?.[c.chave]) || c.opcoes?.[0]?.v || '';
    else v[c.chave] = paraTexto(linha?.[c.chave]);
  }
  return v;
}

/** Cadastro generico (lista + formulario) dirigido pela definicao em cadastros.ts. */
export function CadastroScreen() {
  const { nome = '' } = useParams();
  const def = CADASTROS[nome];
  if (!def) return <Navigate to="/" replace />;
  return <Cadastro key={nome} def={def} />;
}

function Cadastro({ def: defBase }: { def: DefCadastro }) {
  const { usuario } = useAuth();
  // admin altera tudo; quem tem a permissao "comunicados" altera so os avisos
  const admin = usuario?.papel === 'admin' || (defBase.nome === 'avisos' && tem(usuario, 'comunicados'));
  // supervisor/gerente so criam aviso para vendedores da propria equipe: o formulario so oferece essa opcao
  const def = useMemo<DefCadastro>(() => {
    if (defBase.nome !== 'avisos' || !ehHierarquia(usuario?.papel) || usuario?.papel === 'gerente_geral') return defBase;
    return { ...defBase, campos: defBase.campos.map((c) => (c.chave === 'escopo' ? { ...c, opcoes: c.opcoes?.filter((o) => o.v === 'vendedor') } : c)) };
  }, [defBase, usuario?.papel]);
  const [lista, setLista] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Linha | 'novo' | null>(null);
  const [valores, setValores] = useState<Valores>({});
  const [salvando, setSalvando] = useState(false);
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setLista(await api<Linha[]>(`/painel/cadastros/${def.nome}`));
    } catch (e) {
      setErro((e as Error).message);
      setLista([]);
    }
  }, [def.nome]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function abrir(l: Linha | 'novo') {
    setEditando(l);
    setValores(valoresIniciais(def, l === 'novo' ? undefined : l));
    setErro(null);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const corpo: Record<string, unknown> = { ...valores };
      if (editando && editando !== 'novo') {
        corpo.ativo = editando.ativo !== false;
        if (def.chave === 'id') corpo.id = editando.id;
      }
      await api(`/painel/cadastros/${def.nome}`, { method: 'POST', body: corpo });
      setEditando(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(l: Linha) {
    setErro(null);
    try {
      await api(`/painel/cadastros/${def.nome}/ativo`, { method: 'POST', body: { chave: String(l[def.chave]), ativo: l.ativo === false } });
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  const visiveis = (lista ?? []).filter((l) => mostrarInativos || l.ativo !== false);
  const inativos = (lista ?? []).filter((l) => l.ativo === false).length;

  return (
    <>
      <h1>{def.titulo}</h1>
      <p className="sub">{def.descricao}</p>
      <div className="chips">
        {admin && <button className="btn ok" onClick={() => abrir('novo')}>+ {def.rotuloNovo}</button>}
        <button className={`chip${mostrarInativos ? ' ativo' : ''}`} onClick={() => setMostrarInativos((v) => !v)}>Mostrar inativos{inativos ? ` (${inativos})` : ''}</button>
        <button className="chip" onClick={carregar}>Atualizar</button>
      </div>
      {!admin && <p className="suave">Seu perfil só permite consultar.</p>}
      {erro && !editando && <p className="erro-msg">{erro}</p>}

      {editando && (
        <form className="card" onSubmit={salvar}>
          <div className="titulo" style={{ marginBottom: 12 }}>{editando === 'novo' ? def.rotuloNovo : 'Editar'}</div>
          <div className="form-grade">
            {def.campos.filter((c) => !c.quando || c.quando(valores)).map((c) => (
              <CampoForm key={c.chave} campo={c} valor={valores[c.chave]} bloqueado={editando !== 'novo' && !!c.fixoAoEditar} aoMudar={(v) => setValores((a) => ({ ...a, [c.chave]: v }))} />
            ))}
          </div>
          {erro && <p className="erro-msg">{erro}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn ok" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            <button className="btn" type="button" onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {lista === null && <div className="vazio">Carregando…</div>}
      {lista && visiveis.length === 0 && !erro && <div className="vazio">Nada cadastrado.</div>}
      {visiveis.length > 0 && (
        <table>
          <thead>
            <tr>
              {def.colunas.map((c) => <th key={c.chave}>{c.rotulo}</th>)}
              <th>Situação</th>
              {admin && <th />}
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={String(l[def.chave])} style={{ opacity: l.ativo === false ? 0.55 : 1 }}>
                {def.colunas.map((c) => <td key={c.chave}>{c.formatar ? c.formatar(l[c.chave], l) : traco(l[c.chave])}</td>)}
                <td><span className={`selo ${l.ativo === false ? '' : 'ok'}`}>{l.ativo === false ? 'Inativo' : 'Ativo'}</span></td>
                {admin && (
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn" onClick={() => abrir(l)}>Editar</button>{' '}
                    <button className="btn" onClick={() => alternarAtivo(l)}>{l.ativo === false ? 'Reativar' : 'Desativar'}</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function CampoForm({ campo, valor, bloqueado, aoMudar }: { campo: Campo; valor: string | boolean; bloqueado: boolean; aoMudar: (v: string | boolean) => void }) {
  const [sugestoes, setSugestoes] = useState<Array<{ cod_produto: string; descricao: string }>>([]);
  const id = `campo-${campo.chave}`;

  // busca de produto: codigo ou parte do nome
  useEffect(() => {
    if (campo.tipo !== 'produto' || typeof valor !== 'string' || valor.trim().length < 2 || bloqueado) {
      setSugestoes([]);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      api<Array<{ cod_produto: string; descricao: string }>>(`/painel/produtos?q=${encodeURIComponent(valor)}`)
        .then((r) => vivo && setSugestoes(r))
        .catch(() => vivo && setSugestoes([]));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [campo.tipo, valor, bloqueado]);

  if (campo.tipo === 'bool') {
    return (
      <label className="campo campo-check">
        <input type="checkbox" checked={valor === true} onChange={(e) => aoMudar(e.target.checked)} />
        {campo.rotulo}
      </label>
    );
  }
  return (
    <label className="campo" htmlFor={id}>
      <span>{campo.rotulo}{campo.obrigatorio ? ' *' : ''}</span>
      {campo.tipo === 'select' ? (
        <select id={id} value={String(valor)} onChange={(e) => aoMudar(e.target.value)}>
          {campo.opcoes?.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}
        </select>
      ) : campo.tipo === 'area' ? (
        <textarea
          id={id}
          rows={5}
          maxLength={campo.maxLength}
          value={String(valor)}
          disabled={bloqueado}
          required={campo.obrigatorio}
          placeholder={campo.dica}
          onChange={(e) => aoMudar(e.target.value)}
          style={{ font: 'inherit', padding: 9, border: '1px solid #e2e8f0', borderRadius: 8, resize: 'vertical' }}
        />
      ) : (
        <input
          id={id}
          type={campo.tipo === 'data' ? 'date' : 'text'}
          inputMode={campo.tipo === 'numero' ? 'decimal' : undefined}
          list={campo.tipo === 'produto' ? `${id}-lista` : undefined}
          maxLength={campo.maxLength}
          value={String(valor)}
          disabled={bloqueado}
          required={campo.obrigatorio}
          placeholder={campo.dica}
          onChange={(e) => aoMudar(e.target.value)}
        />
      )}
      {campo.tipo === 'produto' && (
        <datalist id={`${id}-lista`}>
          {sugestoes.map((s) => <option key={s.cod_produto} value={s.cod_produto}>{s.descricao}</option>)}
        </datalist>
      )}
      {campo.dica && campo.tipo !== 'produto' && <small className="suave">{campo.dica}</small>}
    </label>
  );
}
