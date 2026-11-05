// src/application/match/admin-call/admin-call.service.ts
import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { RealtimeEmitter } from '@adapters/ws/ws-emitter.internal';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { PrismaService } from '@adapters/database/prisma.service';
import { TournamentConfigService } from '@app/config/tournament-config.service';
import { errorMessage } from '@app/shared/error-message';
import type { Prisma } from '@prisma/client';
import { AdminCall } from './admin-call.types';

@Injectable()
export class AdminCallService {
  private readonly logger = new Logger(AdminCallService.name);

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    private readonly emitter: RealtimeEmitter,
    private readonly cmds: MatchCommandsService,
    private readonly state: MatchStateService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly configService?: TournamentConfigService,
  ) {}

  private callsKey(matchId: string): string {
    return `match:${matchId}:admin_calls`;
  }

  async createCall(
    matchId: string,
    serverId: string,
    data: {
      team: 'home' | 'away' | 'system';
      player: { name: string; steamId?: string };
      message: string;
    },
  ): Promise<AdminCall> {
    const id = randomUUID();
    const now = Date.now();
    const cleanMsg = data.message.replace(/["\r\n]/g, ' ').trim().slice(0, 200) || "Demande d'assistance";

    const call: AdminCall = {
      id,
      matchId,
      serverId,
      team: data.team,
      player: data.player,
      message: cleanMsg,
      calledAt: now,
      status: 'open',
    };

    // 1) Enregistrer dans Redis
    await this.redis.hset(this.callsKey(matchId), id, JSON.stringify(call));
    await this.redis.expire(this.callsKey(matchId), 86400); // 24h

    // 2) Enregistrer dans l'event sourcing PostgreSQL
    if (this.prisma) {
      const matchMapId = await this.state.getDbMatchMapId(matchId).catch(() => null);
      await this.prisma.eventPrimary
        .create({
          data: {
            matchId,
            serverId,
            matchMapId: matchMapId ?? null,
            timestamp: BigInt(now),
            type: 'admin_call',
            payload: JSON.parse(JSON.stringify(call)) as Prisma.InputJsonValue,
          },
        })
        .catch((err: unknown) => {
          this.logger.warn(`[createCall] Échec de persistance eventPrimary: ${errorMessage(err)}`);
        });
    }

    // 3) Confirmation in-game pour rassurer le joueur
    const chatMsg = this.configService
      ? await this.configService.formatMessage(matchId, 'ADMIN_CALL_ACK', { message: cleanMsg })
      : `[GG-Core] Message reçu par les admins : "${cleanMsg}". Un arbitre arrive ou va vous répondre.`;
    await this.cmds.say(serverId, chatMsg);

    // 4) Pousser l'alerte aux arbitres (room du match + lobby admin)
    this.emitter.emitAdmin(matchId, 'admin:call', call);
    this.emitter.emitLobbyAdmin('admin:call', call);

    this.logger.log(`[AdminCall] Match ${matchId} (serveur ${serverId}) - ${data.player.name} (${data.team}) : "${cleanMsg}"`);
    return call;
  }

  async getCalls(matchId: string): Promise<AdminCall[]> {
    const rawMap = await this.redis.hgetall(this.callsKey(matchId));
    const calls: AdminCall[] = [];
    for (const json of Object.values(rawMap)) {
      try {
        calls.push(JSON.parse(json) as AdminCall);
      } catch {
        // ignore malformed entries
      }
    }
    return calls.sort((a, b) => b.calledAt - a.calledAt);
  }

  async ackCall(matchId: string, callId: string, adminName: string): Promise<AdminCall | null> {
    const raw = await this.redis.hget(this.callsKey(matchId), callId);
    if (!raw) return null;

    const call = JSON.parse(raw) as AdminCall;
    call.status = 'acknowledged';
    call.acknowledgedBy = adminName;
    call.acknowledgedAt = Date.now();

    await this.redis.hset(this.callsKey(matchId), callId, JSON.stringify(call));
    this.emitter.emitAdmin(matchId, 'admin:call_ack', call);
    this.emitter.emitLobbyAdmin('admin:call_ack', call);

    return call;
  }

  async resolveCall(matchId: string, callId: string, adminName: string): Promise<AdminCall | null> {
    const raw = await this.redis.hget(this.callsKey(matchId), callId);
    if (!raw) return null;

    const call = JSON.parse(raw) as AdminCall;
    call.status = 'resolved';
    call.acknowledgedBy = adminName;
    call.acknowledgedAt = Date.now();

    await this.redis.hset(this.callsKey(matchId), callId, JSON.stringify(call));
    this.emitter.emitAdmin(matchId, 'admin:call_ack', call);
    this.emitter.emitLobbyAdmin('admin:call_ack', call);

    return call;
  }
}
