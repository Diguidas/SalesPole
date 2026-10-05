import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncCron } from './sync.cron';
import { SyncService } from './sync.service';

@Module({
  controllers: [SyncController],
  providers: [SyncService, SyncCron],
  exports: [SyncService],
})
export class SyncModule {}
