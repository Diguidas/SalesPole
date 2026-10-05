import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { VendedorLogado as TVendedorLogado } from './vendedores.service';

/** Injeta o vendedor autenticado (preenchido pelo SupabaseAuthGuard). */
export const VendedorLogado = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TVendedorLogado =>
    ctx.switchToHttp().getRequest().vendedor,
);
