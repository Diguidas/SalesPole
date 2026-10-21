import { api } from './api';
import { apagarFoto, lerFoto } from './camera';
import { supabase } from './supabase';

export const BUCKET_ANEXOS = 'solicitacoes-anexos';

export interface Opcao {
  codigo: string;
  descricao: string;
}

export interface OpcoesFormulario {
  org_vendas: Opcao[];
  canais: Opcao[];
  tipos_estabelecimento: Array<Opcao & { canais: string[] }>;
  redes: Opcao[];
  prazos: Opcao[];
  motivos_exclusao: string[];
}

export interface DadosVendedor {
  cod_vendedor: string;
  nome: string | null;
  rota: string | null;
  escritorio: string | null;
  equipe: string | null;
  supervisor: string | null;
}

export interface ClienteSupervisor {
  cod_cliente: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  limite_total: number | null;
  rota: string | null;
  vendedor: string | null;
}

export const apenasDigitos = (v: string) => v.replace(/\D/g, '');

export function mascaraCep(v: string): string {
  const d = apenasDigitos(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function mascaraDocumento(v: string, pessoa: 'J' | 'F'): string {
  const d = apenasDigitos(v).slice(0, pessoa === 'J' ? 14 : 11);
  if (pessoa === 'F') return d.replace(/(\d{3})(\d{0,3})(\d{0,3})(\d{0,2})/, (_, a, b, c, e) => [a, b && `.${b}`, c && `.${c}`, e && `-${e}`].join(''));
  return d.replace(/(\d{2})(\d{0,3})(\d{0,3})(\d{0,4})(\d{0,2})/, (_, a, b, c, e, f) => [a, b && `.${b}`, c && `.${c}`, e && `/${e}`, f && `-${f}`].join(''));
}

export function mascaraTelefone(v: string): string {
  const d = apenasDigitos(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  const corte = d.length > 10 ? 7 : 6;
  return `(${d.slice(0, 2)}) ${d.slice(2, corte)}-${d.slice(corte)}`;
}

async function buscarJson<T>(url: string): Promise<T | null> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 12_000);
  try {
    const r = await fetch(url, { signal: controle.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface EnderecoCep {
  endereco: string;
  bairro: string;
  municipio: string;
  uf: string;
}

/** ViaCEP: null se o CEP nao existe ou a consulta falhou (o vendedor digita o endereco). */
export async function consultarCep(cep: string): Promise<EnderecoCep | null> {
  const d = apenasDigitos(cep);
  if (d.length !== 8) return null;
  const r = await buscarJson<{ erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }>(`https://viacep.com.br/ws/${d}/json/`);
  if (!r || r.erro) return null;
  return { endereco: r.logradouro ?? '', bairro: r.bairro ?? '', municipio: r.localidade ?? '', uf: r.uf ?? '' };
}

export interface DadosCnpj extends EnderecoCep {
  razao_social: string;
  nome_fantasia: string;
  cep: string;
  numero: string;
  complemento: string;
}

/** BrasilAPI (dados abertos da Receita). A inscricao estadual NAO vem de la. */
export async function consultarCnpj(cnpj: string): Promise<DadosCnpj | null> {
  const d = apenasDigitos(cnpj);
  if (d.length !== 14) return null;
  const r = await buscarJson<Record<string, string | null>>(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
  if (!r || !r.razao_social) return null;
  return {
    razao_social: r.razao_social ?? '',
    nome_fantasia: r.nome_fantasia ?? '',
    cep: r.cep ?? '',
    endereco: r.logradouro ?? '',
    numero: r.numero ?? '',
    complemento: r.complemento ?? '',
    bairro: r.bairro ?? '',
    municipio: r.municipio ?? '',
    uf: r.uf ?? '',
  };
}

/** Sobe o comprovante direto no Storage com o token da API e apaga o arquivo local. */
export async function enviarComprovante(upload: { caminho: string; token: string }, uri: string): Promise<void> {
  const conteudo = await lerFoto(uri);
  const { error } = await supabase.storage.from(BUCKET_ANEXOS).uploadToSignedUrl(upload.caminho, upload.token, conteudo, { contentType: 'image/jpeg' });
  if (error) throw new Error(`Falha ao enviar o comprovante: ${error.message}`);
  apagarFoto(uri);
}

export const opcoesVendedor = () => api<OpcoesFormulario>('/solicitacoes/opcoes');
export const opcoesSupervisor = () => api<OpcoesFormulario>('/equipe/solicitacoes/opcoes', { semVendedor: true });
