import { useEffect, useState } from 'react';
import { api } from './api';

export interface OpcaoEscopo { codigo: string; descricao: string; extra?: string | null }
export type MapaOpcoes = Record<string, OpcaoEscopo[]>;

/** Escopo (a quem vale) -> de onde vem as opcoes. cliente e vendedor continuam digitados (sao milhares). */
export const FONTE_DO_ESCOPO: Record<string, string> = {
  escritorio: 'escritorio',
  canal: 'canal',
  lista_preco: 'lista_preco',
  equipe: 'equipe',
  tipo_estabelecimento: 'tipo_estabelecimento',
};

let pedido: Promise<MapaOpcoes> | null = null;

/** Opcoes que o SAP ja tem (escritorios, canais, equipes, tipos, linhas, grupos, categorias, marcas, listas de preco). */
export function useOpcoesEscopo(): MapaOpcoes | null {
  const [mapa, setMapa] = useState<MapaOpcoes | null>(null);
  useEffect(() => {
    let vivo = true;
    pedido ??= api<MapaOpcoes>('/painel/opcoes-escopo').catch((e) => { pedido = null; throw e; });
    pedido.then((m) => vivo && setMapa(m)).catch(() => vivo && setMapa({}));
    return () => { vivo = false; };
  }, []);
  return mapa;
}
