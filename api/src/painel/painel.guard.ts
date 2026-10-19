import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase/supabase.module';

export type PapelPainel = 'admin' | 'aprovador' | 'consulta';

export interface UsuarioPainel {
  email: string;
  nome: string | null;
  papel: PapelPainel;
}

/** Papeis que podem usar a rota (admin sempre pode). Sem o decorator: qualquer usuario ativo do painel. */
export const Papeis = (...papeis: PapelPainel[]) => SetMetadata('papeis_painel', papeis);

/** Valida o token do Supabase Auth (login Microsoft) e carrega o usuario do painel pelo e-mail. */
@Injectable()
export class PainelGuard implements CanActivate {
  constructor(
    @Inject(SUPABASE) private readonly sb: SupabaseClient,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] ?? '')?.[1];
    if (!token) throw new UnauthorizedException('Token ausente');

    const { data, error } = await this.sb.auth.getUser(token);
    const email = data?.user?.email?.toLowerCase();
    if (error || !email) throw new UnauthorizedException('Token invalido');

    const { data: u, error: e2 } = await this.sb
      .from('usuarios_painel')
      .select('email, nome, papel')
      .eq('email', email)
      .eq('ativo', true)
      .maybeSingle();
    if (e2) throw e2;
    if (!u) throw new ForbiddenException('Usuario sem acesso ao painel');

    const permitidos = this.reflector.get<PapelPainel[] | undefined>('papeis_painel', ctx.getHandler());
    if (permitidos?.length && u.papel !== 'admin' && !permitidos.includes(u.papel)) {
      throw new ForbiddenException('Seu perfil nao permite esta acao');
    }

    req.usuarioPainel = u as UsuarioPainel;
    return true;
  }
}
