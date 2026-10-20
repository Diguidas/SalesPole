import { useEffect, useState } from 'react';
import { api } from '../api';

interface Preco {
  pltyp: string; lista: string | null; origem: 'lista' | 'grupo'; grupo_cliente: string | null;
  preco: number | null; por: number | null; unidade_preco: string | null; moeda: string; preco_kg: number | null;
  desconto_max: number; de: string; ate: string; vigente: boolean;
}
interface Conversao { fator: number; texto: string; unidade: string }
interface Produto {
  cod_produto: string; descricao: string | null; tipo: string | null; unidade: string | null; ean: string | null; ncm: string | null; validade: string | null;
  tipo_material: string | null; imagem_url: string | null; ativo: boolean; precos: Preco[];
  dados: { peso?: { pesobruto?: string; pesoliquido?: string }; pedido?: { multiplo?: string; quantidademinima?: string }; estoque?: { prazoentregadias?: string }; conversoes?: Conversao[]; unidade_base?: string; unidade_venda?: string; unidade_venda_texto?: string; classificacao?: Record<string, string> } | null;
}

/** Fotos: bucket publico, um arquivo por produto (<codigo>.jpg), o mesmo do pedido. */
const FOTOS_URL = ((import.meta.env.VITE_FOTOS_URL as string) || 'https://jebjtpmugcnpxxkdexyg.supabase.co/storage/v1/object/public/lojinha-fotos').replace(/\/$/, '');

export const dataBR = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
export const moeda = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
export const TIPO_MATERIAL: Record<string, string> = { FERT: 'Fabricado', HAWA: 'Revenda', ZVAR: 'Variável' };
const num = (s: string | undefined) => { const n = Number(s); return Number.isFinite(n) && n > 0 ? n.toLocaleString('pt-BR') : '—'; };

export function FotoProduto({ cod, url, nome, tamanho = 'media' }: { cod: string; url?: string | null; nome: string | null; tamanho?: 'media' | 'grande' | 'mini' }) {
  const [falhou, setFalhou] = useState(false);
  const inicial = (nome ?? '?').replace(/^BCX\s+/i, '').trim().charAt(0).toUpperCase();
  return (
    <div className={`foto-prod ${tamanho}`}>
      {!falhou ? <img src={url || `${FOTOS_URL}/${encodeURIComponent(cod.trim())}.jpg`} alt={nome ?? ''} loading="lazy" onError={() => setFalhou(true)} /> : <span className="foto-vazia">{inicial}</span>}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return <div className="resumo-linha"><span className="suave">{rotulo}</span><span style={{ textAlign: 'right' }}>{valor}</span></div>;
}

/** Conteudo da gaveta do produto: cadastro e as listas de preco em que ele esta. */
export function ProdutoDetalhe({ cod }: { cod: string }) {
  const [p, setP] = useState<Produto | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');

  useEffect(() => {
    setP(null);
    setErro(null);
    api<Produto>(`/painel/catalogo-produtos/${encodeURIComponent(cod)}`).then(setP).catch((e) => setErro((e as Error).message));
  }, [cod]);

  if (erro) return <p className="erro-msg">{erro}</p>;
  if (!p) return <div className="vazio">Carregando…</div>;
  const d = p.dados ?? {};
  const q = filtro.trim().toLowerCase();
  const acha = (x: Preco) => !q || `${x.pltyp} ${x.lista ?? ''} ${x.grupo_cliente ?? ''}`.toLowerCase().includes(q);
  const vigentes = p.precos.filter((x) => x.vigente && acha(x));
  const vencidos = p.precos.filter((x) => !x.vigente && acha(x));
  const totalVigentes = p.precos.filter((x) => x.vigente).length;

  const Tabela = ({ lista }: { lista: Preco[] }) => (
    <div className="rolagem-x">
      <table style={{ border: 'none' }}>
        <thead><tr><th>Lista</th><th style={{ textAlign: 'right' }}>Preço</th><th style={{ textAlign: 'right' }}>Por kg</th><th style={{ textAlign: 'right' }}>Desc. máx.</th><th>Vigência</th></tr></thead>
        <tbody>
          {lista.map((x, i) => (
            <tr key={`${x.pltyp}-${x.grupo_cliente}-${x.de}-${i}`}>
              <td>
                <strong>{x.pltyp}</strong> {x.lista ?? ''}
                {x.origem === 'grupo' && <div className="suave">grupo de cliente {x.grupo_cliente}</div>}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{moeda(x.preco)}<div className="suave">por {x.por ?? 1} {x.unidade_preco ?? ''}</div></td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{x.preco_kg != null ? moeda(x.preco_kg) : '—'}</td>
              <td style={{ textAlign: 'right' }}>{x.desconto_max ? `${x.desconto_max.toLocaleString('pt-BR')}%` : '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{dataBR(x.de)} a {dataBR(x.ate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="prod-topo">
        <FotoProduto cod={p.cod_produto} url={p.imagem_url} nome={p.descricao} tamanho="grande" />
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 17, color: '#0f172a' }}>{p.descricao ?? p.cod_produto}</h3>
          <div className="suave">código {p.cod_produto}{p.ean ? ` · EAN ${p.ean}` : ''}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <span className={`selo ${p.ativo ? 'ok' : ''}`}>{p.ativo ? 'Ativo' : 'Sem preço vigente'}</span>
            {p.tipo_material && <span className="selo">{TIPO_MATERIAL[p.tipo_material] ?? p.tipo_material}</span>}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Dados</h3>
        <Linha rotulo="Unidade" valor={d.unidade_venda_texto ? `${d.unidade_venda_texto} (${d.unidade_venda ?? p.unidade ?? ''})` : p.unidade ?? '—'} />
        <Linha rotulo="Unidade base" valor={d.unidade_base ?? '—'} />
        <Linha rotulo="Conversões" valor={d.conversoes?.length ? d.conversoes.map((c) => `1 ${c.texto} = ${c.fator.toLocaleString('pt-BR')} ${d.unidade_base ?? ''}`).join(' · ') : '—'} />
        <Linha rotulo="Peso líquido / bruto" valor={`${num(d.peso?.pesoliquido)} / ${num(d.peso?.pesobruto)} kg`} />
        <Linha rotulo="Múltiplo de pedido" valor={num(d.pedido?.multiplo)} />
        <Linha rotulo="Quantidade mínima" valor={num(d.pedido?.quantidademinima)} />
        <Linha rotulo="Prazo de entrega" valor={d.estoque?.prazoentregadias ? `${d.estoque.prazoentregadias} dias` : '—'} />
        <Linha rotulo="NCM" valor={p.ncm ?? '—'} />
        <Linha rotulo="Validade" valor={p.validade ?? '—'} />
      </div>

      <div className="card">
        <h3>Listas de preço em que está ({q ? `${vigentes.length} de ${totalVigentes}` : totalVigentes})</h3>
        {p.precos.length > 3 && <input className="entrada" style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', marginBottom: 10 }} placeholder="Pesquisar lista de preço (código ou nome)" value={filtro} onChange={(e) => setFiltro(e.target.value)} />}
        {vigentes.length === 0 ? <p className="suave" style={{ margin: 0 }}>{totalVigentes === 0 ? 'Nenhuma lista com preço vigente: o produto está inativo.' : 'Nenhuma lista encontrada.'}</p> : <Tabela lista={vigentes} />}
      </div>

      {vencidos.length > 0 && (
        <div className="card">
          <h3>Preços vencidos ({vencidos.length})</h3>
          <Tabela lista={vencidos} />
        </div>
      )}
    </>
  );
}
