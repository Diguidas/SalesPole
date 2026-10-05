import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './config/env';
import { SupabaseModule } from './supabase/supabase.module';
import { SapModule } from './sap/sap.module';
import { AuthModule } from './auth/auth.module';
import { SyncModule } from './sync/sync.module';
import { PedidosModule } from './pedidos/pedidos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    SupabaseModule,
    SapModule,
    AuthModule,
    SyncModule,
    PedidosModule,
  ],
})
export class AppModule {}
