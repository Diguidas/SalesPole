import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase/supabase.module';
import { Escopo, resolverEscopo } from '../painel/escopo';
import { permissoesEfetivas } from '../painel/permissoes';
import { normCod, VendedoresService } from './vendedores.service';

/** Papeis que podem usar o app "como" um vendedor da equipe. */
const PAPEIS_EQUIPE = ['admin', 'supervisor', 'gerente', 'gerente_geral'];

/**
 * Valida o token do Supabase Auth (login Microsoft/Azure) e carrega o vendedor
 * vinculado ao e-mail. O app NUNCA informa codvendedor: ele vem daqui.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly vendedores: VendedoresService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] ?? '')?.[1];
    if (!token) throw new UnauthorizedException('Token ausente');

    const { data, error } = await this.sb.auth.getUser(token);
    const email = data?.user?.email;
    if (error || !email) throw new UnauthorizedException('Token invalido');

    // modo equipe: o app manda X-Vendedor com o vendedor escolhido; vale so para quem a hierarquia permite
    const alvo = String(req.headers['x-vendedor'] ?? '').trim();
    if (alvo) {
      req.vendedor = await this.comoVendedor(email, alvo);
      return true;
    }

    const vendedor = await this.vendedores.porEmail(email);
    if (!vendedor) throw new ForbiddenException('Usuario sem vinculo com vendedor');

    req.vendedor = vendedor;
    return true;
  }

  /** Supervisor/gerente/admin operando o app como um vendedor: o vendedor tem que estar na equipe dele. */
  private async comoVendedor(emailLogado: string, alvoRaw: string) {
    if (!/^\d{1,10}$/.test(alvoRaw)) throw new ForbiddenException('Vendedor invalido');
    const alvo = normCod(alvoRaw);
    const e = emailLogado.toLowerCase();

    const { data: u, error } = await this.sb.from('usuarios_painel').select('papel, cod_sap, permissoes').eq('email', e).eq('ativo', true).maybeSingle();
    if (error) throw error;
    if (!u || !PAPEIS_EQUIPE.includes(u.papel)) throw new ForbiddenException('Seu perfil nao permite usar o app como vendedor');

    const escopo: Escopo | null = await resolverEscopo(this.sb, u.papel, u.cod_sap ?? null);
    if (escopo && !escopo.vendedores.includes(alvo)) throw new ForbiddenException('Este vendedor nao e da sua equipe');

    const { data: v, error: e2 } = await this.sb.from('vendedores').select('rota').eq('cod_vendedor', alvo).maybeSingle();
    if (e2) throw e2;
    if (!v) throw new ForbiddenException('Vendedor nao encontrado');
    return { email: e, codVendedor: alvo, rota: v.rota ?? null, equipe: { papel: u.papel, permissoes: permissoesEfetivas(u.papel, u.permissoes) } };
  }
}
