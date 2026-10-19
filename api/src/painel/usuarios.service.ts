import { ConflictException, Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod, VendedoresService } from '../auth/vendedores.service';
import { SUPABASE } from '../supabase/supabase.module';
import { UsuarioPainel } from './painel.guard';

const PAPEIS = ['admin', 'aprovador', 'consulta'];
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
    const { data, error } = await this.sb.from('usuarios_painel').select('email, nome, papel, ativo, created_at').order('email');
    if (error) throw error;
    return data ?? [];
  }

  async gravarPainel(atual: UsuarioPainel, b: Record<string, unknown>) {
    const e = email(b.email);
    const papel = String(b.papel ?? '');
    if (!PAPEIS.includes(papel)) throw erro('Papel invalido');
    const nome = String(b.nome ?? '').trim().slice(0, 80) || null;
    const ativo = b.ativo == null ? true : b.ativo === true;
    const senha = typeof b.senha === 'string' && b.senha ? b.senha : null;

    // nao deixa o painel sem nenhum admin ativo (nem o admin se trancar para fora)
    if (e === atual.email && (!ativo || papel !== 'admin')) throw new ConflictException('Voce nao pode remover o seu proprio acesso de administrador');
    if (!ativo || papel !== 'admin') await this.garantirOutroAdmin(e);

    const login = senha ? await this.definirSenha(e, senha) : null; // senha invalida falha antes de gravar o acesso
    const { error } = await this.sb.from('usuarios_painel').upsert({ email: e, nome, papel, ativo }, { onConflict: 'email' });
    if (error) throw error;
    if (login) this.logger.log(`Login ${login} para ${e} (painel) por ${atual.email}`);
    return { email: e, nome, papel, ativo, login };
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
