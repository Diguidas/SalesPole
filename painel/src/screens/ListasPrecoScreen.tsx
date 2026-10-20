import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useGavetas } from '../gavetas';
import { dataBR, FotoProduto, moeda, ProdutoDetalhe, TIPO_MATERIAL } from './ProdutoDetalhe';

interface Resumo { pltyp: string; descricao: string | null; clientes: number; produtos: number; grupos: number }
interface PrecoProduto {
  cod_produto: string; descricao: string | null; tipo_material: string | null; imagem_url: string | null; origem: 'lista' | 'grupo'; grupo_cliente: string | null;
  preco: number | null; por: number | null; unidade_preco: string | null; preco_kg: number | null; desconto_max: number; de: string; ate: string; vigente: boolean;
}
interface ClienteLinha { cod_cliente: string; nome: string | null; razao_social: string | null; cnpjcpf: string | null; cidade: string | null; uf: string | null; bloqueado: boolean; rede: string | null }
interface PaginaClientes { pagina: number; por_pagina: number; total: number; itens: ClienteLinha[] }
interface Detalhe extends Resumo { produtos_lista: PrecoProduto[]; clientes_lista: PaginaClientes }

function ClientesDaLista({ pltyp, inicial }: { pltyp: string; inicial: PaginaClientes }) {
  const [dados, setDados] = useState<PaginaClientes>(inicial);
  const [busca, setBusca] = useState('');
  const [aplicada, setAplicada] = useState('');
  const [pagina, setPagina] = useState(1);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (pagina === 1 && !aplicada) { setDados(inicial); return; }
    const q = new URLSearchParams({ pagina: String(pagina) });
    if (aplicada) q.set('busca', aplicada);
    api<PaginaClientes>(`/painel/listas-preco/${encodeURIComponent(pltyp)}/clientes?${q}`).then((d) => { setErro(null); setDados(d); }).catch((e) => setErro((e as Error).message));
  }, [pltyp, pagina, aplicada, inicial]);

  const totalPaginas = Math.max(1, Math.ceil(dados.total / dados.por_pagina));
  return (
    <>
      <form style={{ display: 'flex', gap: 6, marginBottom: 10 }} onSubmit={(e) => { e.preventDefault(); setPagina(1); setAplicada(busca); }}>
        <input className="entrada" style={{ minWidth: 0, flex: 1 }} placeholder="Nome, código ou CNPJ/CPF" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button className="btn" type="submit">Buscar</button>
      </form>
      {erro && <p className="erro-msg">{erro}</p>}
      {dados.itens.length === 0 ? <div className="vazio">Nenhum cliente.</div> : (
        <>
          <p className="suave" style={{ margin: '0 0 6px' }}>{dados.total.toLocaleString('pt-BR')} cliente{dados.total === 1 ? '' : 's'} · página {dados.pagina} de {totalPaginas}</p>
          <div className="mini-lista card" style={{ padding: '10px 14px' }}>
            {dados.itens.map((c) => (
              <div key={c.cod_cliente} className="mini-item">
                <div className="mini-esq">
                  <Link to={`/clientes/${c.cod_cliente}`} className="nome" title={c.nome ?? ''}><strong>{c.nome ?? c.cod_cliente}</strong></Link>
                  <span className="suave">{c.cod_cliente}{c.cidade ? ` · ${c.cidade}${c.uf ? `/${c.uf}` : ''}` : ''}{c.rede ? ` · ${c.rede}` : ''}</span>
                </div>
                <div className="mini-dir">{c.bloqueado && <span className="selo erro">Bloqueado</span>}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" disabled={pagina <= 1} onClick={() => setPagina((n) => n - 1)}>← Anterior</button>
            <span className="suave">{pagina} / {totalPaginas}</span>
            <button className="btn" disabled={pagina >= totalPaginas} onClick={() => setPagina((n) => n + 1)}>Próxima →</button>
          </div>
        </>
      )}
    </>
  );
}

function ListaDetalhe({ pltyp }: { pltyp: string }) {
  const gavetas = useGavetas();
  const [d, setD] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<'produtos' | 'clientes'>('produtos');
  const [filtro, setFiltro] = useState('');

  useEffect(() => {
    api<Detalhe>(`/painel/listas-preco/${encodeURIComponent(pltyp)}`).then(setD).catch((e) => setErro((e as Error).message));
  }, [pltyp]);

  if (erro) return <p className="erro-msg">{erro}</p>;
  if (!d) return <div className="vazio">Carregando…</div>;
  const q = filtro.trim().toLowerCase();
  const produtos = d.produtos_lista.filter((p) => !q || `${p.cod_produto} ${p.descricao ?? ''}`.toLowerCase().includes(q));

  return (
    <>
      <div className="chips">
        <button className={`chip${aba === 'produtos' ? ' ativo' : ''}`} onClick={() => setAba('produtos')}>Produtos ({d.produtos_lista.length})</button>
        <button className={`chip${aba === 'clientes' ? ' ativo' : ''}`} onClick={() => setAba('clientes')}>Clientes ({d.clientes_lista.total.toLocaleString('pt-BR')})</button>
      </div>
      {aba === 'produtos' ? (
        d.produtos_lista.length === 0 ? (
          <div className="vazio">Esta lista ainda não tem preços sincronizados do SAP.<div className="suave" style={{ marginTop: 6 }}>Os preços chegam quando um vendedor com clientes nesta lista é sincronizado.</div></div>
        ) : (
          <>
          <input className="entrada" style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', marginBottom: 10 }} placeholder="Pesquisar produto (nome ou código)" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          {q && <p className="suave" style={{ margin: '0 0 6px' }}>{produtos.length} de {d.produtos_lista.length} produtos</p>}
          {produtos.length === 0 && <div className="vazio">Nenhum produto encontrado.</div>}
          <div className="rolagem-x" style={produtos.length === 0 ? { display: 'none' } : undefined}>
            <table>
              <thead><tr><th>Produto</th><th style={{ textAlign: 'right' }}>Preço</th><th style={{ textAlign: 'right' }}>Por kg</th><th style={{ textAlign: 'right' }}>Desc. máx.</th><th>Vigência</th></tr></thead>
              <tbody>
                {produtos.map((p, i) => (
                  <tr key={`${p.cod_produto}-${p.grupo_cliente}-${p.de}-${i}`} className="clicavel-leve" onClick={() => gavetas.abrir({ id: `produto-${p.cod_produto}`, titulo: p.descricao ?? p.cod_produto, conteudo: <ProdutoDetalhe cod={p.cod_produto} /> })}>
                    <td>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <FotoProduto cod={p.cod_produto} url={p.imagem_url} nome={p.descricao} tamanho="mini" />
                        <div style={{ minWidth: 0 }}>
                          <div>{p.descricao ?? p.cod_produto}</div>
                          <div className="suave">{p.cod_produto}{p.tipo_material ? ` · ${TIPO_MATERIAL[p.tipo_material] ?? p.tipo_material}` : ''}{p.origem === 'grupo' ? ` · grupo ${p.grupo_cliente}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{moeda(p.preco)}<div className="suave">por {p.por ?? 1} {p.unidade_preco ?? ''}</div></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{p.preco_kg != null ? moeda(p.preco_kg) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{p.desconto_max ? `${p.desconto_max.toLocaleString('pt-BR')}%` : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.vigente ? <span className="selo ok">Vigente</span> : <span className="selo erro">Vencido</span>}<div className="suave">{dataBR(p.de)} a {dataBR(p.ate)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )
      ) : (
        <ClientesDaLista pltyp={pltyp} inicial={d.clientes_lista} />
      )}
    </>
  );
}

/** Listas de preco: as que existem na base de clientes, quantos produtos (preco vigente) e clientes cada uma tem. */
export function ListasPrecoScreen() {
  const gavetas = useGavetas();
  const [listas, setListas] = useState<Resumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarSem, setMostrarSem] = useState(false);

  useEffect(() => {
    api<Resumo[]>('/painel/listas-preco').then(setListas).catch((e) => setErro((e as Error).message));
  }, []);

  const abrir = (l: Resumo) => gavetas.abrir({ id: `lista-${l.pltyp}`, titulo: `Lista ${l.pltyp}${l.descricao ? ` · ${l.descricao}` : ''}`, conteudo: <ListaDetalhe pltyp={l.pltyp} /> });
  const comPreco = (listas ?? []).filter((l) => l.produtos > 0);
  const semPreco = (listas ?? []).filter((l) => l.produtos === 0);

  const Tabela = ({ itens }: { itens: Resumo[] }) => (
    <table>
      <thead><tr><th>Lista</th><th style={{ textAlign: 'right' }}>Produtos com preço</th><th style={{ textAlign: 'right' }}>Clientes</th><th>Situação</th></tr></thead>
      <tbody>
        {itens.map((l) => (
          <tr key={l.pltyp} className="clicavel" onClick={() => abrir(l)}>
            <td><strong>{l.pltyp}</strong> {l.descricao ?? <span className="suave">sem nome</span>}{l.grupos > 0 && <div className="suave">{l.grupos} grupo{l.grupos === 1 ? '' : 's'} de cliente com preço próprio</div>}</td>
            <td style={{ textAlign: 'right' }}>{l.produtos.toLocaleString('pt-BR')}</td>
            <td style={{ textAlign: 'right' }}>{l.clientes.toLocaleString('pt-BR')}</td>
            <td>{l.produtos > 0 ? <span className="selo ok">Com preços</span> : <span className="selo aviso">Sem preços sincronizados</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <h1>Listas de preço</h1>
      <p className="sub">Clique em uma lista para ver os produtos com o preço de cada um e os clientes que usam a lista.</p>
      {erro && <p className="erro-msg">{erro}</p>}
      {!listas && !erro && <div className="vazio">Carregando…</div>}
      {listas && (
        <>
          {comPreco.length > 0 ? <Tabela itens={comPreco} /> : <div className="vazio">Nenhuma lista com preço sincronizado.</div>}
          {semPreco.length > 0 && (
            <>
              <p style={{ margin: '16px 0 8px' }}>
                <button className="chip" onClick={() => setMostrarSem((v) => !v)}>{mostrarSem ? 'Ocultar' : 'Mostrar'} {semPreco.length} lista{semPreco.length === 1 ? '' : 's'} sem preços sincronizados</button>
              </p>
              {mostrarSem && <Tabela itens={semPreco} />}
            </>
          )}
        </>
      )}
    </>
  );
}
