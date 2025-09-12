import { Module } from '@nestjs/common';
import { MatchGateway } from './match.gateway';
import { RealtimeEmitter } from './realtime.emitter';
import { WsBroadcaster } from './ws-broadcaster.service';
import { SocketAuthGuard } from './socket.auth.guard';
import { RedisModule } from '@adapters/redis/redis.module'; // adapte le chemin si besoin
import { MatchStateModule } from '@app/match-state.module'; // pour disposer de SeqService (ou importe le module qui l'exporte)

@Module({
  imports: [
    RedisModule,
    MatchStateModule, // assure l'export de SeqService ou le module qui le fournit
  ],
  providers: [
    MatchGateway,
    RealtimeEmitter,
    WsBroadcaster,
    SocketAuthGuard,
  ],
  exports: [
    RealtimeEmitter,
  ],
})
export class WsModule {}
