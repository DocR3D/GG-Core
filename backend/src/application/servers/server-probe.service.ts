// src/application/servers/server-probe.service.ts
//
// Probe de connectivité des serveurs CS2 via l'agent Go (GET /health).
// Remplace l'ancienne connexion RCON directe depuis le backend.

import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { ServerRepository } from '@adapters/postgres/server.repository';
import { RealtimeEmitter } from '@adapters/ws/ws-emitter.internal';
import { AgentClientService } from './agent-client.service';
import type { ServerRow, ServerStatus } from '@domain/server.types';

const PROBE_INTERVAL_MS = 20_000;  // probe toutes les 20 s
const PROBE_REDIS_TTL_S = 60;      // résultat expiré si pas de probe pendant 60 s

/** Clé Redis où le résultat du probe est mis en cache */
export const probeKey = (serverId: string) => `ggbot:server:${serverId}:probe`;

export type ProbeResult = {
  status: ServerStatus;
  currentMatchId: string | null;
  probedAt: number;
};

@Injectable()
export class ServerProbeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ServerProbeService.name);
  private timer?: NodeJS.Timeout;

  /** Dernier statut connu par server_id (pour détecter les changements) */
  private lastStatus = new Map<string, ServerStatus>();

  constructor(
    private readonly serverRepo: ServerRepository,
    private readonly agentClient: AgentClientService,
    @Inject(REDIS_CMD) private readonly redis: Redis,
    private readonly emitter: RealtimeEmitter,
  ) {}

  onModuleInit() {
    void this.probeAll();
    this.timer = setInterval(() => void this.probeAll(), PROBE_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------------------

  private async probeAll() {
    let servers: ServerRow[];
    try {
      servers = await this.serverRepo.findAll();
    } catch (e) {
      this.log.warn(`probeAll: impossible de lire les serveurs: ${e}`);
      return;
    }

    await Promise.allSettled(servers.map(s => this.probeOne(s)));
  }

  private async probeOne(server: ServerRow): Promise<void> {
    const sid = server.server_id?.trim();
    if (!sid || !server.agent_port) {
      // Serveur non configuré (agent_port = 0) — ignoré silencieusement
      return;
    }

    let status: ServerStatus = 'offline';
    let currentMatchId: string | null = null;

    try {
      const health = await this.agentClient.health(sid);
      currentMatchId = health.currentMatchId ?? null;
      status = health.rconConnected ? (currentMatchId ? 'used' : 'start') : 'offline';
    } catch (err) {
      // agent injoignable → offline
      const host = server.agent_host?.trim() || server.ip;
      this.log.debug(`[probe] ${sid} (${host}:${server.agent_port}) → offline: ${(err as Error).message}`);
    }

    // Mise en cache Redis (TTL = 60 s pour détecter un probe mort)
    const result: ProbeResult = { status, currentMatchId, probedAt: Date.now() };
    await this.redis.setex(probeKey(sid), PROBE_REDIS_TTL_S, JSON.stringify(result));

    // Push WS uniquement si le statut a changé
    const prev = this.lastStatus.get(sid);
    if (prev !== status) {
      this.lastStatus.set(sid, status);
      this.log.log(`[probe] ${sid} ${prev ?? '?'} → ${status}`);
      this.emitter.emitGlobalAdmin('server:status', {
        serverId: sid,
        status,
        currentMatchId,
        ts: result.probedAt,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // API publique : lecture du cache (utilisée par ServersController)
  // ---------------------------------------------------------------------------

  async getCachedStatus(serverId: string): Promise<ProbeResult | null> {
    const raw = await this.redis.get(probeKey(serverId));
    if (!raw) return null;
    try { return JSON.parse(raw) as ProbeResult; } catch { return null; }
  }
}
