import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

interface ClienteLinha {
  cod_cliente: string; nome: string | null; razao_social: string | null; cnpjcpf: string | null; cidade: string | null; uf: string | null;
  bloqueado: boolean; pagamento_antecipado: boolean; rota: string | null; vendedor: string | null; escritorio: string | null; canal: string | null;
  ultima_compra: string | null; valor_12m: number; vencido: number;
}
interface Lista { pagina: number; por_pagina: number; total: number; itens: ClienteLinha[] }
interface Filtros { escritorios: Array<{ codigo: string; descricao: string }>; canais: Array<{ codigo: string; descricao: string }> }
interface Vendedor { cod_vendedor: string; nome: string | null }

const SITUACOES = [
  { v: '', r: 'Ativos' },
  { v: 'bloqueados', r: 'Bloqueados' },
  { v: 'parados', r: 'Sem compra há 90 dias' },
  { v: 'vencidos', r: 'Com título vencido' },
  { v: 'antecipado', r: 'Pagamento antecipado' },
];

const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const dataBR = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : 'nunca');

/** Carteira de clientes de todos os vendedores: busca, filtros e acesso a pagina de cada cliente. */
export function ClientesScreen() {
  const navegar = useNavigate();
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [filtros, setFiltros] = useState<Filtros>({ escritorios: [], canais: [] });
  const [vendedor, setVendedor] = useState('');
  const [escritorio, setEscritorio] = useState('');
  const [canal, setCanal] = useState('');
  const [situacao, setSituacao] = useState('');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<Lista | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<Vendedor[]>('/painel/pedido-novo/vendedores').then(setVendedores).catch(() => undefined);
    api<Filtros>('/painel/clientes-filtros').then(setFiltros).catch(() => undefined);
  }, []);

  const carregar = useCallback(async () => {
    setErro(null);
    setDados(null);
    try {
      const q = new URLSearchParams({ pagina: String(pagina) });
      if (vendedor) q.set('vendedor', vendedor);
      if (escritorio) q.set('escritorio', escritorio);
      if (canal) q.set('canal', canal);
      if (situacao) q.set('situacao', situacao);
      if (buscaAplicada) q.set('busca', buscaAplicada);
      setDados(await api<Lista>(`/painel/clientes?${q}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [vendedor, escritorio, canal, situacao, buscaAplicada, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const mudar = (fn: () => void) => { fn(); setPagina(1); };
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.por_pagina)) : 1;

  return (
    <>
      <h1>Clientes</h1>
      <p className="sub">Carteira de todos os vendedores já sincronizados, sem os bloqueados (eles ficam no filtro "Bloqueados"). Clique em um cliente para ver cadastro, financeiro, compras e visitas.</p>

      <div className="chips">
        {SITUACOES.map((s) => <button key={s.v} className={`chip${situacao === s.v ? ' ativo' : ''}`} onClick={() => mudar(() => setSituacao(s.v))}>{s.r}</button>)}
      </div>
      <div className="chips">
        <select className="entrada" style={{ minWidth: 200 }} value={vendedor} onChange={(e) => mudar(() => setVendedor(e.target.value))}>
          <option value="">Todos os vendedores</option>
          {vendedores.map((v) => <option key={v.cod_vendedor} value={v.cod_vendedor}>{v.nome ?? v.cod_vendedor}</option>)}
        </select>
        <select className="entrada" style={{ minWidth: 190 }} value={escritorio} onChange={(e) => mudar(() => setEscritorio(e.target.value))}>
          <option value="">Todos os escritórios</option>
          {filtros.escritorios.map((e) => <option key={e.codigo} value={e.codigo}>{e.codigo} · {e.descricao}</option>)}
        </select>
        <select className="entrada" style={{ minWidth: 160 }} value={canal} onChange={(e) => mudar(() => setCanal(e.target.value))}>
          <option value="">Todos os canais</option>
          {filtros.canais.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.descricao}</option>)}
        </select>
        <form style={{ display: 'flex', gap: 6 }} onSubmit={(e) => { e.preventDefault(); mudar(() => setBuscaAplicada(busca)); }}>
          <input className="entrada" placeholder="Nome, código ou CNPJ/CPF" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <button className="btn" type="submit">Buscar</button>
        </form>
        <button className="chip" onClick={carregar}>Atualizar</button>
      </div>

      {erro && <p className="erro-msg">{erro}</p>}
      {!dados && !erro && <div className="vazio">Carregando…</div>}
      {dados && dados.itens.length === 0 && !erro && (
        <div className="vazio">
          Nenhum cliente neste filtro.
          {situacao !== 'bloqueados' && <div className="suave" style={{ marginTop: 6 }}>Clientes bloqueados não aparecem aqui: use o filtro "Bloqueados".</div>}
        </div>
      )}

      {dados && dados.itens.length > 0 && (
        <>
          <p className="suave" style={{ margin: '0 0 6px' }}>{dados.total.toLocaleString('pt-BR')} cliente{dados.total === 1 ? '' : 's'} · página {dados.pagina} de {totalPaginas}</p>
          <table>
            <thead><tr><th>Cliente</th><th>Cidade</th><th>Vendedor</th><th>Canal / escritório</th><th>Última compra</th><th style={{ textAlign: 'right' }}>12 meses</th><th>Situação</th></tr></thead>
            <tbody>
              {dados.itens.map((c) => (
                <tr key={c.cod_cliente} className="clicavel" onClick={() => navegar(`/clientes/${c.cod_cliente}`)}>
                  <td>{c.nome ?? c.cod_cliente}<div className="suave">{c.cod_cliente}{c.cnpjcpf ? ` · ${c.cnpjcpf}` : ''}</div></td>
                  <td>{c.cidade ? `${c.cidade}${c.uf ? `/${c.uf}` : ''}` : '—'}</td>
                  <td>{c.vendedor ?? '—'}</td>
                  <td>{c.canal ?? '—'}<div className="suave">{c.escritorio ?? ''}</div></td>
                  <td>{dataBR(c.ultima_compra)}</td>
                  <td style={{ textAlign: 'right' }}>{moeda(c.valor_12m)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {c.bloqueado && <span className="selo erro">Bloqueado</span>}
                      {c.vencido > 0 && <span className="selo erro">Vencido {moeda(c.vencido)}</span>}
                      {c.pagamento_antecipado && <span className="selo aviso">Antecipado</span>}
                      {!c.bloqueado && c.vencido === 0 && !c.pagamento_antecipado && <span className="selo ok">Regular</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button className="btn" disabled={pagina <= 1} onClick={() => setPagina((n) => n - 1)}>← Anterior</button>
            <span className="suave">Página {pagina} de {totalPaginas}</span>
            <button className="btn" disabled={pagina >= totalPaginas} onClick={() => setPagina((n) => n + 1)}>Próxima →</button>
            <Link to="/novo-pedido" className="suave" style={{ marginLeft: 'auto' }}>Novo pedido</Link>
          </div>
        </>
      )}
    </>
  );
}
