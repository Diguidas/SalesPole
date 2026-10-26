import { useEffect, useState } from 'react';
import { Minus, Package, Plus, X } from 'lucide-react';
import { api } from '../api';

const FOTOS_URL = ((import.meta.env.VITE_FOTOS_URL as string) || 'https://jebjtpmugcnpxxkdexyg.supabase.co/storage/v1/object/public/lojinha-fotos').replace(/\/$/, '');

/** Foto do produto no bucket publico (<codigo>.jpg); sem foto, um icone no lugar. */
export function Foto({ cod, tamanho }: { cod: string; tamanho: number }) {
  const [falhou, setFalhou] = useState(false);
  return (
    <div className="foto-prod" style={{ width: tamanho, height: tamanho }}>
      {falhou ? <Package size={tamanho * 0.45} color="var(--c-suave2)" /> : <img src={`${FOTOS_URL}/${encodeURIComponent(cod.trim())}.jpg`} alt="" loading="lazy" onError={() => setFalhou(true)} />}
    </div>
  );
}

export interface ProdutoLinha {
  cod_produto: string; descricao: string; unidade: string; unidade_texto: string;
  preco_tabela: number | null; desconto_max: number; estoque_cx: number | null; disponivel: boolean; origem: string | null;
}
interface Faixa { qtd_minima: number; desconto_pct: number; extra_max_pct: number; escopo: string; alvo: string }
interface ComboProd {
  id: string; nome: string; beneficio: string; desconto_pct: number | null; brinde_cod_produto: string | null; brinde_qtd: number | null;
  condicao: Array<{ alvo_tipo: string; alvo_valor: string; qtd_minima: number }>;
}
interface Compra { ordem: string; data: string; quantidade: number; unidade: string | null }
interface Detalhe {
  produto: ProdutoLinha | null;
  ficha: {
    linha: string | null; grupo: string | null; categoria: string | null; marca: string | null; ncm: string | null; ean: string | null; validade: string | null;
    peso_liquido: string | null; peso_bruto: string | null; prazo_dias: string | null; unidade_base_texto: string | null; fator_venda: number | null;
  };
  faixas: Faixa[];
  combos: ComboProd[];
  historico: { pedidos: number; quantidade_total: number; ultima_compra: string | null; intervalo_dias: number | null; ultimas: Compra[] };
}

const moeda = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const num = (v: number) => (Math.round(v * 100) / 100).toLocaleString('pt-BR');
const dataBR = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const ESCOPO: Record<string, string> = { geral: 'todos os clientes', cliente: 'este cliente', vendedor: 'seus clientes', canal: 'o canal do cliente', escritorio: 'o escritório do cliente' };
const ALVO_COMBO: Record<string, string> = { produto: 'produto', marca: 'marca', linha: 'linha', grupo: 'grupo', categoria: 'categoria' };

/** Linha "rotulo ........ valor"; some quando nao ha valor. */
function Info({ r, v }: { r: string; v: React.ReactNode }) {
  if (v == null || v === '') return null;
  return <div className="resumo-linha"><span className="suave">{r}</span><strong style={{ textAlign: 'right' }}>{v}</strong></div>;
}

/**
 * Pop-up do produto: o que o vendedor precisa saber antes de pedir (preco, desconto maximo, faixas do incentivo, combos,
 * o que o cliente ja comprou e a ficha tecnica), com a quantidade e o botao de adicionar. Mesmo conteudo da tela do app.
 */
export function ProdutoPopup({ vendedor, cliente, cod, noPedido, aoAdicionar, aoFechar }: {
  vendedor: string; cliente: string; cod: string; noPedido: number;
  aoAdicionar: (p: ProdutoLinha, qtd: number) => void; aoFechar: () => void;
}) {
  const [d, setD] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [qtd, setQtd] = useState('1');

  useEffect(() => {
    setD(null);
    setErro(null);
    api<Detalhe>(`/painel/pedido-novo/produto?vendedor=${encodeURIComponent(vendedor)}&cliente=${encodeURIComponent(cliente)}&produto=${encodeURIComponent(cod)}`)
      .then(setD)
      .catch((e) => setErro((e as Error).message));
  }, [vendedor, cliente, cod]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [aoFechar]);

  const p = d?.produto ?? null;
  const q = Number(String(qtd).replace(',', '.')) || 0;
  // a faixa que vale: a de maior quantidade minima que a quantidade (a do pedido, ou a digitada aqui) alcanca
  const qtdFaixa = noPedido > 0 ? noPedido + q : q;
  const ativa = d ? [...d.faixas].filter((f) => f.qtd_minima <= qtdFaixa).sort((a, b) => b.qtd_minima - a.qtd_minima)[0] ?? null : null;
  const un = p?.unidade_texto ?? 'CX';
  const podeAdicionar = !!p && p.disponivel && p.preco_tabela != null;
  const descontoNaQtd = ativa ? ativa.desconto_pct : 0;
  const precoComAuto = p?.preco_tabela != null ? Math.round(p.preco_tabela * (1 - descontoNaQtd / 100) * 100) / 100 : null;
  const h = d?.historico;
  const proxima = d ? d.faixas.find((f) => f.qtd_minima > qtdFaixa && f.desconto_pct > (ativa?.desconto_pct ?? 0)) ?? null : null;

  return (
    <div className="pop-overlay" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="pop card" role="dialog" aria-label="Informações do produto">
        <button className="pop-fechar" onClick={aoFechar} title="Fechar (Esc)"><X size={18} /></button>
        {erro && <p className="erro-msg">{erro}</p>}
        {!d && !erro && <div className="vazio">Carregando…</div>}

        {d && !p && <p className="erro-msg">Produto não encontrado.</p>}
        {d && p && (
          <>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
              <Foto cod={p.cod_produto} tamanho={96} />
              <div style={{ minWidth: 0 }}>
                <div className="titulo" style={{ fontSize: 17 }}>{p.descricao}</div>
                <div className="suave">Código {p.cod_produto} · vendido em {un}{d.ficha.fator_venda && d.ficha.unidade_base_texto && d.ficha.unidade_base_texto !== un ? ` (1 ${un} = ${num(d.ficha.fator_venda)} ${d.ficha.unidade_base_texto})` : ''}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {!p.disponivel && <span className="selo erro">Indisponível para este cliente</span>}
                  {p.disponivel && p.preco_tabela == null && <span className="selo erro">Sem preço de tabela</span>}
                  {p.estoque_cx != null && p.estoque_cx < 1 && <span className="selo aviso">Sem estoque</span>}
                  {noPedido > 0 && <span className="selo ok">{num(noPedido)} {un} no pedido</span>}
                </div>
              </div>
            </div>

            <h3 className="pop-titulo">Preço e desconto</h3>
            <Info r="Preço de tabela" v={p.preco_tabela != null ? `${moeda(p.preco_tabela)} / ${un}` : 'sem preço de tabela'} />
            <Info r="Desconto máximo da lista" v={p.desconto_max > 0 ? `${num(p.desconto_max)}%` : 'sem desconto'} />
            <Info r="Estoque" v={p.estoque_cx != null ? `${Math.floor(p.estoque_cx).toLocaleString('pt-BR')} ${un}` : 'sem informação'} />
            {ativa && <Info r={`Incentivo com ${num(qtdFaixa)} ${un}`} v={<span style={{ color: 'var(--c-ok-texto)' }}>{num(ativa.desconto_pct)}% automático{precoComAuto != null ? ` → ${moeda(precoComAuto)}` : ''} + até {num(ativa.extra_max_pct)}% extra seu</span>} />}

            {d.faixas.length > 0 && (
              <>
                <h3 className="pop-titulo">Desconto por incentivo</h3>
                <table style={{ marginBottom: 6 }}>
                  <thead><tr><th>A partir de</th><th>Desconto automático</th><th>Extra do vendedor</th><th>Vale para</th></tr></thead>
                  <tbody>
                    {d.faixas.map((f, i) => {
                      const eh = ativa === f;
                      return (
                        <tr key={i} style={eh ? { background: 'var(--c-ok-fundo)' } : undefined}>
                          <td>{f.qtd_minima > 0 ? `${num(f.qtd_minima)} ${un}` : 'sem mínimo'}{eh ? ' ✔' : ''}</td>
                          <td><strong>{num(f.desconto_pct)}%</strong></td>
                          <td>até {num(f.extra_max_pct)}%</td>
                          <td className="suave">{ESCOPO[f.escopo] ?? f.escopo}{f.alvo === 'classificacao' ? ' · por linha/marca' : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {proxima && (
                  <p style={{ margin: '4px 0 8px', color: 'var(--c-aviso)', fontWeight: 600 }}>
                    Faltam {num(proxima.qtd_minima - qtdFaixa)} {un} para {num(proxima.desconto_pct)}% de desconto
                    <button className="link-prod" style={{ display: 'inline', marginLeft: 8, color: 'var(--c-prim-texto)' }} onClick={() => setQtd(String(Math.round((q + Math.ceil(proxima.qtd_minima - qtdFaixa)) * 1000) / 1000))}>+ usar essa quantidade</button>
                  </p>
                )}
                <p className="suave" style={{ marginTop: 0 }}>O desconto do incentivo entra sozinho quando a quantidade do pedido atinge a faixa. O extra é opcional e fica a seu critério.</p>
              </>
            )}

            {d.combos.length > 0 && (
              <>
                <h3 className="pop-titulo">Combos com este produto</h3>
                {d.combos.map((c) => (
                  <div key={c.id} style={{ borderLeft: '4px solid var(--c-aviso-borda)', background: 'var(--c-aviso-fundo)', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                    <div style={{ fontWeight: 700 }}>{c.nome}</div>
                    <div className="suave" style={{ color: 'inherit' }}>
                      Condição: {c.condicao.map((x) => `${num(x.qtd_minima)} cx ${ALVO_COMBO[x.alvo_tipo] ?? ''} ${x.alvo_valor}`.replace('  ', ' ')).join(' + ')}
                      {' · '}{c.desconto_pct != null ? `${num(c.desconto_pct)}% de desconto` : c.brinde_cod_produto ? `brinde: ${c.brinde_qtd ?? 1} cx do produto ${c.brinde_cod_produto}` : ''}
                    </div>
                  </div>
                ))}
              </>
            )}

            <h3 className="pop-titulo">O que este cliente já comprou</h3>
            {h && h.pedidos === 0 ? <p className="suave" style={{ margin: 0 }}>Nenhuma compra deste produto nos últimos 12 meses.</p> : h && (
              <>
                <Info r="Pedidos (12 meses)" v={`${h.pedidos} · ${num(h.quantidade_total)} ${un} no total`} />
                <Info r="Última compra" v={dataBR(h.ultima_compra)} />
                <Info r="Compra a cada" v={h.intervalo_dias ? `~${h.intervalo_dias} dias` : null} />
                <table style={{ marginTop: 8 }}>
                  <thead><tr><th>Data</th><th>Pedido</th><th style={{ textAlign: 'right' }}>Quantidade</th></tr></thead>
                  <tbody>{h.ultimas.map((c) => <tr key={`${c.ordem}-${c.data}`}><td>{dataBR(c.data)}</td><td>{c.ordem}</td><td style={{ textAlign: 'right' }}>{num(c.quantidade)} {c.unidade === 'KI' ? un : c.unidade ?? ''}</td></tr>)}</tbody>
                </table>
              </>
            )}

            {Object.values(d.ficha).some((v) => v != null && typeof v === 'string') && (
              <>
                <h3 className="pop-titulo">Ficha técnica</h3>
                <Info r="Linha" v={d.ficha.linha} />
                <Info r="Grupo" v={d.ficha.grupo} />
                <Info r="Categoria" v={d.ficha.categoria} />
                <Info r="Marca" v={d.ficha.marca} />
                <Info r="NCM" v={d.ficha.ncm} />
                <Info r="EAN" v={d.ficha.ean} />
                <Info r="Validade" v={d.ficha.validade} />
                <Info r="Peso líquido / bruto" v={d.ficha.peso_liquido || d.ficha.peso_bruto ? `${d.ficha.peso_liquido ?? '—'} / ${d.ficha.peso_bruto ?? '—'}` : null} />
                <Info r="Prazo de produção" v={d.ficha.prazo_dias ? `${d.ficha.prazo_dias} dia(s)` : null} />
              </>
            )}

            <div className="pop-rodape">
              <div className="stepper">
                <button onClick={() => setQtd(String(Math.max(1, Math.round((q - 1) * 1000) / 1000)))} title="Diminuir"><Minus size={15} /></button>
                <input value={qtd} inputMode="decimal" onChange={(e) => setQtd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && podeAdicionar && q > 0) { aoAdicionar(p, q); aoFechar(); } }} />
                <button onClick={() => setQtd(String(Math.round((q + 1) * 1000) / 1000))} title="Aumentar"><Plus size={15} /></button>
              </div>
              <span className="suave">{un}</span>
              <button className="btn ok" style={{ marginLeft: 'auto' }} disabled={!podeAdicionar || q <= 0} onClick={() => { aoAdicionar(p, q); aoFechar(); }}>
                {noPedido > 0 ? 'Somar ao pedido' : 'Adicionar ao pedido'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
