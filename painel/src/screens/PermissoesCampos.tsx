import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Papel } from '../auth';

export interface CatalogoPermissoes {
  catalogo: Array<{ chave: string; rotulo: string; descricao: string }>;
  padroes: Record<string, string[]>;
}

let cache: CatalogoPermissoes | null = null;

/** Catalogo de permissoes e o padrao de cada papel (vem da API; guardado depois da primeira vez). */
export function useCatalogoPermissoes(): CatalogoPermissoes | null {
  const [c, setC] = useState<CatalogoPermissoes | null>(cache);
  useEffect(() => {
    if (cache) return;
    api<CatalogoPermissoes>('/painel/usuarios/permissoes')
      .then((r) => {
        cache = r;
        setC(r);
      })
      .catch(() => undefined);
  }, []);
  return c;
}

/** Mapa {permissao: marcada} com o padrao do papel (ao trocar o papel, volta ao padrao dele). */
export function padraoDoPapel(c: CatalogoPermissoes | null, papel: Papel | string): Record<string, boolean> {
  const marcadas = new Set(c?.padroes[papel] ?? []);
  return Object.fromEntries((c?.catalogo ?? []).map((p) => [p.chave, marcadas.has(p.chave)]));
}

/** Caixas de marcar do que a pessoa pode fazer. Administrador tem tudo, sempre. */
export function PermissoesCampos({ papel, valor, aoMudar }: { papel: Papel | string; valor: Record<string, boolean>; aoMudar: (v: Record<string, boolean>) => void }) {
  const c = useCatalogoPermissoes();
  if (!c) return null;
  if (papel === 'admin') return <p className="suave" style={{ margin: 0 }}>Administrador pode tudo (inclusive cadastros, sistema e usuários).</p>;
  return (
    <div className="campo" style={{ gridColumn: '1 / -1' }}>
      <span>O que pode fazer</span>
      <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
        {c.catalogo.map((p) => (
          <label key={p.chave} className="campo-check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={valor[p.chave] === true} onChange={(e) => aoMudar({ ...valor, [p.chave]: e.target.checked })} />
            <span>
              {p.rotulo}
              <small className="suave" style={{ display: 'block' }}>{p.descricao}</small>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
