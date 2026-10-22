import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../api';
import type { OpcaoEscopo } from '../opcoes';

/** produto: busca no catalogo; opcoes: lista fechada (escritorio, canal, equipe, linha, lista de preco...). */
export type TipoSeletor = 'produto' | 'opcoes';

const separar = (v: string) => [...new Set(v.split(/[,;]+/).map((x) => x.trim()).filter(Boolean))];

/** Resumo para o campo que abre o painel: codigos separados por virgula viram fichas. */
export function FichasEscolha({ valor, vazio, nomes }: { valor: string; vazio: string; nomes?: Record<string, string> }) {
  const itens = separar(valor);
  if (!itens.length) return <span className="vazio-txt">{vazio}</span>;
  return <>{itens.map((c) => <span key={c} className="ficha" title={nomes?.[c]}>{nomes?.[c] ? `${c} · ${nomes[c]}` : c}</span>)}</>;
}

/** codigo -> descricao, para as fichas mostrarem o nome e nao so o codigo. */
export const nomesDe = (opcoes: OpcaoEscopo[] | undefined): Record<string, string> =>
  Object.fromEntries((opcoes ?? []).filter((o) => o.descricao && o.descricao !== o.codigo).map((o) => [o.codigo, o.descricao]));

/**
 * Painel de escolha multipla (abre ao clicar no campo): nada e digitado, so marcado.
 * O valor sai como codigos separados por virgula.
 */
export function SeletorMultiplo({ titulo, tipo, valor, opcoes, aoConfirmar, aoFechar }: {
  titulo: string; tipo: TipoSeletor; valor: string; opcoes?: OpcaoEscopo[] | null; aoConfirmar: (csv: string) => void; aoFechar: () => void;
}) {
  const [marcados, setMarcados] = useState<string[]>(() => separar(valor));
  const [nomes, setNomes] = useState<Record<string, string>>(() => nomesDe(opcoes ?? undefined));
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<OpcaoEscopo[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (tipo !== 'produto') return;
    if (busca.trim().length < 2) { setAchados([]); return; }
    let vivo = true;
    setCarregando(true);
    const t = setTimeout(() => {
      api<Array<{ cod_produto: string; descricao: string }>>(`/painel/produtos?q=${encodeURIComponent(busca)}`)
        .then((r) => {
          if (!vivo) return;
          setAchados(r.map((p) => ({ codigo: p.cod_produto, descricao: p.descricao })));
          setNomes((n) => ({ ...n, ...Object.fromEntries(r.map((p) => [p.cod_produto, p.descricao])) }));
        })
        .catch(() => vivo && setAchados([]))
        .finally(() => vivo && setCarregando(false));
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [busca, tipo]);

  const lista = useMemo(() => {
    if (tipo === 'produto') return achados;
    const q = busca.trim().toLowerCase();
    return (opcoes ?? []).filter((o) => !q || o.codigo.toLowerCase().includes(q) || o.descricao.toLowerCase().includes(q));
  }, [tipo, achados, opcoes, busca]);

  const alternar = (c: string) => setMarcados((m) => (m.includes(c) ? m.filter((x) => x !== c) : [...m, c]));

  return (
    <div className="modal-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-cab">
          <strong>{titulo}</strong>
          <button type="button" className="btn" onClick={aoFechar} aria-label="Fechar"><X size={14} /></button>
        </div>

        <div className="modal-busca">
          <Search size={15} />
          <input
            type="text" autoFocus value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder={tipo === 'produto' ? 'Buscar por código ou nome (mín. 2 letras)' : 'Filtrar'}
          />
        </div>

        {marcados.length > 0 && (
          <div className="modal-marcados">
            {marcados.map((c) => (
              <button type="button" key={c} className="chip ativo" onClick={() => alternar(c)} title="Tirar da escolha">
                {c}{nomes[c] ? ` · ${nomes[c]}` : ''} <X size={11} />
              </button>
            ))}
          </div>
        )}

        <div className="modal-lista">
          {tipo === 'produto' && busca.trim().length < 2 && <p className="suave" style={{ margin: 8 }}>Busque para escolher mais de um produto.</p>}
          {carregando && <p className="suave" style={{ margin: 8 }}>Buscando…</p>}
          {tipo === 'opcoes' && opcoes == null && <p className="suave" style={{ margin: 8 }}>Carregando opções…</p>}
          {tipo === 'opcoes' && opcoes != null && lista.length === 0 && <p className="suave" style={{ margin: 8 }}>Nenhuma opção encontrada.</p>}
          {lista.map((o) => (
            <label key={o.codigo} className="modal-opcao">
              <input type="checkbox" checked={marcados.includes(o.codigo)} onChange={() => alternar(o.codigo)} />
              <span><strong>{o.codigo}</strong>{o.descricao && o.descricao !== o.codigo ? ` · ${o.descricao}` : ''}</span>
            </label>
          ))}
        </div>

        <div className="modal-rodape">
          <span className="suave">{marcados.length} selecionado(s)</span>
          <span>
            <button type="button" className="btn" onClick={() => setMarcados([])}>Limpar</button>{' '}
            <button type="button" className="btn ok" onClick={() => aoConfirmar(marcados.join(','))}>Confirmar</button>
          </span>
        </div>
      </div>
    </div>
  );
}
