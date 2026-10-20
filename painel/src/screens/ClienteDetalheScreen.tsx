import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, tem } from '../auth';
import { useGavetas } from '../gavetas';
import { PedidoDetalhe } from './PedidoDetalhe';

interface Area { tipo_material?: string; canal?: { descricao?: string }; escritorio?: { descricao?: string }; lista_preco?: { codigo?: string; descricao?: string }; rede?: { descricao?: string }; cond_pagamento?: { descricao?: string } }
interface Titulo { nfe: string; parcela: string; status: string; valor: number | null; vencimento: string | null; boleto_url: string | null }
interface Pedido { ordem: string; dt_criacao: string; valor: number; status: string | null }
interface Visita { id: string; data_visita: string; cod_vendedor: string; status: string; resultado: string | null; motivo_nao_venda: string | null; validacao: string; fora_do_raio: boolean }
interface Produto { cod_produto: string; denominacao: string | null; quantidade: number; unidade: string | null; pedidos: number; ultima_compra: string | null }
interface Mes { mes: string; valor: number; pedidos: number }
interface Cliente {
  cod_cliente: string; nome_fantasia: string | null; razao_social: string | null; cnpjcpf: string | null; telefone: string | null; bloqueado: boolean;
  pagamento_antecipado: boolean; endereco: { logradouro?: string; bairro?: string; cidade?: string; uf?: string; cep?: string } | null;
  limite_total: number | null; limite_disponivel: number | null; pedido_minimo: number | null; latitude: number | null; longitude: number | null;
  dias_entrega: number[]; classe_risco: { descricao?: string; codigo?: string } | null; areas: Area[]; formas_pagamento: Array<{ descricao?: string; codigo?: string }> | null;
  rota: string | null; vendedores: Array<{ cod_vendedor: string; nome: string | null }>; visitas_na_semana: Array<{ dia_semana: number; sequencia: number }>;
  compras_por_mes: Mes[]; total_12m: number; ultimos_pedidos: Pedido[];
  titulos: { em_aberto: number; vencido: number; lista: Titulo[] };
  visitas: Visita[]; produtos_mais_comprados: Produto[];
}

const DIAS = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const moeda = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBR = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const abrev = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `${Math.round(v / 1e3)} mil` : v > 0 ? String(Math.round(v)) : '');
const tom = (s: string | null) => { const t = (s ?? '').toLowerCase(); return t.startsWith('faturado') ? 'ok' : t === 'recusado' ? 'erro' : t ? 'aviso' : ''; };
const selaVisita = (v: string) => (v === 'validada' ? 'ok' : v === 'recusada' ? 'erro' : 'aviso');
const rotuloVisita = (v: string) => (v === 'validada' ? 'Validada' : v === 'recusada' ? 'Recusada' : 'Pendente');

function Linha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return <div className="resumo-linha"><span className="suave">{rotulo}</span><span style={{ textAlign: 'right' }}>{valor}</span></div>;
}

/** Cartao-resumo com o "Ver mais" que abre o detalhe numa gaveta lateral. */
function Secao({ titulo, children, aoVerMais, rotuloMais = 'Ver mais' }: { titulo: string; children: ReactNode; aoVerMais?: () => void; rotuloMais?: string }) {
  return (
    <div className="card resumo-sec">
      <h3>{titulo}</h3>
      {children}
      {aoVerMais && <div className="rodape-sec"><button className="btn-mais" onClick={aoVerMais}>{rotuloMais} →</button></div>}
    </div>
  );
}

/**
 * Pagina do cliente: so o resumo de cada assunto; o "Ver mais" abre o detalhe numa gaveta lateral, e de dentro
 * dela da para abrir outra (por exemplo, o pedido), que empilha por cima.
 */
export function ClienteDetalheScreen() {
  const { cod = '' } = useParams();
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const gavetas = useGavetas();
  const [c, setC] = useState<Cliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setC(null);
    setErro(null);
    api<Cliente>(`/painel/clientes/${encodeURIComponent(cod)}`).then(setC).catch((e) => setErro((e as Error).message));
  }, [cod]);

  if (erro) return <><p><Link to="/clientes">← Clientes</Link></p><p className="erro-msg">{erro}</p></>;
  if (!c) return <div className="vazio">Carregando…</div>;

  const end = c.endereco;
  const enderecoTxt = [end?.logradouro, end?.bairro, end?.cidade && `${end.cidade}${end.uf ? `/${end.uf}` : ''}`, end?.cep].filter(Boolean).join(' · ');
  const usado = c.limite_total != null && c.limite_disponivel != null ? Math.max(0, c.limite_total - c.limite_disponivel) : null;
  const pctLimite = usado != null && c.limite_total ? Math.min(100, (usado / c.limite_total) * 100) : 0;
  const maxMes = Math.max(...c.compras_por_mes.map((m) => m.valor), 1);
  const podeCriar = tem(usuario, 'criar_pedido');
  const vend = c.vendedores[0];
  const mapa = c.latitude != null && c.longitude != null ? <a href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`} target="_blank" rel="noreferrer">Ver no mapa</a> : 'sem coordenada';

  const abrirPedido = (ordem: string) =>
    gavetas.abrir({ id: `pedido-${ordem}`, titulo: `Pedido ${ordem}`, conteudo: <PedidoDetalhe ordem={ordem} /> });

  const TabelaPedidos = ({ lista }: { lista: Pedido[] }) => (
    <table style={{ border: 'none' }}>
      <thead><tr><th>Ordem</th><th>Data</th><th style={{ textAlign: 'right' }}>Valor</th><th>Status</th></tr></thead>
      <tbody>
        {lista.map((p) => (
          <tr key={p.ordem} className="clicavel-leve" onClick={() => abrirPedido(p.ordem)}>
            <td><strong>{p.ordem}</strong></td>
            <td>{dataBR(p.dt_criacao)}</td>
            <td style={{ textAlign: 'right' }}>{moeda(p.valor)}</td>
            <td><span className={`selo ${tom(p.status)}`}>{p.status ?? '—'}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const TabelaProdutos = ({ lista }: { lista: Produto[] }) => (
    <table style={{ border: 'none' }}>
      <thead><tr><th>Produto</th><th style={{ textAlign: 'right' }}>Quantidade</th><th>Última compra</th></tr></thead>
      <tbody>
        {lista.map((p) => (
          <tr key={p.cod_produto}>
            <td>{p.denominacao ?? p.cod_produto} <span className="suave">· {p.cod_produto}</span></td>
            <td style={{ textAlign: 'right' }}>{p.quantidade.toLocaleString('pt-BR')} {p.unidade ?? ''}</td>
            <td>{dataBR(p.ultima_compra)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const MiniPedidos = ({ lista }: { lista: Pedido[] }) => (
    <div className="mini-lista">
      {lista.map((p) => (
        <div key={p.ordem} className="mini-item clicavel-leve" onClick={() => abrirPedido(p.ordem)}>
          <div className="mini-esq"><strong>{p.ordem}</strong><span className="suave">{dataBR(p.dt_criacao)}</span></div>
          <div className="mini-dir"><span>{moeda(p.valor)}</span><span className={`selo ${tom(p.status)}`} title={p.status ?? ''}>{p.status ?? '—'}</span></div>
        </div>
      ))}
    </div>
  );

  const MiniProdutos = ({ lista }: { lista: Produto[] }) => (
    <div className="mini-lista">
      {lista.map((p) => (
        <div key={p.cod_produto} className="mini-item">
          <div className="mini-esq"><span className="nome" title={p.denominacao ?? ''}>{p.denominacao ?? p.cod_produto}</span><span className="suave">{p.cod_produto} · última {dataBR(p.ultima_compra)}</span></div>
          <div className="mini-dir"><strong>{p.quantidade.toLocaleString('pt-BR')} {p.unidade ?? ''}</strong></div>
        </div>
      ))}
    </div>
  );

  const ListaVisitas = ({ lista }: { lista: Visita[] }) => (
    <>
      {lista.map((v) => (
        <div key={v.id} className="resumo-linha">
          <span>{dataBR(v.data_visita)} · {v.status === 'concluida' ? (v.resultado === 'vendeu' ? 'Vendeu' : `Não vendeu: ${v.motivo_nao_venda ?? '—'}`) : 'Em andamento'}{v.fora_do_raio ? ' · fora do raio' : ''}</span>
          <span className={`selo ${selaVisita(v.validacao)}`}>{rotuloVisita(v.validacao)}</span>
        </div>
      ))}
    </>
  );

  // ---------------- gavetas ("Ver mais") ----------------
  const verCadastro = () => gavetas.abrir({
    id: 'cliente-cadastro', titulo: 'Cadastro',
    conteudo: (
      <div className="card">
        <Linha rotulo="Razão social" valor={c.razao_social ?? '—'} />
        <Linha rotulo="Nome fantasia" valor={c.nome_fantasia ?? '—'} />
        <Linha rotulo="CNPJ/CPF" valor={c.cnpjcpf ?? '—'} />
        <Linha rotulo="Telefone" valor={c.telefone || '—'} />
        <Linha rotulo="Endereço" valor={enderecoTxt || '—'} />
        <Linha rotulo="Localização" valor={mapa} />
        <Linha rotulo="Classe de risco" valor={c.classe_risco?.descricao ?? c.classe_risco?.codigo ?? '—'} />
        <Linha rotulo="Dias de entrega" valor={c.dias_entrega.length ? c.dias_entrega.map((d) => DIAS[d]).join(', ') : '—'} />
        <Linha rotulo="Rota / visita" valor={c.visitas_na_semana.length ? `${c.rota ? `rota ${c.rota} · ` : ''}${c.visitas_na_semana.map((v) => DIAS[v.dia_semana] ?? '—').join(', ')}` : c.rota ?? '—'} />
        <Linha rotulo="Vendedor" valor={c.vendedores.length ? c.vendedores.map((v) => v.nome ?? v.cod_vendedor).join(' / ') : '—'} />
        <Linha rotulo="Pedido mínimo" valor={c.pedido_minimo ? moeda(c.pedido_minimo) : '—'} />
      </div>
    ),
  });

  const verComercial = () => gavetas.abrir({
    id: 'cliente-comercial', titulo: 'Comercial',
    conteudo: (
      <>
        {c.areas.length === 0 && <p className="suave">Sem área de vendas.</p>}
        {c.areas.map((a, i) => (
          <div className="card" key={i}>
            <div className="titulo" style={{ marginBottom: 6 }}>{a.tipo_material === 'FERT' ? 'Produtos fabricados' : a.tipo_material === 'HAWA' ? 'Produtos de revenda' : a.tipo_material ?? 'Área de vendas'}</div>
            <Linha rotulo="Canal" valor={a.canal?.descricao ?? '—'} />
            <Linha rotulo="Escritório de vendas" valor={a.escritorio?.descricao ?? '—'} />
            <Linha rotulo="Lista de preço" valor={a.lista_preco?.descricao ?? a.lista_preco?.codigo ?? '—'} />
            <Linha rotulo="Rede" valor={a.rede?.descricao ?? '—'} />
            <Linha rotulo="Condição de pagamento" valor={a.cond_pagamento?.descricao ?? '—'} />
          </div>
        ))}
        <div className="card"><Linha rotulo="Formas de pagamento" valor={c.formas_pagamento?.length ? c.formas_pagamento.map((f) => f.descricao ?? f.codigo).join(', ') : '—'} /></div>
      </>
    ),
  });

  const verFinanceiro = () => gavetas.abrir({
    id: 'cliente-financeiro', titulo: 'Financeiro',
    conteudo: (
      <>
        <div className="card">
          <Linha rotulo="Limite total" valor={moeda(c.limite_total)} />
          <Linha rotulo="Disponível" valor={moeda(c.limite_disponivel)} />
          <Linha rotulo="Em aberto (a vencer)" valor={moeda(c.titulos.em_aberto)} />
          <Linha rotulo="Vencido" valor={<strong style={{ color: c.titulos.vencido > 0 ? '#dc2626' : undefined }}>{moeda(c.titulos.vencido)}</strong>} />
        </div>
        <div className="titulo" style={{ margin: '12px 0 6px' }}>Títulos em aberto</div>
        {c.titulos.lista.length === 0 ? <p className="suave">Nenhum título em aberto.</p> : (
          <table>
            <thead><tr><th>NF / parcela</th><th>Vencimento</th><th style={{ textAlign: 'right' }}>Valor</th><th>Situação</th></tr></thead>
            <tbody>
              {c.titulos.lista.map((t) => (
                <tr key={`${t.nfe}-${t.parcela}`}>
                  <td>{t.nfe}/{t.parcela}</td>
                  <td>{dataBR(t.vencimento)}</td>
                  <td style={{ textAlign: 'right' }}>{moeda(t.valor)}</td>
                  <td><span className={`selo ${t.status === 'Atrasado' ? 'erro' : ''}`}>{t.status}</span>{t.boleto_url ? <> <a href={t.boleto_url} target="_blank" rel="noreferrer">boleto</a></> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </>
    ),
  });

  const verCompras = () => gavetas.abrir({
    id: 'cliente-compras', titulo: 'Compras por mês',
    conteudo: (
      <table>
        <thead><tr><th>Mês</th><th style={{ textAlign: 'right' }}>Pedidos</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
        <tbody>
          {[...c.compras_por_mes].reverse().map((m) => (
            <tr key={m.mes}><td>{nomeMes(m.mes)}</td><td style={{ textAlign: 'right' }}>{m.pedidos}</td><td style={{ textAlign: 'right' }}>{moeda(m.valor)}</td></tr>
          ))}
          <tr><td style={{ fontWeight: 700 }}>Total (12 meses)</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{c.compras_por_mes.reduce((a, m) => a + m.pedidos, 0)}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{moeda(c.total_12m)}</td></tr>
        </tbody>
      </table>
    ),
  });

  const verPedidos = () => gavetas.abrir({
    id: 'cliente-pedidos', titulo: 'Últimos pedidos',
    conteudo: (
      <>
        <p className="suave" style={{ marginTop: 0 }}>Clique em um pedido para ver os itens, as notas e cancelar.</p>
        <TabelaPedidos lista={c.ultimos_pedidos} />
        <p style={{ marginTop: 12 }}><Link to={`/pedidos?busca=${c.cod_cliente}`}>Ver todos os pedidos deste cliente na lista de Pedidos →</Link></p>
      </>
    ),
  });

  const verProdutos = () => gavetas.abrir({ id: 'cliente-produtos', titulo: 'Produtos que mais compra (12 meses)', conteudo: <TabelaProdutos lista={c.produtos_mais_comprados} /> });
  const verVisitas = () => gavetas.abrir({ id: 'cliente-visitas', titulo: 'Visitas recentes (60 dias)', conteudo: <div className="card"><ListaVisitas lista={c.visitas} /></div> });

  return (
    <>
      <p style={{ margin: '0 0 8px' }}><Link to="/clientes">← Clientes</Link></p>
      <div className="linha" style={{ alignItems: 'center', marginBottom: 4 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{c.nome_fantasia ?? c.razao_social ?? c.cod_cliente}</h1>
          <div className="suave">{c.razao_social && c.razao_social !== c.nome_fantasia ? `${c.razao_social} · ` : ''}código {c.cod_cliente}{c.cnpjcpf ? ` · ${c.cnpjcpf}` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {c.bloqueado && <span className="selo erro">Bloqueado</span>}
          {c.titulos.vencido > 0 && <span className="selo erro">Vencido {moeda(c.titulos.vencido)}</span>}
          {c.pagamento_antecipado && <span className="selo aviso">Pagamento antecipado</span>}
          {podeCriar && vend && (
            <button className="btn ok" disabled={c.bloqueado} onClick={() => navegar(`/novo-pedido?vendedor=${vend.cod_vendedor}&cliente=${c.cod_cliente}`)}>Novo pedido para este cliente</button>
          )}
        </div>
      </div>

      <div className="cartoes" style={{ marginTop: 12 }}>
        <div className="cartao"><div className="suave">Compras (12 meses)</div><div className="numero">{moeda(c.total_12m)}</div><div className="suave">{c.ultimos_pedidos.length ? `última em ${dataBR(c.ultimos_pedidos[0].dt_criacao)}` : 'sem compras no período'}</div></div>
        <div className="cartao"><div className="suave">Títulos em aberto</div><div className="numero">{moeda(c.titulos.em_aberto)}</div><div className="suave">a vencer</div></div>
        <div className="cartao"><div className="suave">Títulos vencidos</div><div className="numero" style={{ color: c.titulos.vencido > 0 ? '#dc2626' : '#16a34a' }}>{moeda(c.titulos.vencido)}</div><div className="suave">{c.titulos.vencido > 0 ? 'atrasados' : 'nada em atraso'}</div></div>
        <div className="cartao"><div className="suave">Pedido mínimo</div><div className="numero">{c.pedido_minimo ? moeda(c.pedido_minimo) : '—'}</div><div className="suave">{c.vendedores.length ? c.vendedores.map((v) => v.nome ?? v.cod_vendedor).join(' / ') : 'sem vendedor sincronizado'}</div></div>
      </div>

      <div className="grade-3">
        <Secao titulo="Cadastro" aoVerMais={verCadastro}>
          <Linha rotulo="Endereço" valor={enderecoTxt ? (enderecoTxt.length > 60 ? `${enderecoTxt.slice(0, 58)}…` : enderecoTxt) : '—'} />
          <Linha rotulo="Telefone" valor={c.telefone || '—'} />
          <Linha rotulo="Localização" valor={mapa} />
        </Secao>

        <Secao titulo="Comercial" aoVerMais={verComercial}>
          <Linha rotulo="Canal" valor={c.areas[0]?.canal?.descricao ?? '—'} />
          <Linha rotulo="Escritório" valor={c.areas[0]?.escritorio?.descricao ?? '—'} />
          <Linha rotulo="Pagamento" valor={c.formas_pagamento?.length ? c.formas_pagamento.map((f) => f.descricao ?? f.codigo).join(', ') : '—'} />
        </Secao>

        <Secao titulo="Financeiro" aoVerMais={verFinanceiro} rotuloMais={`Ver títulos${c.titulos.lista.length ? ` (${c.titulos.lista.length})` : ''}`}>
          <Linha rotulo="Limite" valor={`${moeda(c.limite_disponivel)} de ${moeda(c.limite_total)}`} />
          {usado != null && c.limite_total ? (
            <div style={{ margin: '4px 0 6px' }}>
              <div className="barra-trilho"><div className="barra" style={{ width: `${Math.max(pctLimite, 1)}%`, background: pctLimite > 90 ? '#dc2626' : '#ea580c' }} /></div>
              <div className="suave">{pctLimite.toFixed(0)}% do limite utilizado</div>
            </div>
          ) : null}
          <Linha rotulo="Vencido" valor={<span style={{ color: c.titulos.vencido > 0 ? '#dc2626' : undefined }}>{moeda(c.titulos.vencido)}</span>} />
        </Secao>

        <Secao titulo="Compras por mês" aoVerMais={verCompras} rotuloMais="Ver tabela">
          <div className="colunas" style={{ height: 120 }}>
            {c.compras_por_mes.map((m) => (
              <div className="coluna" key={m.mes} title={`${nomeMes(m.mes)}: ${moeda(m.valor)} · ${m.pedidos} pedidos`}>
                <div className="coluna-trilho"><div className="coluna-barra" style={{ height: `${m.valor > 0 ? Math.max((m.valor / maxMes) * 100, 2) : 0}%` }} /></div>
                <div className="coluna-rotulo">{nomeMes(m.mes).slice(0, 1).toUpperCase()}</div>
              </div>
            ))}
          </div>
          <div className="suave">Maior mês: {abrev(maxMes) || '—'}</div>
        </Secao>

        <Secao titulo="Últimos pedidos" aoVerMais={c.ultimos_pedidos.length > 3 ? verPedidos : undefined} rotuloMais={`Ver os ${c.ultimos_pedidos.length}`}>
          {c.ultimos_pedidos.length === 0 ? <p className="suave">Nenhum pedido nos últimos 12 meses.</p> : <MiniPedidos lista={c.ultimos_pedidos.slice(0, 3)} />}
        </Secao>

        <Secao titulo="Produtos que mais compra" aoVerMais={c.produtos_mais_comprados.length > 3 ? verProdutos : undefined} rotuloMais={`Ver os ${c.produtos_mais_comprados.length}`}>
          {c.produtos_mais_comprados.length === 0 ? <p className="suave">Sem histórico de itens deste cliente.</p> : <MiniProdutos lista={c.produtos_mais_comprados.slice(0, 3)} />}
        </Secao>

        <Secao titulo="Visitas recentes" aoVerMais={c.visitas.length > 2 ? verVisitas : undefined} rotuloMais={`Ver as ${c.visitas.length}`}>
          {c.visitas.length === 0 ? <p className="suave">Nenhuma visita registrada.</p> : <ListaVisitas lista={c.visitas.slice(0, 2)} />}
        </Secao>
      </div>
    </>
  );
}
