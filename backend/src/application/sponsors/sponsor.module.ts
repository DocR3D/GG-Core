// src/application/sponsors/sponsor.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '@adapters/database/database.module';
import { WsModule } from '@adapters/ws/ws.module';
import { CommandsModule } from '@app/commands.module';
import { MatchStateModule } from '@app/match-state.module';
import { RedisModule } from '@adapters/redis/redis.module';
import { SponsorService } from './sponsor.service';
import { SponsorChatAnnouncerService } from './sponsor-chat-announcer.service';

@Module({
  imports: [
    DatabaseModule,
    WsModule,
    forwardRef(() => CommandsModule),
    MatchStateModule,
    RedisModule,
  ],
  providers: [SponsorService, SponsorChatAnnouncerService],
  exports: [SponsorService, SponsorChatAnnouncerService],
})
export class SponsorModule {}
