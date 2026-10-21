import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

interface Linha {
  id: string; tipo: string; status: string; documento: string | null; cod_cliente: string | null; cod_vendedor: string | null;
  vendedor_nome: string | null; supervisor_nome: string | null; dados: Record<string, unknown>; created_at: string;
}
interface Lista { pagina: number; por_pagina: number; total: number; itens: Linha[] }
interface Detalhe extends Linha {
  supervisor_email: string | null; criado_por: string; comprovante_url: string | null;
}

const TIPOS = [
  { v: '', r: 'Todas' },
  { v: 'cadastro_cliente', r: 'Cadastro de cliente' },
  { v: 'aumento_limite', r: 'Aumento de limite' },
  { v: 'alteracao_pagamento', r: 'Condição de pagamento' },
  { v: 'agrupamento', r: 'Agrupamento' },
  { v: 'exclusao', r: 'Exclusão' },
];
const ROTULO_TIPO = Object.fromEntries(TIPOS.map((t) => [t.v, t.r]));
const ROTULO_STATUS: Record<string, string> = { recebida: 'Recebida', enviada: 'Enviada', erro: 'Erro' };

const ROTULOS: Record<string, string> = {
  tipo_pessoa: 'Tipo de pessoa', documento: 'CNPJ/CPF', inscricao_estadual: 'Inscrição estadual', razao_social: 'Razão social', nome_fantasia: 'Nome fantasia',
  nome: 'Nome', sobrenome: 'Sobrenome', cep: 'CEP', endereco: 'Endereço', numero: 'Nº', complemento: 'Complemento', latitude: 'Latitude', longitude: 'Longitude',
  bairro: 'Bairro', uf: 'UF', municipio: 'Município', distrito: 'Distrito', ponto_referencia: 'Ponto de referência', email: 'E-mail prioritário',
  telefone_fixo: 'Telefone fixo', proprietario_nome: 'Proprietário', proprietario_celular: 'Celular do proprietário', proprietario_email: 'E-mail do proprietário',
  proprietario_compra: 'Proprietário responsável pelas compras', comprador_nome: 'Responsável pelas compras', comprador_celular: 'Celular do responsável',
  comprador_email: 'E-mail do responsável', em_rede: 'Participa de rede', rede: 'Rede', e_filial: 'É filial', cod_cliente_pai: 'Cliente pai',
  e_substituicao: 'É substituição', cod_cliente_substituido: 'Cliente substituído', org_vendas: 'Organização de venda', escritorio: 'Escritório', equipe: 'Equipe',
  rota: 'Rota', dia_visita: 'Dia de visita', ordem_visita: 'Ordem da visita', prazo: 'Prazo', canal: 'Canal de vendas', tipo_estabelecimento: 'Tipo de estabelecimento',
  vendedor_nome: 'Vendedor', observacao: 'Observação', cod_cliente: 'Código do cliente', conta_credito: 'Conta de crédito (conta pai)', limite_credito: 'Limite de crédito',
  condicao_pagamento: 'Condição de pagamento', motivo: 'Motivo da exclusão', supervisor_nome: 'Supervisor', supervisor_email: 'E-mail do supervisor',
};
const DIAS = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function valorTexto(chave: string, v: unknown): string {
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  if (chave === 'dia_visita') return DIAS[Number(v)] ?? String(v);
  if (chave === 'limite_credito') return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (chave === 'tipo_pessoa') return v === 'J' ? 'Jurídica' : 'Física';
  return String(v);
}

/** Nome do cliente da linha: cadastro mostra razao social/nome; alteracao e exclusao, a razao social do cliente existente. */
const nomeDe = (l: Linha) => String(l.dados.razao_social ?? l.dados.nome_fantasia ?? [l.dados.nome, l.dados.sobrenome].filter(Boolean).join(' ') ?? '') || '—';

/** Solicitacoes de cadastro, alteracao e exclusao de cliente feitas no app (por enquanto so ficam guardadas). */
export function SolicitacoesScreen() {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const podeCriar = !!usuario && ['admin', 'supervisor', 'gerente', 'gerente_geral'].includes(usuario.papel);
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
      if (tipo) q.set('tipo', tipo);
      if (buscaAplicada) q.set('busca', buscaAplicada);
      setDados(await api<Lista>(`/painel/solicitacoes?${q}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [tipo, buscaAplicada, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.por_pagina)) : 1;

  return (
    <>
      <h1>Solicitações de cliente</h1>
      <p className="sub">Cadastros feitos pelos vendedores e alterações/exclusões pedidas pelos supervisores no app. Por enquanto ficam apenas registradas aqui.</p>

      {podeCriar && <p><Link className="btn ok" to="/solicitacoes/nova">+ Nova solicitação</Link></p>}

      <div className="chips">
        {TIPOS.map((t) => <button key={t.v} className={`chip${tipo === t.v ? ' ativo' : ''}`} onClick={() => { setTipo(t.v); setPagina(1); }}>{t.r}</button>)}
      </div>
      <div className="chips">
        <form style={{ display: 'flex', gap: 6 }} onSubmit={(e) => { e.preventDefault(); setBuscaAplicada(busca); setPagina(1); }}>
          <input className="entrada" placeholder="Cliente, documento ou vendedor" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <button className="btn" type="submit">Buscar</button>
        </form>
        <button className="chip" onClick={carregar}>Atualizar</button>
      </div>

      {erro && <p className="erro-msg">{erro}</p>}
      {!dados && !erro && <div className="vazio">Carregando…</div>}
      {dados && dados.itens.length === 0 && !erro && <div className="vazio">Nenhuma solicitação neste filtro.</div>}

      {dados && dados.itens.length > 0 && (
        <>
          <p className="suave" style={{ margin: '0 0 6px' }}>{dados.total.toLocaleString('pt-BR')} solicitaç{dados.total === 1 ? 'ão' : 'ões'} · página {dados.pagina} de {totalPaginas}</p>
          <table>
            <thead><tr><th>Data</th><th>Tipo</th><th>Cliente</th><th>Vendedor</th><th>Supervisor</th><th>Situação</th></tr></thead>
            <tbody>
              {dados.itens.map((l) => (
                <tr key={l.id} className="clicavel" onClick={() => navegar(`/solicitacoes/${l.id}`)}>
                  <td>{dataHora(l.created_at)}</td>
                  <td>{ROTULO_TIPO[l.tipo] ?? l.tipo}</td>
                  <td>{nomeDe(l)}<div className="suave">{l.cod_cliente ?? l.documento ?? ''}</div></td>
                  <td>{l.vendedor_nome ?? l.cod_vendedor ?? '—'}</td>
                  <td>{l.supervisor_nome ?? '—'}</td>
                  <td>{ROTULO_STATUS[l.status] ?? l.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="chips" style={{ marginTop: 10 }}>
            <button className="chip" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
            <button className="chip" disabled={pagina >= totalPaginas} onClick={() => setPagina(pagina + 1)}>Próxima →</button>
          </div>
        </>
      )}
    </>
  );
}

/** Tudo o que foi preenchido na solicitacao, mais o comprovante de endereco quando ha. */
export function SolicitacaoDetalheScreen() {
  const { id } = useParams();
  const [s, setS] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<Detalhe>(`/painel/solicitacoes/${id}`).then(setS).catch((e) => setErro((e as Error).message));
  }, [id]);

  if (erro) return <><Link to="/solicitacoes">← Solicitações</Link><p className="erro-msg">{erro}</p></>;
  if (!s) return <div className="vazio">Carregando…</div>;

  const campos = Object.entries(s.dados).filter(([k, v]) => v != null && v !== '' && !['tem_comprovante', 'supervisor_nome', 'vendedor_nome'].includes(k));
  return (
    <>
      <p><Link to="/solicitacoes">← Solicitações</Link></p>
      <h1>{ROTULO_TIPO[s.tipo] ?? s.tipo}</h1>
      <p className="sub">{dataHora(s.created_at)} · {ROTULO_STATUS[s.status] ?? s.status} · enviada por {s.criado_por}</p>

      <table>
        <tbody>
          <tr><th style={{ width: 280 }}>Vendedor</th><td>{s.vendedor_nome ?? s.cod_vendedor ?? '—'}</td></tr>
          <tr><th>Supervisor</th><td>{s.supervisor_nome ?? '—'}{s.supervisor_email ? ` · ${s.supervisor_email}` : ''}</td></tr>
          {campos.map(([k, v]) => <tr key={k}><th>{ROTULOS[k] ?? k}</th><td>{valorTexto(k, v)}</td></tr>)}
        </tbody>
      </table>

      {s.comprovante_url && (
        <>
          <h2 style={{ marginTop: 20 }}>Comprovante de endereço</h2>
          <a href={s.comprovante_url} target="_blank" rel="noreferrer"><img src={s.comprovante_url} alt="Comprovante de endereço" style={{ maxWidth: 420, borderRadius: 8 }} /></a>
          <p className="suave">O link expira em alguns minutos: recarregue a página para gerar outro.</p>
        </>
      )}
    </>
  );
}
