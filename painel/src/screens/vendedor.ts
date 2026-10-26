import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

export const moeda = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }));
export const moeda0 = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
export const dataBR = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
export const NOME_DIA = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
export const NOME_DIA_CURTO = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

interface VendedorOpcao { cod_vendedor: string; nome: string | null; rota: string }

/**
 * De quem e a carteira desta tela. O vendedor so ve a propria (a API usa o codigo SAP do login); admin e supervisao
 * escolhem um vendedor do escopo e veem "como ele ve". `qs` entra no fim das chamadas: ja vem com `vendedor=`.
 */
export function useVendedorAlvo() {
  const { usuario } = useAuth();
  const proprio = usuario?.papel === 'vendedor';
  const [opcoes, setOpcoes] = useState<VendedorOpcao[]>([]);
  const [vendedor, setVendedor] = useState('');

  useEffect(() => {
    if (proprio) return;
    api<VendedorOpcao[]>('/painel/pedido-novo/vendedores').then((l) => { setOpcoes(l); if (l.length === 1) setVendedor(l[0].cod_vendedor); }).catch(() => undefined);
  }, [proprio]);

  const pronto = proprio || !!vendedor;
  return { proprio, opcoes, vendedor, setVendedor, pronto, qs: proprio ? '' : `vendedor=${encodeURIComponent(vendedor)}` };
}

/** Baixa uma lista como CSV que o Excel abre direto (separador ; e acentos corretos). */
export function exportarCsv(nome: string, colunas: string[], linhas: Array<Array<string | number | null | undefined>>) {
  const celula = (v: string | number | null | undefined) => {
    const t = v == null ? '' : String(v);
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const texto = [colunas, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nome}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
