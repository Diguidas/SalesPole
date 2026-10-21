import { randomUUID } from 'crypto';
import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { VendedorLogado } from '../auth/vendedores.service';
import { SUPABASE } from '../supabase/supabase.module';
import { normCod } from '../auth/vendedores.service';
import { Escopo, exigirVendedor, rotaNoEscopo } from './escopo';
import { UsuarioPainel } from './painel.guard';
import { TIPOS_SUPERVISOR, TipoSupervisor, soDigitos, validarCadastroCliente, validarSolicitacaoSupervisor } from './solicitacoes.validacao';

export const BUCKET_ANEXOS = 'solicitacoes-anexos';
/** Organizacoes de venda do formulario de cadastro. */
const ORG_VENDAS = [
  { codigo: '2100', descricao: '2100 · Pole Fortaleza' },
  { codigo: '2002', descricao: '2002 · Pole Cariri' },
  { codigo: '3001', descricao: '3001 · Pole Piauí' },
];
const PAPEIS_SUPERVISOR = ['admin', 'supervisor', 'gerente', 'gerente_geral'];
const TIPOS = ['cadastro_cliente', ...TIPOS_SUPERVISOR];
const POR_PAGINA = 50;

type Linha = Record<string, unknown>;

@Injectable()
export class SolicitacoesService implements OnModuleInit {
  private readonly logger = new Logger(SolicitacoesService.name);
  private cacheClientes: { em: number; lista: Array<{ campo: string; codigo: string; descricao: string }>; pares: Array<{ canal: string; tipo: string }> } | null = null;

  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {}

  async onModuleInit() {
    const { error } = await this.sb.storage.createBucket(BUCKET_ANEXOS, { public: false, fileSizeLimit: 5_000_000, allowedMimeTypes: ['image/jpeg'] });
    if (error && !/already exists|duplicate/i.test(error.message)) this.logger.warn(`Nao foi possivel criar o bucket ${BUCKET_ANEXOS}: ${error.message}`);
  }

  /** Listas dos formularios: valores que ja existem nos clientes do SAP + prazos e motivos cadastrados no painel. */
  async opcoes() {
    if (!this.cacheClientes || Date.now() - this.cacheClientes.em > 10 * 60_000) {
      const { data, error } = await this.sb.rpc('fn_opcoes_cliente');
      if (error) throw error;
      const { data: pares, error: e2 } = await this.sb.rpc('fn_tipos_por_canal');
      if (e2) throw e2;
      this.cacheClientes = { em: Date.now(), lista: (data ?? []) as Array<{ campo: string; codigo: string; descricao: string }>, pares: (pares ?? []) as Array<{ canal: string; tipo: string }> };
    }
    const de = (campo: string) =>
      this.cacheClientes!.lista.filter((x) => x.campo === campo && x.descricao.trim() && !/^(n[aã]o usar|\[inativo\])/i.test(x.descricao.trim())).map((x) => ({ codigo: x.codigo, descricao: x.descricao })).sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));

    const [prazos, motivos] = await Promise.all([
      this.sb.from('prazos_pagamento').select('codigo, descricao').eq('ativo', true).order('ordem').order('descricao'),
      this.sb.from('motivos_exclusao').select('descricao').eq('ativo', true).order('ordem').order('descricao'),
    ]);
    if (prazos.error) throw prazos.error;
    if (motivos.error) throw motivos.error;
    return {
      org_vendas: ORG_VENDAS,
      canais: de('canal'),
      tipos_estabelecimento: de('tipo_estabelecimento').map((t) => ({ ...t, canais: this.cacheClientes!.pares.filter((p) => p.tipo === t.codigo).map((p) => p.canal) })),
      redes: de('rede'),
      prazos: prazos.data ?? [],
      motivos_exclusao: (motivos.data ?? []).map((m) => (m as { descricao: string }).descricao),
    };
  }

  /** Dados do vendedor logado que o formulario de cadastro mostra (escritorio, equipe, rota, nome). */
  async dadosVendedor(v: VendedorLogado) {
    const { data, error } = await this.sb.from('vendedores').select('nome, rota, escritorio, equipe').eq('cod_vendedor', v.codVendedor).maybeSingle();
    if (error) throw error;
    const sup = await this.supervisorDe((data as Linha | null)?.escritorio as string | null, (data as Linha | null)?.equipe as string | null);
    return { cod_vendedor: v.codVendedor, nome: (data as Linha | null)?.nome ?? null, rota: v.rota ?? (data as Linha | null)?.rota ?? null, escritorio: (data as Linha | null)?.escritorio ?? null, equipe: (data as Linha | null)?.equipe ?? null, supervisor: sup?.nome ?? null };
  }

  /** Cadastro de cliente feito pelo painel em nome de um vendedor (da equipe de quem cadastra). */
  async cadastrarClientePeloPainel(u: UsuarioPainel, corpo: Linha) {
    const v = await this.vendedorDoPainel(u, corpo?.cod_vendedor);
    return this.cadastrarCliente({ email: u.email, codVendedor: v.cod_vendedor, rota: v.rota }, corpo);
  }

  /** Dados do vendedor para o formulario do painel (escritorio, equipe, rota, supervisor). */
  async dadosVendedorDoPainel(u: UsuarioPainel, cod: unknown) {
    const v = await this.vendedorDoPainel(u, cod);
    return this.dadosVendedor({ email: u.email, codVendedor: v.cod_vendedor, rota: v.rota });
  }

  /** Vendedores que quem cria pelo painel pode escolher (a propria equipe; admin e gerente geral, todos). */
  async vendedoresDoPainel(u: UsuarioPainel) {
    this.exigirSupervisor(u);
    const { data, error } = await this.sb.from('vendedores').select('cod_vendedor, nome, rota').not('rota', 'is', null).order('nome');
    if (error) throw error;
    return ((data ?? []) as Array<{ cod_vendedor: string; nome: string | null; rota: string }>).filter((v) => !u.escopo || u.escopo.vendedores.includes(normCod(v.cod_vendedor)));
  }

  private async vendedorDoPainel(u: UsuarioPainel, cod: unknown): Promise<{ cod_vendedor: string; rota: string | null }> {
    this.exigirSupervisor(u);
    const codigo = normCod(String(cod ?? ''));
    if (!/^\d{1,10}$/.test(codigo)) throw new UnprocessableEntityException('Escolha o vendedor');
    exigirVendedor(u.escopo, codigo);
    const { data, error } = await this.sb.from('vendedores').select('cod_vendedor, rota').eq('cod_vendedor', codigo).maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Vendedor nao encontrado');
    return data as { cod_vendedor: string; rota: string | null };
  }

  private async supervisorDe(escritorio: string | null | undefined, equipe: string | null | undefined): Promise<{ cod_supervisor: string; nome: string | null } | null> {
    if (!escritorio || !equipe) return null;
    const { data, error } = await this.sb.from('supervisores').select('cod_supervisor, nome').eq('escritorio', escritorio).eq('equipe', equipe).limit(1);
    if (error) throw error;
    return ((data ?? [])[0] as { cod_supervisor: string; nome: string | null } | undefined) ?? null;
  }

  /** Cadastro de cliente feito pelo vendedor. Pessoa fisica devolve o envio do comprovante direto ao Storage. */
  async cadastrarCliente(v: VendedorLogado, corpo: Linha) {
    const { dados, documento } = validarCadastroCliente(corpo ?? {});
    await this.exigirDocumentoNovo(documento);

    const ven = await this.dadosVendedor(v);
    const supEmail = await this.emailSupervisor(ven.escritorio as string | null, ven.equipe as string | null);
    Object.assign(dados, { escritorio: ven.escritorio, equipe: ven.equipe, rota: ven.rota, vendedor_nome: ven.nome });

    const id = randomUUID();
    const caminho = dados.tem_comprovante ? `${v.codVendedor}/${id}.jpg` : null;
    const { error } = await this.sb.from('solicitacoes').insert({
      id,
      tipo: 'cadastro_cliente',
      dados,
      documento,
      cod_vendedor: v.codVendedor,
      vendedor_nome: ven.nome,
      supervisor_nome: ven.supervisor,
      supervisor_email: supEmail,
      criado_por: v.equipe ? `${v.email} (equipe)` : v.email,
      comprovante_caminho: caminho,
    });
    if (error) throw error;

    let upload: { caminho: string; token: string; signed_url: string } | null = null;
    if (caminho) {
      const { data, error: e2 } = await this.sb.storage.from(BUCKET_ANEXOS).createSignedUploadUrl(caminho, { upsert: true });
      if (e2 || !data) throw new Error(`url de envio do comprovante: ${e2?.message ?? 'sem resposta'}`);
      upload = { caminho, token: data.token, signed_url: data.signedUrl };
    }
    return { id, upload };
  }

  private async emailSupervisor(escritorio: string | null, equipe: string | null): Promise<string | null> {
    const sup = await this.supervisorDe(escritorio, equipe);
    if (!sup) return null;
    const { data, error } = await this.sb.from('usuarios_painel').select('email').eq('cod_sap', sup.cod_supervisor).eq('ativo', true).limit(1);
    if (error) throw error;
    return ((data ?? [])[0] as { email: string } | undefined)?.email ?? null;
  }

  /** CPF/CNPJ que ja e cliente ou ja tem cadastro solicitado nao pode ser pedido de novo. */
  private async exigirDocumentoNovo(documento: string) {
    const mascarado = documento.length === 11
      ? documento.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
      : documento.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    const { data, error } = await this.sb.from('clientes').select('cod_cliente').in('cnpjcpf', [documento, mascarado]).limit(1);
    if (error) throw error;
    if (data?.length) throw new ConflictException(`Este documento ja e o cliente ${(data[0] as { cod_cliente: string }).cod_cliente}`);
    const { data: s, error: e2 } = await this.sb.from('solicitacoes').select('id').eq('tipo', 'cadastro_cliente').eq('documento', documento).neq('status', 'erro').limit(1);
    if (e2) throw e2;
    if (s?.length) throw new ConflictException('Ja existe uma solicitacao de cadastro para este documento');
  }

  /** Cliente que o supervisor quer alterar/excluir: confere a equipe e devolve os dados para o formulario. */
  async clienteDoSupervisor(u: UsuarioPainel, cod: string): Promise<Linha> {
    this.exigirSupervisor(u);
    const codigo = soDigitos(cod).replace(/^0+/, '');
    if (!codigo) throw new UnprocessableEntityException('Codigo invalido');
    const { data, error } = await this.sb.from('clientes').select('cod_cliente, razao_social, nome_fantasia, limite_total').eq('cod_cliente', codigo).maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Cliente nao encontrado');
    const { rota, vendedor, cod_vendedor } = await this.rotaEVendedor(codigo);
    if (!rotaNoEscopo(u.escopo, rota)) throw new ForbiddenException('Este cliente nao e da sua equipe');
    return { ...(data as Linha), rota, vendedor, cod_vendedor };
  }

  private async rotaEVendedor(cod: string): Promise<{ rota: string | null; vendedor: string | null; cod_vendedor: string | null }> {
    const { data: rc, error } = await this.sb.from('rota_clientes').select('rota').eq('cod_cliente', cod).limit(1);
    if (error) throw error;
    const rota = ((rc ?? [])[0] as { rota: string } | undefined)?.rota ?? null;
    if (!rota) return { rota: null, vendedor: null, cod_vendedor: null };
    const { data: v, error: e2 } = await this.sb.from('vendedores').select('nome, cod_vendedor').eq('rota', rota).limit(1);
    if (e2) throw e2;
    const ven = (v ?? [])[0] as { nome: string | null; cod_vendedor: string } | undefined;
    return { rota, vendedor: ven?.nome ?? null, cod_vendedor: ven?.cod_vendedor ?? null };
  }

  private exigirSupervisor(u: UsuarioPainel) {
    if (!PAPEIS_SUPERVISOR.includes(u.papel)) throw new ForbiddenException('Seu perfil nao cria esta solicitacao');
  }

  async criarDoSupervisor(u: UsuarioPainel, tipo: string, corpo: Linha) {
    this.exigirSupervisor(u);
    if (!(TIPOS_SUPERVISOR as readonly string[]).includes(tipo)) throw new NotFoundException('Tipo de solicitacao invalido');
    const { dados, cod_cliente } = validarSolicitacaoSupervisor(tipo as TipoSupervisor, corpo ?? {});
    const cliente = await this.clienteDoSupervisor(u, cod_cliente);
    Object.assign(dados, { razao_social: cliente.razao_social, nome_fantasia: cliente.nome_fantasia, rota: cliente.rota, vendedor_nome: cliente.vendedor, supervisor_nome: u.nome, supervisor_email: u.email });
    const { data, error } = await this.sb
      .from('solicitacoes')
      .insert({ tipo, dados, cod_cliente, cod_vendedor: cliente.cod_vendedor, vendedor_nome: cliente.vendedor, supervisor_nome: u.nome, supervisor_email: u.email, criado_por: u.email })
      .select('id')
      .single();
    if (error) throw error;
    return { id: (data as { id: string }).id };
  }

  /** Painel: lista (com filtro por tipo/busca). Quem so ve a propria equipe enxerga as suas solicitacoes. */
  async listar(escopo: Escopo | null, f: { tipo?: string; busca?: string; pagina?: string }) {
    const pagina = Math.max(1, Math.trunc(Number(f.pagina)) || 1);
    let q = this.sb.from('solicitacoes').select('id, tipo, status, documento, cod_cliente, cod_vendedor, vendedor_nome, supervisor_nome, dados, created_at', { count: 'exact' });
    if (f.tipo && TIPOS.includes(f.tipo)) q = q.eq('tipo', f.tipo);
    if (escopo) q = q.in('cod_vendedor', escopo.vendedores.length ? escopo.vendedores : ['-']);
    const busca = (f.busca ?? '').trim().replace(/[%,()]/g, ' ');
    if (busca) q = q.or(`documento.ilike.%${soDigitos(busca) || busca}%,cod_cliente.ilike.%${busca}%,vendedor_nome.ilike.%${busca}%,dados->>razao_social.ilike.%${busca}%,dados->>nome_fantasia.ilike.%${busca}%`);
    const { data, count, error } = await q.order('created_at', { ascending: false }).range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
    if (error) throw error;
    return { itens: data ?? [], total: count ?? 0, pagina, por_pagina: POR_PAGINA };
  }

  async detalhe(escopo: Escopo | null, id: string) {
    const { data, error } = await this.sb.from('solicitacoes').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    const s = data as Linha | null;
    if (!s || (escopo && !escopo.vendedores.includes(String(s.cod_vendedor ?? '')))) throw new NotFoundException('Solicitacao nao encontrada');
    let comprovante_url: string | null = null;
    if (s.comprovante_caminho) {
      const { data: u } = await this.sb.storage.from(BUCKET_ANEXOS).createSignedUrl(String(s.comprovante_caminho), 600);
      comprovante_url = u?.signedUrl ?? null;
    }
    return { ...s, comprovante_url };
  }
}
