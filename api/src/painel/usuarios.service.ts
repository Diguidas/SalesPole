import { ConflictException, Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod, VendedoresService } from '../auth/vendedores.service';
import { SUPABASE } from '../supabase/supabase.module';
import { UsuarioPainel } from './painel.guard';
import { invalidarEscopo } from './escopo';
import { ajustesDe, permissoesEfetivas } from './permissoes';
import { PapelPainel } from './painel.guard';

const PAPEIS = ['admin', 'aprovador', 'consulta', 'supervisor', 'gerente', 'gerente_geral', 'vendedor'];
/** Papeis ligados a um codigo do SAP (supervisor/gerente: a equipe vem da ZSDT087). */
const PAPEIS_SAP = ['supervisor', 'gerente', 'vendedor'];
const SENHA_MIN = 8;

const erro = (m: string) => new UnprocessableEntityException(m);

function email(v: unknown): string {
  const e = String(v ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(e) || e.length > 120) throw erro('E-mail invalido');
  return e;
}

/** Quem entra no painel (usuarios_painel) e quem usa o app de vendas (usuarios_vendedor), com a conta de login do Supabase. */
@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly vendedores: VendedoresService,
  ) {}

  // ---------------- login (Supabase Auth) ----------------

  /** Cria a conta de login (ja confirmada, nenhum e-mail e enviado) ou troca a senha se ela ja existe. */
  private async definirSenha(emailUsuario: string, senha: string): Promise<'criada' | 'atualizada'> {
    if (senha.length < SENHA_MIN) throw erro(`A senha precisa ter ao menos ${SENHA_MIN} caracteres`);
    const criado = await this.sb.auth.admin.createUser({ email: emailUsuario, password: senha, email_confirm: true });
    if (!criado.error) return 'criada';
    if (!/already|registered|exists/i.test(criado.error.message)) throw new Error(`Nao foi possivel criar o login: ${criado.error.message}`);

    let id: string | undefined;
    for (let pagina = 1; !id && pagina <= 50; pagina++) {
      const lista = await this.sb.auth.admin.listUsers({ page: pagina, perPage: 200 });
      if (lista.error) throw lista.error;
      id = lista.data.users.find((u) => u.email?.toLowerCase() === emailUsuario)?.id;
      if (lista.data.users.length < 200) break;
    }
    if (!id) throw new Error('A conta ja existe mas nao foi encontrada');
    const r = await this.sb.auth.admin.updateUserById(id, { password: senha, email_confirm: true });
    if (r.error) throw new Error(`Nao foi possivel trocar a senha: ${r.error.message}`);
    return 'atualizada';
  }

  // ---------------- usuarios do painel ----------------

  async listarPainel() {
    const { data, error } = await this.sb.from('usuarios_painel').select('email, nome, papel, cod_sap, permissoes, ativo, created_at').order('email');
    if (error) throw error;
    // devolve as permissoes ja resolvidas (padrao do papel + ajustes) para a tela marcar as caixas
    return (data ?? []).map((u: { papel: PapelPainel; permissoes: unknown }) => ({ ...u, permissoes: permissoesEfetivas(u.papel, u.permissoes) }));
  }

  /**
   * Supervisores e gerentes que vieram do SAP (ZSDT087), com as equipes, o numero de vendedores e se ja tem acesso ao painel.
   * Base da tela de usuarios: o admin escolhe um deles e cria o login.
   */
  async listarSupervisoresSap() {
    const [sup, ven, acessos] = await Promise.all([
      this.sb.from('supervisores').select('cod_supervisor, nome, cod_gerente, gerente_nome, escritorio, equipe').limit(5000),
      this.sb.from('vendedores').select('escritorio, equipe').not('escritorio', 'is', null).limit(10000),
      this.sb.from('usuarios_painel').select('email, papel, cod_sap, ativo').not('cod_sap', 'is', null),
    ]);
    for (const r of [sup, ven, acessos]) if (r.error) throw r.error;
    const linhas = (sup.data ?? []) as Array<{ cod_supervisor: string; nome: string | null; cod_gerente: string | null; gerente_nome: string | null; escritorio: string; equipe: string }>;

    const porEquipe = new Map<string, number>();
    for (const v of (ven.data ?? []) as Array<{ escritorio: string; equipe: string }>) {
      const k = `${v.escritorio}|${v.equipe}`;
      porEquipe.set(k, (porEquipe.get(k) ?? 0) + 1);
    }
    // acesso pelo codigo SAP, qualquer que seja o papel (um supervisor promovido a admin continua aparecendo como tendo acesso)
    const acesso = (_tipo: string, cod: string) => {
      const a = ((acessos.data ?? []) as Array<{ email: string; papel: string; cod_sap: string; ativo: boolean }>).find((x) => normCod(x.cod_sap) === cod);
      return a ? { email: a.email, ativo: a.ativo, papel: a.papel } : null;
    };

    const supervisores = new Map<string, { cod: string; nome: string | null; gerente: string | null; equipes: Array<{ escritorio: string; equipe: string }> }>();
    const gerentes = new Map<string, { cod: string; nome: string | null; supervisores: Set<string>; equipes: Set<string> }>();
    for (const l of linhas) {
      const s = supervisores.get(l.cod_supervisor) ?? { cod: l.cod_supervisor, nome: l.nome, gerente: l.gerente_nome, equipes: [] };
      s.equipes.push({ escritorio: l.escritorio, equipe: l.equipe });
      supervisores.set(l.cod_supervisor, s);
      if (l.cod_gerente) {
        const g = gerentes.get(l.cod_gerente) ?? { cod: l.cod_gerente, nome: l.gerente_nome, supervisores: new Set<string>(), equipes: new Set<string>() };
        g.supervisores.add(l.cod_supervisor);
        g.equipes.add(`${l.escritorio}|${l.equipe}`);
        gerentes.set(l.cod_gerente, g);
      }
    }
    const soma = (pares: string[]) => pares.reduce((a, k) => a + (porEquipe.get(k) ?? 0), 0);
    const nomeOrd = (a: { nome: string | null }, b: { nome: string | null }) => String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR');
    return {
      supervisores: [...supervisores.values()]
        .map((s) => ({ cod: s.cod, nome: s.nome, gerente: s.gerente, equipes: s.equipes, vendedores: soma(s.equipes.map((e) => `${e.escritorio}|${e.equipe}`)), acesso: acesso('supervisor', s.cod) }))
        .sort(nomeOrd),
      gerentes: [...gerentes.values()]
        .map((g) => ({ cod: g.cod, nome: g.nome, supervisores: g.supervisores.size, vendedores: soma([...g.equipes]), acesso: acesso('gerente', g.cod) }))
        .sort(nomeOrd),
    };
  }

  /**
   * Muda so o papel de quem ja tem acesso (ex.: promover um gerente a gerente geral ou a administrador), mantendo nome,
   * codigo SAP, situacao e as permissoes ajustadas. Os mesmos cuidados do cadastro: sempre sobra um admin ativo.
   */
  async mudarPapel(atual: UsuarioPainel, emailAlvo: string, papelNovo: string) {
    const e = email(emailAlvo);
    if (!PAPEIS.includes(papelNovo)) throw erro('Papel invalido');
    const { data: u, error } = await this.sb.from('usuarios_painel').select('email, nome, papel, cod_sap, ativo').eq('email', e).maybeSingle();
    if (error) throw error;
    if (!u) throw erro('Usuario nao encontrado');
    if (PAPEIS_SAP.includes(papelNovo) && !u.cod_sap) throw erro('Supervisor, gerente e vendedor precisam do codigo SAP: edite o usuario e informe');
    if (e === atual.email && papelNovo !== 'admin') throw new ConflictException('Voce nao pode remover o seu proprio acesso de administrador');
    if (papelNovo !== 'admin') await this.garantirOutroAdmin(e);
    const { error: e2 } = await this.sb.from('usuarios_painel').update({ papel: papelNovo }).eq('email', e);
    if (e2) throw e2;
    invalidarEscopo();
    this.logger.log(`Papel de ${e}: ${u.papel} -> ${papelNovo} por ${atual.email}`);
    return { email: e, papel: papelNovo };
  }

  async gravarPainel(atual: UsuarioPainel, b: Record<string, unknown>) {
    const e = email(b.email);
    const papel = String(b.papel ?? '');
    if (!PAPEIS.includes(papel)) throw erro('Papel invalido');
    const nome = String(b.nome ?? '').trim().slice(0, 80) || null;
    const ativo = b.ativo == null ? true : b.ativo === true;
    const senha = typeof b.senha === 'string' && b.senha ? b.senha : null;
    // codigo SAP: obrigatorio para supervisor/gerente; nos demais papeis (ex.: um supervisor promovido a admin) fica guardado se informado
    let cod_sap: string | null = null;
    const codInformado = String(b.cod_sap ?? '').trim();
    if (PAPEIS_SAP.includes(papel) || codInformado) {
      if (!/^\d{1,10}$/.test(codInformado)) throw erro('Informe o codigo SAP (apenas numeros) do supervisor, gerente ou vendedor');
      cod_sap = normCod(codInformado);
    }
    const marcadas = b.permissoes && typeof b.permissoes === 'object' && !Array.isArray(b.permissoes) ? b.permissoes : Array.isArray(b.permissoes) ? Object.fromEntries((b.permissoes as unknown[]).map((k) => [String(k), true])) : null;

    // nao deixa o painel sem nenhum admin ativo (nem o admin se trancar para fora)
    if (e === atual.email && (!ativo || papel !== 'admin')) throw new ConflictException('Voce nao pode remover o seu proprio acesso de administrador');
    if (!ativo || papel !== 'admin') await this.garantirOutroAdmin(e);

    const login = senha ? await this.definirSenha(e, senha) : null; // senha invalida falha antes de gravar o acesso
    const { error } = await this.sb.from('usuarios_painel').upsert({ email: e, nome, papel, ativo, cod_sap, permissoes: ajustesDe(papel as PapelPainel, marcadas ?? Object.fromEntries(permissoesEfetivas(papel as PapelPainel, {}).map((k) => [k, true]))) }, { onConflict: 'email' });
    if (error) throw error;
    invalidarEscopo();
    if (login) this.logger.log(`Login ${login} para ${e} (painel) por ${atual.email}`);
    return { email: e, nome, papel, cod_sap, ativo, login };
  }

  private async garantirOutroAdmin(emailAlvo: string) {
    const { data, error } = await this.sb.from('usuarios_painel').select('email').eq('papel', 'admin').eq('ativo', true);
    if (error) throw error;
    const outros = (data ?? []).filter((u: { email: string }) => u.email !== emailAlvo);
    if (outros.length === 0) throw new ConflictException('O painel precisa ter ao menos um administrador ativo');
  }

  // ---------------- usuarios do app (vendedores) ----------------

  async listarVendedores() {
    const { data, error } = await this.sb.from('usuarios_vendedor').select('email, cod_vendedor, ativo, created_at').order('email');
    if (error) throw error;
    const linhas = (data ?? []) as Array<{ email: string; cod_vendedor: string; ativo: boolean; created_at: string }>;
    if (!linhas.length) return [];
    const { data: ven, error: e2 } = await this.sb.from('vendedores').select('cod_vendedor, nome').in('cod_vendedor', [...new Set(linhas.map((l) => normCod(l.cod_vendedor)))]);
    if (e2) throw e2;
    const nome = new Map((ven ?? []).map((v: { cod_vendedor: string; nome: string | null }) => [v.cod_vendedor, v.nome]));
    return linhas.map((l) => ({ ...l, vendedor: nome.get(normCod(l.cod_vendedor)) ?? null }));
  }

  async gravarVendedor(atual: UsuarioPainel, b: Record<string, unknown>) {
    const e = email(b.email);
    const cod = String(b.cod_vendedor ?? '').trim();
    if (!/^\d{1,10}$/.test(cod)) throw erro('Codigo do vendedor invalido (apenas numeros)');
    const cod_vendedor = normCod(cod);
    const ativo = b.ativo == null ? true : b.ativo === true;
    const senha = typeof b.senha === 'string' && b.senha ? b.senha : null;

    const login = senha ? await this.definirSenha(e, senha) : null;
    const { error } = await this.sb.from('usuarios_vendedor').upsert({ email: e, cod_vendedor, ativo }, { onConflict: 'email' });
    if (error) throw error;
    this.vendedores.invalidar(e); // a API guarda o vinculo em cache por 1 minuto
    if (login) this.logger.log(`Login ${login} para ${e} (vendedor ${cod_vendedor}) por ${atual.email}`);
    return { email: e, cod_vendedor, ativo, login };
  }
}
