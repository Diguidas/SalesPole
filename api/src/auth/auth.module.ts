import { Global, Module } from '@nestjs/common';
import { SupabaseAuthGuard } from './auth.guard';
import { VendedoresService } from './vendedores.service';

@Global()
@Module({
  providers: [VendedoresService, SupabaseAuthGuard],
  exports: [VendedoresService, SupabaseAuthGuard],
})
export class AuthModule {}
