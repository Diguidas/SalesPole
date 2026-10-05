import { Global, Module } from '@nestjs/common';
import { SapClient } from './sap.client';

@Global()
@Module({
  providers: [SapClient],
  exports: [SapClient],
})
export class SapModule {}
