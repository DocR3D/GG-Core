// src/application/broadcast/buytime-broadcast.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '@adapters/redis/redis.module';
import { MatchStateModule } from '@app/match-state.module';
import { CommandsModule } from '@app/commands.module';
import { WsModule } from '@adapters/ws/ws.module';
import { DatabaseModule } from '@adapters/database/database.module';
import { BuytimeBroadcastService } from './buytime-broadcast.service';

@Module({
  imports: [
    RedisModule,
    MatchStateModule,
    forwardRef(() => CommandsModule),
    WsModule,
    DatabaseModule,
  ],
  providers: [BuytimeBroadcastService],
  exports: [BuytimeBroadcastService],
})
export class BuytimeBroadcastModule {}
