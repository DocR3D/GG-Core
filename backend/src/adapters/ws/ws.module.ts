// src/adapters/ws/ws.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '@adapters/redis/redis.module';
import { MatchStateModule } from '@app/match-state.module';
import { MatchGateway } from './match.gateway';
import { RealtimeEmitter } from './ws-emitter.internal';
import { WsBroadcaster } from './broadcaster.service';
import { SocketAuthGuard } from './socket.auth.guard';
import { AuthModule } from '@adapters/http/auth/auth.module';

@Module({
  imports: [
    RedisModule,
    forwardRef(() => MatchStateModule), // ✅ index [1] = StateModule défini
    AuthModule, // role of a socket from the session cookie (React front)
  ],
  providers: [MatchGateway, RealtimeEmitter, WsBroadcaster, SocketAuthGuard],
  exports:   [RealtimeEmitter, WsBroadcaster], // ⬅️ exporte aussi WsBroadcaster si utilisé ailleurs
})
export class WsModule {}
