// src/adapters/http/servers/servers.module.ts
import { Module } from '@nestjs/common';
import { PostgresRepositoriesModule } from '@adapters/postgres/postgres-repositories.module';
import { WsModule } from '@adapters/ws/ws.module';
import { RedisModule } from '@adapters/redis/redis.module';
import { ServersController } from './servers.controller';
import { ServerProbeService } from '@app/servers/server-probe.service';
import { AgentClientService } from '@app/servers/agent-client.service';

@Module({
  imports: [PostgresRepositoriesModule, WsModule, RedisModule],
  controllers: [ServersController],
  providers: [ServerProbeService, AgentClientService],
  exports: [ServerProbeService, AgentClientService],
})
export class ServersModule {}
