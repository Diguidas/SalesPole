import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { dataBR } from './vendedor';

interface Alerta {
  tipo: 'corte' | 'recusa' | 'faturado_menos'; cod_cliente: string; cliente: string | null; telefone: string | null; ordem: string; item: string;
  cod_produto: string | null; produto: string | null; unidade: string | null; pedido: number | null; confirmado: number | null;
  data: string | null; motivo: string | null; cod_motivo: string | null;
}
interface Resposta { dias: number; total: number; clientes: number; por_tipo: { corte: number; recusa: number; faturado_menos: number }; itens: Alerta[] }

const VISTOS = 'salespole.alertas.vistos';
const lerVistos = (): string[] => { try { return JSON.parse(localStorage.getItem(VISTOS) ?? '[]'); } catch { return []; } };
const chaveDe = (a: Alerta) => [a.tipo, a.ordem, a.item, a.data ?? ''].join('|');

const un = (u: string | null) => (u === 'KI' || !u ? 'cx' : u.toLowerCase());
const n = (v: number | null) => (v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('pt-BR'));
const nome = (a: Alerta) => a.produto ?? a.cod_produto ?? `item ${a.item}`;

/** Uma linha de problema, em portugues claro (a mesma frase vai na mensagem ao cliente, com outro tom). */
function descricao(a: Alerta): string {
  if (a.tipo === 'corte') return `${nome(a)}: pediu ${n(a.pedido)} ${un(a.unidade)}, o SAP confirmou ${n(a.confirmado)}${a.data ? ` (entrega ${dataBR(a.data)})` : ''}`;
  if (a.tipo === 'recusa') return `${nome(a)} (${n(a.pedido)} ${un(a.unidade)}): item recusado${a.motivo ? ` — ${a.motivo}` : ''}${a.cod_motivo ? ` (cód. ${a.cod_motivo})` : ''}`;
  return `${nome(a)}: pediu ${n(a.pedido)} ${un(a.unidade)}, faturou ${n(a.confirmado)}`;
}

/** Texto curto e cordial para o vendedor mandar ao cliente (ele avisa e oferece ajuda; nao cobra nem culpa). */
function mensagem(cliente: string | null, linhas: Alerta[]): string {
  const itens = linhas.map((a) => {
    if (a.tipo === 'corte') return `• ${nome(a)}: pedimos ${n(a.pedido)} ${un(a.unidade)} e vamos entregar ${n(a.confirmado)}${a.data ? ` (entrega prevista ${dataBR(a.data)})` : ''}`;
    if (a.tipo === 'recusa') return `• ${nome(a)}: não conseguimos atender${a.motivo ? ` (${a.motivo.toLowerCase()})` : ''}`;
    return `• ${nome(a)}: foram faturadas ${n(a.confirmado)} de ${n(a.pedido)} ${un(a.unidade)}`;
  });
  return `Olá${cliente ? `, ${cliente}` : ''}! Passando para avisar sobre o seu pedido:\n${itens.join('\n')}\nSe quiser, já posso te ajudar com a reposição ou um complemento.`;
}

/** Numero para o WhatsApp: so digitos, com o 55 na frente (o cadastro guarda DDD + numero). */
function whats(tel: string | null): string | null {
  const d = (tel ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}

/**
 * Pedidos com problema nos clientes da carteira: o que o SAP vai entregar a menos, recusou ou faturou a menos.
 * O vendedor avisa o cliente antes de ele ligar reclamando; "Já avisei" tira da lista (so neste navegador).
 */
export function AlertasPedidos({ qs }: { qs: string }) {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [vistos, setVistos] = useState<string[]>(lerVistos);
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    api<Resposta>(`/meu/alertas${qs ? `?${qs}` : ''}`).then(setDados).catch(() => setDados(null)); // alerta e extra: se falhar, a tela segue sem ele
  }, [qs]);

  const grupos = useMemo(() => {
    const por = new Map<string, Alerta[]>();
    for (const a of dados?.itens ?? []) {
      if (vistos.includes(chaveDe(a))) continue;
      por.set(a.cod_cliente, [...(por.get(a.cod_cliente) ?? []), a]);
    }
    return [...por.values()];
  }, [dados, vistos]);

  if (!dados || grupos.length === 0) return null;
  const total = grupos.reduce((s, g) => s + g.length, 0);

  const jaAvisei = (linhas: Alerta[]) => {
    const novos = [...new Set([...vistos, ...linhas.map(chaveDe)])].slice(-500);
    setVistos(novos);
    try { localStorage.setItem(VISTOS, JSON.stringify(novos)); } catch { /* sem armazenamento: o alerta volta ao recarregar */ }
  };
  const copiar = async (cod: string, texto: string) => {
    try { await navigator.clipboard.writeText(texto); setCopiado(cod); setTimeout(() => setCopiado((c) => (c === cod ? null : c)), 2000); } catch { window.prompt('Copie a mensagem:', texto); }
  };

  return (
    <>
      <h2>Pedidos com problema <span className="suave" style={{ fontWeight: 400 }}>· {total} item(ns) em {grupos.length} cliente(s)</span></h2>
      <p className="suave" style={{ marginTop: -6 }}>Corte nas entregas dos próximos dias, itens recusados e faturados a menos (últimos {dados.dias} dias). Avise o cliente antes que ele ligue.</p>
      {grupos.map((linhas) => {
        const c = linhas[0];
        const texto = mensagem(c.cliente, linhas);
        const wa = whats(c.telefone);
        return (
          <div key={c.cod_cliente} className="card" style={{ borderLeft: `4px solid ${linhas.some((l) => l.tipo !== 'corte') ? 'var(--c-erro)' : 'var(--c-aviso-borda)'}` }}>
            <div className="linha" style={{ alignItems: 'center' }}>
              <div>
                <Link to={`/clientes/${c.cod_cliente}`} className="titulo">{c.cliente ?? c.cod_cliente}</Link>
                <span className="suave"> · {c.cod_cliente}{c.telefone ? ` · ${c.telefone}` : ''}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => copiar(c.cod_cliente, texto)}>{copiado === c.cod_cliente ? 'Copiado ✔' : 'Copiar mensagem'}</button>
                {wa && <a className="btn" href={`https://wa.me/${wa}?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                <button className="btn" onClick={() => jaAvisei(linhas)} title="Tira da lista neste navegador">Já avisei</button>
              </div>
            </div>
            <ul className="itens">
              {linhas.map((a) => (
                <li key={chaveDe(a)}>
                  <span className={`selo ${a.tipo === 'corte' ? 'aviso' : 'erro'}`} style={{ marginRight: 6 }}>{a.tipo === 'corte' ? 'Corte' : a.tipo === 'recusa' ? 'Recusado' : 'Faturado a menos'}</span>
                  {descricao(a)} <span className="suave">· pedido {a.ordem}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
