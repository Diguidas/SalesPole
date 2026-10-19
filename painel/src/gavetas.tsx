import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, X } from 'lucide-react';

export interface ItemGaveta {
  /** identifica a gaveta: abrir de novo a mesma volta para ela em vez de empilhar outra */
  id: string;
  titulo: string;
  conteudo: ReactNode;
  /** chamado quando a gaveta sai da pilha (fechar, voltar ou trocar de tela) */
  aoFechar?: () => void;
}

interface Ctx {
  abrir: (item: ItemGaveta) => void;
  fechar: () => void;
  fecharTodas: () => void;
}

const GavetasCtx = createContext<Ctx>({ abrir: () => {}, fechar: () => {}, fecharTodas: () => {} });
export const useGavetas = () => useContext(GavetasCtx);

/** Distancia entre as bordas das gavetas empilhadas: a de tras aparece como uma faixa a esquerda da da frente. */
const DEGRAU = 48;

/**
 * Gavetas laterais que se empilham: abrir uma gaveta de dentro de outra coloca a nova na frente e deixa a anterior
 * aparecendo na lateral. Clicar na faixa de uma gaveta de tras volta para ela; Esc ou "x" fecha a da frente.
 * A pilha e limpa ao trocar de tela.
 */
export function GavetasProvider({ children }: { children: ReactNode }) {
  const [pilha, setPilha] = useState<ItemGaveta[]>([]);
  const ref = useRef(pilha);
  ref.current = pilha;
  const { pathname } = useLocation();

  // todos os que saem da pilha avisam (aoFechar); `fica` = quantos continuam
  const reduzir = useCallback((fica: number) => {
    const atual = ref.current;
    if (fica >= atual.length) return;
    const saem = atual.slice(fica);
    setPilha(atual.slice(0, fica));
    for (const s of [...saem].reverse()) s.aoFechar?.();
  }, []);

  const abrir = useCallback(
    (item: ItemGaveta) => {
      const atual = ref.current;
      const i = atual.findIndex((x) => x.id === item.id);
      if (i >= 0) {
        reduzir(i + 1); // ja aberta: volta para ela
        return;
      }
      setPilha([...atual, item]);
    },
    [reduzir],
  );
  const fechar = useCallback(() => reduzir(ref.current.length - 1), [reduzir]);
  const fecharTodas = useCallback(() => reduzir(0), [reduzir]);

  useEffect(() => {
    fecharTodas();
  }, [pathname, fecharTodas]);

  useEffect(() => {
    if (pilha.length === 0) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && fechar();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [pilha.length, fechar]);

  const n = pilha.length;
  return (
    <GavetasCtx.Provider value={{ abrir, fechar, fecharTodas }}>
      {children}
      {n > 0 && (
        <div className="gavetas-fundo" onClick={fechar}>
          {pilha.map((g, idx) => {
            const atras = idx < n - 1;
            return (
              <aside
                key={g.id}
                className={`gaveta${atras ? ' atras' : ''}`}
                style={{ right: (n - 1 - idx) * DEGRAU }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (atras) reduzir(idx + 1);
                }}
                aria-label={g.titulo}
              >
                <header className="gaveta-cab">
                  {idx > 0 && (
                    <button className="btn-icone" onClick={(e) => { e.stopPropagation(); fechar(); }} title="Voltar" aria-label="Voltar">
                      <ArrowLeft size={16} />
                    </button>
                  )}
                  <h2>{g.titulo}</h2>
                  <button className="btn-icone" onClick={(e) => { e.stopPropagation(); fecharTodas(); }} title="Fechar tudo" aria-label="Fechar">
                    <X size={16} />
                  </button>
                </header>
                <div className="gaveta-corpo">{g.conteudo}</div>
              </aside>
            );
          })}
        </div>
      )}
    </GavetasCtx.Provider>
  );
}
