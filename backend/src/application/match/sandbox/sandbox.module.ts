// src/application/match/sandbox/sandbox.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '@adapters/redis/redis.module';
import { MatchStateModule } from '@app/match-state.module';
import { WsModule } from '@adapters/ws/ws.module';
import { CommandsModule } from '@app/commands.module';
import { SubscribersModule } from '@app/subscribers/subscribers.module';
import { RoundBackupService } from '../backup/round-backup.service';
import { SandboxService } from './sandbox.service';

@Module({
  imports: [
    RedisModule,
    MatchStateModule,
    WsModule,
    forwardRef(() => CommandsModule),
    forwardRef(() => SubscribersModule),
  ],
  providers: [
    RoundBackupService,
    SandboxService,
  ],
  exports: [
    RoundBackupService,
    SandboxService,
  ],
})
export class SandboxModule {}
