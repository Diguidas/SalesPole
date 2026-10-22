import { useEffect, useState } from 'react';

export type Tema = 'claro' | 'escuro';

const atual = (): Tema => (document.documentElement.dataset.tema === 'escuro' ? 'escuro' : 'claro');

export function aplicarTema(t: Tema) {
  document.documentElement.dataset.tema = t;
  try { localStorage.setItem('tema', t); } catch { /* sem storage: vale so nesta sessao */ }
}

export function useTema(): [Tema, () => void] {
  const [tema, setTema] = useState<Tema>(atual);
  useEffect(() => {
    const o = new MutationObserver(() => setTema(atual()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
    return () => o.disconnect();
  }, []);
  return [tema, () => aplicarTema(tema === 'escuro' ? 'claro' : 'escuro')];
}
