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
import { Escopo, resolverEscopo } from './escopo';
import { Permissao, permissoesEfetivas } from './permissoes';

export type PapelPainel = 'admin' | 'aprovador' | 'consulta' | 'supervisor' | 'gerente' | 'gerente_geral';

/** Papeis da hierarquia comercial: aprovam e criam pedido (como o aprovador), cada um dentro do seu escopo. */
const HIERARQUIA: PapelPainel[] = ['supervisor', 'gerente', 'gerente_geral'];

export interface UsuarioPainel {
  email: string;
  nome: string | null;
  papel: PapelPainel;
  /** Codigo SAP (supervisor/gerente). */
  cod_sap: string | null;
  /** null = sem restricao; senao so os vendedores/rotas da equipe. */
  escopo: Escopo | null;
  /** Acoes liberadas (padrao do papel + ajustes do admin). */
  permissoes: Permissao[];
}

/** Papeis que podem usar a rota (admin sempre pode). Sem o decorator: qualquer usuario ativo do painel. */
export const Papeis = (...papeis: PapelPainel[]) => SetMetadata('papeis_painel', papeis);

/** A rota exige esta permissao (admin sempre pode). */
export const Permissoes = (permissao: Permissao) => SetMetadata('permissao_painel', permissao);

/** So estes papeis (e admin) usam a rota: tira a hierarquia de telas internas (monitor, sincronizacao). */
export const SoPapeis = (...papeis: PapelPainel[]) => SetMetadata('papeis_exatos', papeis);

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
      .select('email, nome, papel, cod_sap, permissoes')
      .eq('email', email)
      .eq('ativo', true)
      .maybeSingle();
    if (e2) throw e2;
    if (!u) throw new ForbiddenException('Usuario sem acesso ao painel');

    const permitidos = this.reflector.get<PapelPainel[] | undefined>('papeis_painel', ctx.getHandler());
    // quem aprova (aprovador) tambem e liberado para a hierarquia; cada servico confere o escopo
    const liberado = (p: PapelPainel) => permitidos!.includes(p) || (permitidos!.includes('aprovador') && HIERARQUIA.includes(p));
    if (permitidos?.length && u.papel !== 'admin' && !liberado(u.papel)) {
      throw new ForbiddenException('Seu perfil nao permite esta acao');
    }
    const exatos = this.reflector.get<PapelPainel[] | undefined>('papeis_exatos', ctx.getHandler());
    if (exatos?.length && u.papel !== 'admin' && !exatos.includes(u.papel)) {
      throw new ForbiddenException('Seu perfil nao permite esta acao');
    }

    const permissoes = permissoesEfetivas(u.papel, u.permissoes);
    const exigida = this.reflector.get<Permissao | undefined>('permissao_painel', ctx.getHandler());
    if (exigida && !permissoes.includes(exigida)) throw new ForbiddenException('Seu perfil nao tem permissao para esta acao');

    const escopo = await resolverEscopo(this.sb, u.papel, u.cod_sap ?? null);
    const { permissoes: _ajustes, ...resto } = u as typeof u & { permissoes?: unknown };
    req.usuarioPainel = { ...resto, escopo, permissoes } as UsuarioPainel;
    return true;
  }
}
