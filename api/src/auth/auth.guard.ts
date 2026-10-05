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
import { VendedoresService } from './vendedores.service';

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

    const vendedor = await this.vendedores.porEmail(email);
    if (!vendedor) throw new ForbiddenException('Usuario sem vinculo com vendedor');

    req.vendedor = vendedor;
    return true;
  }
}
