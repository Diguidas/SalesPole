import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

interface Area { tipo_material?: string; canal?: { descricao?: string }; escritorio?: { descricao?: string }; lista_preco?: { codigo?: string; descricao?: string }; rede?: { descricao?: string }; cond_pagamento?: { descricao?: string } }
interface Cliente {
  cod_cliente: string; nome_fantasia: string | null; razao_social: string | null; cnpjcpf: string | null; telefone: string | null; bloqueado: boolean;
  pagamento_antecipado: boolean; endereco: { logradouro?: string; bairro?: string; cidade?: string; uf?: string; cep?: string } | null;
  limite_total: number | null; limite_disponivel: number | null; pedido_minimo: number | null; latitude: number | null; longitude: number | null;
  dias_entrega: number[]; classe_risco: { descricao?: string; codigo?: string } | null; areas: Area[]; formas_pagamento: Array<{ descricao?: string; codigo?: string }> | null;
  rota: string | null; vendedores: Array<{ cod_vendedor: string; nome: string | null }>; visitas_na_semana: Array<{ dia_semana: number; sequencia: number }>;
  compras_por_mes: Array<{ mes: string; valor: number; pedidos: number }>; total_12m: number;
  ultimos_pedidos: Array<{ ordem: string; dt_criacao: string; valor: number; status: string | null }>;
  titulos: { em_aberto: number; vencido: number; lista: Array<{ nfe: string; parcela: string; status: string; valor: number | null; vencimento: string | null; boleto_url: string | null }> };
  visitas: Array<{ id: string; data_visita: string; cod_vendedor: string; status: string; resultado: string | null; motivo_nao_venda: string | null; validacao: string; fora_do_raio: boolean }>;
  produtos_mais_comprados: Array<{ cod_produto: string; denominacao: string | null; quantidade: number; unidade: string | null; pedidos: number; ultima_compra: string | null }>;
}

const DIAS = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const moeda = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBR = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const abrev = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `${Math.round(v / 1e3)} mil` : v > 0 ? String(Math.round(v)) : '');
const tom = (s: string | null) => { const t = (s ?? '').toLowerCase(); return t.startsWith('faturado') ? 'ok' : t === 'recusado' ? 'erro' : t ? 'aviso' : ''; };

/** Pagina do cliente: cadastro, comercial, financeiro, compras, visitas e produtos. */
export function ClienteDetalheScreen() {
  const { cod = '' } = useParams();
  const navegar = useNavigate();
  const { usuario } = useAuth();
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
  const podeCriar = usuario?.papel === 'admin' || usuario?.papel === 'aprovador';
  const vend = c.vendedores[0];

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

      <div className="grade-2">
        <div className="card">
          <h3>Cadastro</h3>
          <Linha rotulo="Endereço" valor={enderecoTxt || '—'} />
          <Linha rotulo="Telefone" valor={c.telefone || '—'} />
          <Linha rotulo="Localização" valor={c.latitude != null && c.longitude != null ? <a href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`} target="_blank" rel="noreferrer">Ver no mapa</a> : 'sem coordenada (a visita não confere a distância)'} />
          <Linha rotulo="Classe de risco" valor={c.classe_risco?.descricao ?? c.classe_risco?.codigo ?? '—'} />
          <Linha rotulo="Entrega" valor={c.dias_entrega.length ? c.dias_entrega.map((d) => DIAS[d]).join(', ') : '—'} />
          <Linha rotulo="Visita" valor={c.visitas_na_semana.length ? `${c.rota ? `rota ${c.rota} · ` : ''}${c.visitas_na_semana.map((v) => DIAS[v.dia_semana] ?? '—').join(', ')}` : '—'} />
        </div>
        <div className="card">
          <h3>Comercial</h3>
          {c.areas.length === 0 && <p className="suave">Sem área de vendas.</p>}
          {c.areas.map((a, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div className="suave" style={{ fontWeight: 700 }}>{a.tipo_material === 'FERT' ? 'Produtos fabricados' : a.tipo_material === 'HAWA' ? 'Produtos de revenda' : a.tipo_material ?? 'Área'}</div>
              <Linha rotulo="Canal / escritório" valor={`${a.canal?.descricao ?? '—'} · ${a.escritorio?.descricao ?? '—'}`} />
              <Linha rotulo="Lista de preço" valor={a.lista_preco?.descricao ?? a.lista_preco?.codigo ?? '—'} />
              <Linha rotulo="Condição" valor={a.cond_pagamento?.descricao ?? '—'} />
            </div>
          ))}
          <Linha rotulo="Formas de pagamento" valor={c.formas_pagamento?.length ? c.formas_pagamento.map((f) => f.descricao ?? f.codigo).join(', ') : '—'} />
        </div>
        <div className="card">
          <h3>Financeiro</h3>
          <Linha rotulo="Limite total" valor={moeda(c.limite_total)} />
          <Linha rotulo="Disponível" valor={moeda(c.limite_disponivel)} />
          {usado != null && c.limite_total ? (
            <div style={{ margin: '6px 0 10px' }}>
              <div className="barra-trilho"><div className="barra" style={{ width: `${Math.max(pctLimite, 1)}%`, background: pctLimite > 90 ? '#dc2626' : '#ea580c' }} /></div>
              <div className="suave">{moeda(usado)} utilizados ({pctLimite.toFixed(0)}%)</div>
            </div>
          ) : null}
          {c.titulos.lista.length === 0 ? <p className="suave">Nenhum título em aberto.</p> : (
            <table style={{ border: 'none' }}>
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
        </div>
        <div className="card">
          <h3>Compras por mês</h3>
          <div className="colunas">
            {c.compras_por_mes.map((m) => (
              <div className="coluna" key={m.mes} title={`${nomeMes(m.mes)}: ${moeda(m.valor)} · ${m.pedidos} pedidos`}>
                <div className="coluna-valor">{abrev(m.valor)}</div>
                <div className="coluna-trilho"><div className="coluna-barra" style={{ height: `${m.valor > 0 ? Math.max((m.valor / maxMes) * 100, 2) : 0}%` }} /></div>
                <div className="coluna-rotulo">{nomeMes(m.mes).slice(0, 3)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grade-2">
        <div className="card">
          <h3>Últimos pedidos</h3>
          {c.ultimos_pedidos.length === 0 ? <p className="suave">Nenhum pedido nos últimos 12 meses.</p> : (
            <table style={{ border: 'none' }}>
              <thead><tr><th>Ordem</th><th>Data</th><th style={{ textAlign: 'right' }}>Valor</th><th>Status</th></tr></thead>
              <tbody>
                {c.ultimos_pedidos.map((p) => (
                  <tr key={p.ordem}>
                    <td><Link to={`/pedidos?ordem=${p.ordem}&busca=${p.ordem}`}>{p.ordem}</Link></td>
                    <td>{dataBR(p.dt_criacao)}</td>
                    <td style={{ textAlign: 'right' }}>{moeda(p.valor)}</td>
                    <td><span className={`selo ${tom(p.status)}`}>{p.status ?? '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3>Produtos que mais compra (12 meses)</h3>
          {c.produtos_mais_comprados.length === 0 ? <p className="suave">Sem histórico de itens deste cliente.</p> : (
            <table style={{ border: 'none' }}>
              <thead><tr><th>Produto</th><th style={{ textAlign: 'right' }}>Quantidade</th><th>Última compra</th></tr></thead>
              <tbody>
                {c.produtos_mais_comprados.map((p) => (
                  <tr key={p.cod_produto}>
                    <td>{p.denominacao ?? p.cod_produto} <span className="suave">· {p.cod_produto}</span></td>
                    <td style={{ textAlign: 'right' }}>{p.quantidade.toLocaleString('pt-BR')} {p.unidade ?? ''}</td>
                    <td>{dataBR(p.ultima_compra)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3>Visitas recentes (60 dias)</h3>
          {c.visitas.length === 0 ? <p className="suave">Nenhuma visita registrada.</p> : c.visitas.map((v) => (
            <div key={v.id} className="resumo-linha">
              <span>{dataBR(v.data_visita)} · {v.status === 'concluida' ? (v.resultado === 'vendeu' ? 'Vendeu' : `Não vendeu: ${v.motivo_nao_venda ?? '—'}`) : 'Em andamento'}{v.fora_do_raio ? ' · fora do raio' : ''}</span>
              <span className={`selo ${v.validacao === 'validada' ? 'ok' : v.validacao === 'recusada' ? 'erro' : 'aviso'}`}>{v.validacao === 'validada' ? 'Validada' : v.validacao === 'recusada' ? 'Recusada' : 'Pendente'}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return <div className="resumo-linha"><span className="suave">{rotulo}</span><span style={{ textAlign: 'right' }}>{valor}</span></div>;
}
