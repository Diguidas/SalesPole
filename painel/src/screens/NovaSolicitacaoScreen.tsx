import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { supabase } from '../supabase';

interface Opcao { codigo: string; descricao: string }
interface Opcoes {
  org_vendas: Opcao[]; canais: Opcao[]; tipos_estabelecimento: Array<Opcao & { canais: string[] }>; redes: Opcao[]; prazos: Opcao[]; motivos_exclusao: string[];
}
interface VendedorLinha { cod_vendedor: string; nome: string | null; rota: string }
interface DadosVendedor { cod_vendedor: string; nome: string | null; rota: string | null; escritorio: string | null; equipe: string | null; supervisor: string | null }
interface ClienteLinha { cod_cliente: string; razao_social: string | null; nome_fantasia: string | null; rota: string | null; vendedor: string | null }

type Tipo = 'cadastro_cliente' | 'aumento_limite' | 'alteracao_pagamento' | 'agrupamento' | 'exclusao';
const TIPOS: Array<{ v: Tipo; r: string }> = [
  { v: 'cadastro_cliente', r: 'Cadastro de cliente' },
  { v: 'aumento_limite', r: 'Aumento de limite' },
  { v: 'alteracao_pagamento', r: 'Condição de pagamento' },
  { v: 'agrupamento', r: 'Agrupamento' },
  { v: 'exclusao', r: 'Exclusão' },
];
const DIAS = [{ v: '1', r: 'Segunda' }, { v: '2', r: 'Terça' }, { v: '3', r: 'Quarta' }, { v: '4', r: 'Quinta' }, { v: '5', r: 'Sexta' }];

const digitos = (s: string) => s.replace(/\D/g, '');
const mascaraCep = (s: string) => { const d = digitos(s).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
const mascaraDoc = (s: string, p: 'J' | 'F') => {
  const d = digitos(s).slice(0, p === 'J' ? 14 : 11);
  if (p === 'F') return d.replace(/(\d{3})(\d{0,3})(\d{0,3})(\d{0,2})/, (_, a, b, c, e) => [a, b && `.${b}`, c && `.${c}`, e && `-${e}`].join(''));
  return d.replace(/(\d{2})(\d{0,3})(\d{0,3})(\d{0,4})(\d{0,2})/, (_, a, b, c, e, f) => [a, b && `.${b}`, c && `.${c}`, e && `/${e}`, f && `-${f}`].join(''));
};
const mascaraFone = (s: string) => {
  const d = digitos(s).slice(0, 11);
  if (d.length <= 2) return d;
  const corte = d.length > 10 ? 7 : 6;
  return d.length <= 6 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : `(${d.slice(0, 2)}) ${d.slice(2, corte)}-${d.slice(corte)}`;
};

async function buscarJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Reduz a imagem escolhida para JPEG (o bucket aceita so JPEG e o comprovante nao precisa de mais que isso). */
async function paraJpeg(arquivo: File): Promise<Blob> {
  const img = await createImageBitmap(arquivo);
  const escala = Math.min(1, 1600 / img.width);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * escala);
  c.height = Math.round(img.height * escala);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('Imagem invalida'))), 'image/jpeg', 0.8));
}

type V = Record<string, string>;

function Campo({ rotulo, obrigatorio, children, dica }: { rotulo: string; obrigatorio?: boolean; children: ReactNode; dica?: string }) {
  return (
    <label className="campo">
      <span>{rotulo}{obrigatorio ? ' *' : ''}</span>
      {children}
      {dica && <small className="suave">{dica}</small>}
    </label>
  );
}

function Entrada({ v, set, k, rotulo, obrigatorio, mascara, desabilitado, max }: {
  v: V; set: (k: string, x: string) => void; k: string; rotulo: string; obrigatorio?: boolean; mascara?: (s: string) => string; desabilitado?: boolean; max?: number;
}) {
  return (
    <Campo rotulo={rotulo} obrigatorio={obrigatorio}>
      <input type="text" value={v[k] ?? ''} disabled={desabilitado} maxLength={max} onChange={(e) => set(k, mascara ? mascara(e.target.value) : e.target.value)} />
    </Campo>
  );
}

function Lista({ v, set, k, rotulo, obrigatorio, opcoes, desabilitado }: {
  v: V; set: (k: string, x: string) => void; k: string; rotulo: string; obrigatorio?: boolean; opcoes: Array<{ v: string; r: string }>; desabilitado?: boolean;
}) {
  return (
    <Campo rotulo={rotulo} obrigatorio={obrigatorio}>
      <select value={v[k] ?? ''} disabled={desabilitado} onChange={(e) => set(k, e.target.value)}>
        <option value="">Selecione…</option>
        {opcoes.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}
      </select>
    </Campo>
  );
}

function SimNao({ rotulo, valor, onChange }: { rotulo: string; valor: boolean | null; onChange: (b: boolean) => void }) {
  return (
    <Campo rotulo={rotulo} obrigatorio>
      <select value={valor === null ? '' : valor ? 'sim' : 'nao'} onChange={(e) => e.target.value && onChange(e.target.value === 'sim')}>
        <option value="">Selecione…</option>
        <option value="sim">Sim</option>
        <option value="nao">Não</option>
      </select>
    </Campo>
  );
}

const unicas = (l: Opcao[]) => [...new Map(l.map((o) => [o.descricao, { v: o.descricao, r: o.descricao }])).values()];

/** Cria uma solicitacao pelo painel: cadastro de cliente (em nome de um vendedor da equipe) ou alteracao/exclusao de cliente. */
export function NovaSolicitacaoScreen() {
  const navegar = useNavigate();
  const [tipo, setTipo] = useState<Tipo>('cadastro_cliente');
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<Opcoes>('/equipe/solicitacoes/opcoes').then(setOpcoes).catch((e) => setErro((e as Error).message));
  }, []);

  return (
    <>
      <p><Link to="/solicitacoes">← Solicitações</Link></p>
      <h1>Nova solicitação</h1>
      <p className="sub">Por enquanto a solicitação fica apenas registrada.</p>
      <div className="chips">
        {TIPOS.map((t) => <button key={t.v} className={`chip${tipo === t.v ? ' ativo' : ''}`} onClick={() => setTipo(t.v)}>{t.r}</button>)}
      </div>
      {erro && <p className="erro-msg">{erro}</p>}
      {!opcoes && !erro && <div className="vazio">Carregando…</div>}
      {opcoes && (tipo === 'cadastro_cliente'
        ? <FormCadastro opcoes={opcoes} aoSalvar={() => navegar('/solicitacoes')} />
        : <FormCliente key={tipo} tipo={tipo} opcoes={opcoes} aoSalvar={() => navegar('/solicitacoes')} />)}
    </>
  );
}

function FormCadastro({ opcoes, aoSalvar }: { opcoes: Opcoes; aoSalvar: () => void }) {
  const [vendedores, setVendedores] = useState<VendedorLinha[]>([]);
  const [vendedor, setVendedor] = useState<DadosVendedor | null>(null);
  const [pessoa, setPessoa] = useState<'J' | 'F'>('J');
  const [v, setV] = useState<V>({ dia_visita: '1' });
  const [sn, setSn] = useState<Record<string, boolean | null>>({ proprietario_compra: null, em_rede: null, e_filial: null, e_substituicao: null });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api<VendedorLinha[]>('/painel/solicitacoes/vendedores').then(setVendedores).catch((e) => setErro((e as Error).message));
  }, []);

  const set = (k: string, x: string) => setV((a) => ({ ...a, [k]: x }));
  const setSim = (k: string) => (b: boolean) => setSn((a) => ({ ...a, [k]: b }));

  async function escolherVendedor(cod: string) {
    set('cod_vendedor', cod);
    setVendedor(null);
    if (!cod) return;
    try {
      setVendedor(await api<DadosVendedor>(`/painel/solicitacoes/vendedor/${cod}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function buscarCep() {
    const d = digitos(v.cep ?? '');
    if (d.length !== 8) return;
    const r = await buscarJson<{ erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }>(`https://viacep.com.br/ws/${d}/json/`);
    if (!r || r.erro) return setMsg('CEP não encontrado: preencha o endereço manualmente.');
    setMsg(null);
    setV((a) => ({ ...a, endereco: r.logradouro || a.endereco || '', bairro: r.bairro || a.bairro || '', municipio: r.localidade ?? '', uf: r.uf ?? '' }));
  }

  async function buscarCnpj() {
    const d = digitos(v.documento ?? '');
    if (pessoa !== 'J' || d.length !== 14) return;
    const r = await buscarJson<Record<string, string | null>>(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
    if (!r?.razao_social) return setMsg('CNPJ não encontrado na consulta: preencha os dados manualmente.');
    setMsg('Dados preenchidos pela Receita Federal. A inscrição estadual precisa ser informada.');
    setV((a) => ({
      ...a, razao_social: r.razao_social ?? '', nome_fantasia: r.nome_fantasia || r.razao_social || '', cep: mascaraCep(r.cep ?? ''), endereco: r.logradouro ?? '',
      numero: r.numero ?? '', complemento: r.complemento ?? '', bairro: r.bairro ?? '', municipio: r.municipio ?? '', uf: r.uf ?? '',
    }));
  }

  function localizar() {
    navigator.geolocation?.getCurrentPosition(
      (p) => setV((a) => ({ ...a, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) })),
      () => setErro('Não foi possível obter a localização deste computador.'),
    );
  }

  const canalCodigo = opcoes.canais.find((c) => c.descricao === v.canal)?.codigo;
  const tipos = useMemo(
    () => unicas(opcoes.tipos_estabelecimento.filter((t) => !canalCodigo || t.canais.includes(canalCodigo))),
    [opcoes, canalCodigo],
  );

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!v.cod_vendedor) return setErro('Escolha o vendedor.');
    if ((Object.keys(sn) as string[]).some((k) => sn[k] === null)) return setErro('Responda todas as perguntas de Sim ou Não.');
    if (pessoa === 'F' && !arquivo) return setErro('Anexe o comprovante de endereço (obrigatório para pessoa física).');
    setSalvando(true);
    try {
      const corpo = { ...v, tipo_pessoa: pessoa, ...sn, dia_visita: Number(v.dia_visita), ordem_visita: Number(v.ordem_visita), tem_comprovante: pessoa === 'F' && !!arquivo };
      const r = await api<{ id: string; upload: { caminho: string; token: string } | null }>('/painel/solicitacoes/cadastro-cliente', { method: 'POST', body: corpo });
      if (r.upload && arquivo) {
        const { error } = await supabase.storage.from('solicitacoes-anexos').uploadToSignedUrl(r.upload.caminho, r.upload.token, await paraJpeg(arquivo), { contentType: 'image/jpeg' });
        if (error) {
          alert(`Solicitação registrada, mas o comprovante não subiu (${error.message}). Reenvie o comprovante depois.`);
        }
      }
      aoSalvar();
    } catch (e2) {
      setErro((e2 as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const ent = { v, set };
  return (
    <form onSubmit={enviar}>
      {msg && <p className="suave">{msg}</p>}

      <div className="card">
        <h3>Vendedor</h3>
        <div className="form-grade">
          <Campo rotulo="Vendedor" obrigatorio>
            <select value={v.cod_vendedor ?? ''} onChange={(e) => void escolherVendedor(e.target.value)}>
              <option value="">Selecione…</option>
              {vendedores.map((x) => <option key={x.cod_vendedor} value={x.cod_vendedor}>{x.nome ?? x.cod_vendedor} · rota {x.rota}</option>)}
            </select>
          </Campo>
        </div>
        {vendedor && (
          <div className="form-grade" style={{ marginTop: 12 }}>
            <Campo rotulo="Escritório"><input type="text" disabled value={vendedor.escritorio ?? '—'} /></Campo>
            <Campo rotulo="Equipe"><input type="text" disabled value={vendedor.equipe ?? '—'} /></Campo>
            <Campo rotulo="Rota"><input type="text" disabled value={vendedor.rota ?? '—'} /></Campo>
            <Campo rotulo="Supervisor"><input type="text" disabled value={vendedor.supervisor ?? '—'} /></Campo>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Informações do negócio</h3>
        <div className="chips">
          <button type="button" className={`chip${pessoa === 'J' ? ' ativo' : ''}`} onClick={() => { setPessoa('J'); set('documento', ''); }}>Pessoa jurídica</button>
          <button type="button" className={`chip${pessoa === 'F' ? ' ativo' : ''}`} onClick={() => { setPessoa('F'); set('documento', ''); }}>Pessoa física</button>
        </div>
        <div className="form-grade">
          <Campo rotulo={pessoa === 'J' ? 'CNPJ' : 'CPF'} obrigatorio>
            <input type="text" value={v.documento ?? ''} onChange={(e) => set('documento', mascaraDoc(e.target.value, pessoa))} onBlur={buscarCnpj} />
          </Campo>
          {pessoa === 'J' ? (
            <>
              <Entrada {...ent} k="inscricao_estadual" rotulo="Inscrição estadual" obrigatorio max={20} />
              <Entrada {...ent} k="razao_social" rotulo="Razão social" obrigatorio max={120} />
              <Entrada {...ent} k="nome_fantasia" rotulo="Nome fantasia" obrigatorio max={120} />
            </>
          ) : (
            <>
              <Entrada {...ent} k="nome" rotulo="Nome" obrigatorio max={60} />
              <Entrada {...ent} k="sobrenome" rotulo="Sobrenome" obrigatorio max={60} />
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Informações de endereço</h3>
        <div className="form-grade">
          <Campo rotulo="CEP" obrigatorio><input type="text" value={v.cep ?? ''} onChange={(e) => set('cep', mascaraCep(e.target.value))} onBlur={buscarCep} /></Campo>
          <Entrada {...ent} k="endereco" rotulo="Endereço" obrigatorio max={120} />
          <Entrada {...ent} k="numero" rotulo="Nº" obrigatorio max={10} />
          <Entrada {...ent} k="complemento" rotulo="Complemento" max={60} />
          <Entrada {...ent} k="bairro" rotulo="Bairro" obrigatorio max={60} />
          <Entrada {...ent} k="municipio" rotulo="Município" obrigatorio max={60} />
          <Entrada {...ent} k="uf" rotulo="UF" obrigatorio max={2} mascara={(s) => s.toUpperCase()} />
          <Entrada {...ent} k="distrito" rotulo="Distrito" max={60} />
          <Entrada {...ent} k="ponto_referencia" rotulo="Ponto de referência" max={120} />
          <Entrada {...ent} k="latitude" rotulo="Latitude" />
          <Entrada {...ent} k="longitude" rotulo="Longitude" />
        </div>
        <div className="chips" style={{ marginTop: 10 }}>
          <button type="button" className="btn" onClick={localizar}>Usar a localização deste computador</button>
        </div>
        {pessoa === 'F' && (
          <Campo rotulo="Comprovante de endereço" obrigatorio dica="Foto ou imagem do comprovante (obrigatório para pessoa física).">
            <input type="file" accept="image/*" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </Campo>
        )}
      </div>

      <div className="card">
        <h3>Informações de contato</h3>
        <div className="form-grade">
          <Entrada {...ent} k="email" rotulo="E-mail prioritário (portal de compras, NF, XML)" obrigatorio max={120} />
          <Entrada {...ent} k="telefone_fixo" rotulo="Telefone fixo" mascara={mascaraFone} />
        </div>
      </div>

      <div className="card">
        <h3>Informações do proprietário</h3>
        <div className="form-grade">
          <Entrada {...ent} k="proprietario_nome" rotulo="Nome do proprietário" obrigatorio max={80} />
          <Entrada {...ent} k="proprietario_celular" rotulo="Telefone celular" obrigatorio mascara={mascaraFone} />
          <Entrada {...ent} k="proprietario_email" rotulo="E-mail" max={120} />
          <SimNao rotulo="O proprietário é responsável pelas compras?" valor={sn.proprietario_compra} onChange={setSim('proprietario_compra')} />
          {sn.proprietario_compra === false && (
            <>
              <Entrada {...ent} k="comprador_nome" rotulo="Nome do responsável pelas compras" obrigatorio max={80} />
              <Entrada {...ent} k="comprador_celular" rotulo="Celular do responsável" obrigatorio mascara={mascaraFone} />
              <Entrada {...ent} k="comprador_email" rotulo="E-mail do responsável" obrigatorio max={120} />
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Informações extras</h3>
        <div className="form-grade">
          <SimNao rotulo="Participa de alguma rede cadastrada na Pole?" valor={sn.em_rede} onChange={setSim('em_rede')} />
          {sn.em_rede && <Lista {...ent} k="rede" rotulo="Qual rede?" obrigatorio opcoes={unicas(opcoes.redes)} />}
          <SimNao rotulo="É filial de algum cliente já cadastrado?" valor={sn.e_filial} onChange={setSim('e_filial')} />
          {sn.e_filial && <Entrada {...ent} k="cod_cliente_pai" rotulo="Código do cliente pai" obrigatorio max={10} mascara={digitos} />}
          <SimNao rotulo="Será substituição de algum cliente já cadastrado?" valor={sn.e_substituicao} onChange={setSim('e_substituicao')} />
          {sn.e_substituicao && <Entrada {...ent} k="cod_cliente_substituido" rotulo="Código do cliente substituído" obrigatorio max={10} mascara={digitos} />}
          <Lista {...ent} k="org_vendas" rotulo="Organização de venda" obrigatorio opcoes={opcoes.org_vendas.map((o) => ({ v: o.codigo, r: o.descricao }))} />
          <Lista {...ent} k="dia_visita" rotulo="Dia de visita" obrigatorio opcoes={DIAS} />
          <Entrada {...ent} k="ordem_visita" rotulo="Ordem da visita" obrigatorio max={3} mascara={digitos} />
          <Lista {...ent} k="prazo" rotulo="Prazo" obrigatorio opcoes={unicas(opcoes.prazos)} />
          <Lista {...ent} k="canal" rotulo="Canal de vendas" obrigatorio opcoes={unicas(opcoes.canais)} />
          <Lista {...ent} k="tipo_estabelecimento" rotulo="Tipo de estabelecimento" obrigatorio opcoes={tipos} desabilitado={!v.canal} />
          <Campo rotulo="Observação"><input type="text" maxLength={500} value={v.observacao ?? ''} onChange={(e) => set('observacao', e.target.value)} /></Campo>
        </div>
        {opcoes.prazos.length === 0 && <p className="suave">Nenhum prazo cadastrado: cadastre em Cadastros → Prazos de pagamento.</p>}
      </div>

      {erro && <p className="erro-msg">{erro}</p>}
      <div className="chips">
        <button className="btn ok" type="submit" disabled={salvando}>{salvando ? 'Enviando…' : 'Enviar solicitação'}</button>
        <Link className="btn" to="/solicitacoes">Cancelar</Link>
      </div>
    </form>
  );
}

function FormCliente({ tipo, opcoes, aoSalvar }: { tipo: Tipo; opcoes: Opcoes; aoSalvar: () => void }) {
  const [codigo, setCodigo] = useState('');
  const [cliente, setCliente] = useState<ClienteLinha | null>(null);
  const [erroCliente, setErroCliente] = useState<string | null>(null);
  const [v, setV] = useState<V>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const set = (k: string, x: string) => setV((a) => ({ ...a, [k]: x }));

  async function buscar() {
    const cod = digitos(codigo).replace(/^0+/, '');
    setCliente(null);
    setErroCliente(null);
    if (!cod) return;
    try {
      setCliente(await api<ClienteLinha>(`/equipe/solicitacoes/cliente/${cod}`));
    } catch (e) {
      setErroCliente((e as Error).message);
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!cliente) return setErro('Informe o código de um cliente da sua equipe.');
    setErro(null);
    setSalvando(true);
    try {
      await api(`/equipe/solicitacoes/${tipo}`, { method: 'POST', body: { ...v, cod_cliente: cliente.cod_cliente } });
      aoSalvar();
    } catch (e2) {
      setErro((e2 as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const ent = { v, set };
  return (
    <form onSubmit={enviar}>
      <div className="card">
        <h3>Cliente</h3>
        <div className="form-grade">
          <Campo rotulo="Código do cliente" obrigatorio>
            <input type="text" value={codigo} onChange={(e) => setCodigo(digitos(e.target.value))} onBlur={buscar} maxLength={10} />
          </Campo>
          {cliente && (
            <>
              <Campo rotulo="Razão social"><input type="text" disabled value={cliente.razao_social ?? '—'} /></Campo>
              {tipo === 'exclusao' && (
                <>
                  <Campo rotulo="Nome fantasia"><input type="text" disabled value={cliente.nome_fantasia ?? '—'} /></Campo>
                  <Campo rotulo="Rota"><input type="text" disabled value={cliente.rota ?? '—'} /></Campo>
                  <Campo rotulo="Vendedor"><input type="text" disabled value={cliente.vendedor ?? '—'} /></Campo>
                </>
              )}
            </>
          )}
        </div>
        {erroCliente && <p className="erro-msg">{erroCliente}</p>}
      </div>

      <div className="card">
        <h3>{tipo === 'exclusao' ? 'Exclusão' : 'Dados da alteração'}</h3>
        <div className="form-grade">
          {tipo === 'exclusao' && <Lista {...ent} k="motivo" rotulo="Motivo de exclusão" obrigatorio opcoes={opcoes.motivos_exclusao.map((m) => ({ v: m, r: m }))} />}
          {tipo === 'agrupamento' && <Entrada {...ent} k="conta_credito" rotulo="Conta de crédito (conta pai)" obrigatorio max={10} mascara={digitos} />}
          {tipo === 'aumento_limite' && <Entrada {...ent} k="limite_credito" rotulo="Limite de crédito (R$)" obrigatorio max={15} />}
          {tipo === 'alteracao_pagamento' && <Lista {...ent} k="condicao_pagamento" rotulo="Condição de pagamento SAP" obrigatorio opcoes={unicas(opcoes.prazos)} />}
          <Campo rotulo={tipo === 'exclusao' ? 'Observação/resumo' : 'Observação/resumo'} obrigatorio={tipo !== 'exclusao'}>
            <input type="text" maxLength={500} value={v.observacao ?? ''} onChange={(e) => set('observacao', e.target.value)} />
          </Campo>
        </div>
      </div>

      {erro && <p className="erro-msg">{erro}</p>}
      <div className="chips">
        <button className={`btn ${tipo === 'exclusao' ? 'erro' : 'ok'}`} type="submit" disabled={salvando || !cliente}>{salvando ? 'Enviando…' : 'Enviar solicitação'}</button>
        <Link className="btn" to="/solicitacoes">Cancelar</Link>
      </div>
    </form>
  );
}
