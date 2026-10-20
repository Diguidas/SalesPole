import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useGavetas } from '../gavetas';
import { FotoProduto, ProdutoDetalhe, TIPO_MATERIAL } from './ProdutoDetalhe';

interface Item { cod_produto: string; descricao: string | null; tipo_material: string | null; unidade: string | null; ean: string | null; imagem_url: string | null; ativo: boolean; listas: number }
interface Lista { pagina: number; por_pagina: number; total: number; itens: Item[] }

const SITUACOES = [{ v: '', r: 'Todos' }, { v: 'ativos', r: 'Ativos' }, { v: 'inativos', r: 'Sem preço vigente' }];

/** Catalogo de produtos: ativo = tem preco vigente em pelo menos uma lista. Clique abre os dados e as listas. */
export function ProdutosScreen() {
  const gavetas = useGavetas();
  const [situacao, setSituacao] = useState('ativos');
  const [tipo, setTipo] = useState('');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<Lista | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    setDados(null);
    try {
      const q = new URLSearchParams({ pagina: String(pagina) });
      if (situacao) q.set('situacao', situacao);
      if (tipo) q.set('tipo', tipo);
      if (buscaAplicada) q.set('busca', buscaAplicada);
      setDados(await api<Lista>(`/painel/catalogo-produtos?${q}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [situacao, tipo, buscaAplicada, pagina]);

  useEffect(() => { void carregar(); }, [carregar]);

  const mudar = (fn: () => void) => { fn(); setPagina(1); };
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.por_pagina)) : 1;
  const abrir = (p: Item) => gavetas.abrir({ id: `produto-${p.cod_produto}`, titulo: p.descricao ?? p.cod_produto, conteudo: <ProdutoDetalhe cod={p.cod_produto} /> });

  return (
    <>
      <h1>Produtos</h1>
      <p className="sub">Produto ativo é o que tem preço vigente hoje em pelo menos uma lista de preço. Clique em um produto para ver os dados e em quais listas ele está.</p>

      <div className="chips">
        {SITUACOES.map((s) => <button key={s.v} className={`chip${situacao === s.v ? ' ativo' : ''}`} onClick={() => mudar(() => setSituacao(s.v))}>{s.r}</button>)}
      </div>
      <div className="chips">
        <select className="entrada" style={{ minWidth: 170 }} value={tipo} onChange={(e) => mudar(() => setTipo(e.target.value))}>
          <option value="">Todos os tipos</option>
          {Object.entries(TIPO_MATERIAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <form style={{ display: 'flex', gap: 6 }} onSubmit={(e) => { e.preventDefault(); mudar(() => setBuscaAplicada(busca)); }}>
          <input className="entrada" placeholder="Nome, código ou EAN" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <button className="btn" type="submit">Buscar</button>
        </form>
      </div>

      {erro && <p className="erro-msg">{erro}</p>}
      {!dados && !erro && <div className="vazio">Carregando…</div>}
      {dados && dados.itens.length === 0 && <div className="vazio">Nenhum produto neste filtro.</div>}
      {dados && dados.itens.length > 0 && (
        <>
          <p className="suave" style={{ margin: '0 0 8px' }}>{dados.total.toLocaleString('pt-BR')} produto{dados.total === 1 ? '' : 's'} · página {dados.pagina} de {totalPaginas}</p>
          <div className="grade-produtos">
            {dados.itens.map((p) => (
              <button key={p.cod_produto} className="cartao-produto" onClick={() => abrir(p)}>
                <FotoProduto cod={p.cod_produto} url={p.imagem_url} nome={p.descricao} />
                <div className="cartao-produto-nome" title={p.descricao ?? ''}>{p.descricao ?? p.cod_produto}</div>
                <div className="suave">{p.cod_produto}{p.tipo_material ? ` · ${TIPO_MATERIAL[p.tipo_material] ?? p.tipo_material}` : ''}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                  <span className={`selo ${p.ativo ? 'ok' : ''}`}>{p.ativo ? 'Ativo' : 'Sem preço'}</span>
                  {p.ativo && <span className="suave">{p.listas} lista{p.listas === 1 ? '' : 's'}</span>}
                </div>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
            <button className="btn" disabled={pagina <= 1} onClick={() => setPagina((n) => n - 1)}>← Anterior</button>
            <span className="suave">Página {pagina} de {totalPaginas}</span>
            <button className="btn" disabled={pagina >= totalPaginas} onClick={() => setPagina((n) => n + 1)}>Próxima →</button>
          </div>
        </>
      )}
    </>
  );
}
