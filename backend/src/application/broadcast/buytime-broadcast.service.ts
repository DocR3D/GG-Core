// src/application/broadcast/buytime-broadcast.service.ts
import { Injectable, Logger, Inject, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import * as crypto from 'crypto';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { RealtimeEmitter } from '@adapters/ws/ws-emitter.internal';
import { PrismaService } from '@adapters/database/prisma.service';
import { MatchPhase } from '@domain/phase.types';
import {
  BuytimeBroadcast,
  CreateBroadcastDto,
  RearmBroadcastDto,
  ServerBroadcastProgress,
} from './buytime-broadcast.types';

const REDIS_PREFIX = 'broadcast:buytime:';
const ACTIVE_BROADCASTS_KEY = 'broadcast:buytime:active_ids';

function uuid(): string {
  return crypto.randomUUID?.() ?? crypto.randomBytes(16).toString('hex');
}

@Injectable()
export class BuytimeBroadcastService {
  private readonly logger = new Logger(BuytimeBroadcastService.name);

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    private readonly cmds: MatchCommandsService,
    private readonly state: MatchStateService,
    private readonly emitter: RealtimeEmitter,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /**
   * Arm a broadcast message to be sent at buytime (freeze time) across target servers,
   * with support for repeating across multiple consecutive rounds.
   */
  async createBroadcast(dto: CreateBroadcastDto, author = 'admin'): Promise<BuytimeBroadcast> {
    const rawMessage = (dto.message ?? '').trim().replace(/[\r\n]+/g, ' ');
    if (!rawMessage) {
      throw new BadRequestException('Le message ne peut pas être vide');
    }

    const roundsTotal = Math.max(1, Math.floor(Number(dto.roundsCount ?? 1) || 1));
    const prefix = dto.prefix !== undefined ? dto.prefix.trim() : '[Annonce]';
    const formattedMessage = prefix ? `${prefix} ${rawMessage}` : rawMessage;
    const sendImmediateIfNoMatch = dto.sendImmediateIfNoMatch !== false;

    // Resolve target server ids
    const targetServerIds = await this.resolveTargetServers(dto.targets);
    if (targetServerIds.length === 0) {
      throw new BadRequestException('Aucun serveur cible trouvé ou disponible');
    }

    const broadcastId = uuid();
    const now = Date.now();
    const serversProgress: Record<string, ServerBroadcastProgress> = {};

    for (const serverId of targetServerIds) {
      const matchRunning = await this.isCompetitiveMatchRunning(serverId);

      if (!matchRunning && sendImmediateIfNoMatch) {
        // Server is idle or in warmup: send immediately
        try {
          await this.cmds.say(serverId, formattedMessage);
          serversProgress[serverId] = {
            serverId,
            roundsRemaining: 0,
            roundsSent: 1,
            lastSentAt: now,
            completed: true,
            immediate: true,
          };
          this.logger.log(`[BuytimeBroadcast] Sent immediately to idle/warmup server ${serverId}: "${formattedMessage}"`);
        } catch (err) {
          this.logger.warn(`[BuytimeBroadcast] Failed immediate dispatch to ${serverId}: ${String(err)}`);
          serversProgress[serverId] = {
            serverId,
            roundsRemaining: 0,
            roundsSent: 0,
            completed: true,
            immediate: true,
          };
        }
      } else {
        // Competitive match running: arm for the next `roundsTotal` buy times
        serversProgress[serverId] = {
          serverId,
          roundsRemaining: roundsTotal,
          roundsSent: 0,
          completed: false,
          immediate: false,
        };
        this.logger.log(
          `[BuytimeBroadcast] Armed for server ${serverId} for ${roundsTotal} consecutive round(s) at buytime: "${formattedMessage}"`,
        );
      }
    }

    const allCompleted = Object.values(serversProgress).every((s) => s.completed);

    const broadcast: BuytimeBroadcast = {
      id: broadcastId,
      message: rawMessage,
      prefix,
      formattedMessage,
      roundsTotal,
      createdAt: now,
      createdBy: author,
      sendImmediateIfNoMatch,
      completed: allCompleted,
      servers: serversProgress,
    };

    // Save to Redis
    await this.saveBroadcast(broadcast);

    if (!allCompleted) {
      await this.redis.sadd(ACTIVE_BROADCASTS_KEY, broadcastId);
    }

    this.notifyBroadcastEvent('created', broadcast);
    return broadcast;
  }

  /**
   * Called on every freeze time / buytime trigger by MatchOrchestrator.
   * Dispatches any armed broadcasts targeting this server/match.
   */
  async onFreezeTime(matchId: string, serverIdInput?: string): Promise<number> {
    const serverId = serverIdInput || (await this.state.getServerIdFromMatchId(matchId));
    if (!serverId) return 0;

    const activeIds = await this.redis.smembers(ACTIVE_BROADCASTS_KEY);
    if (!activeIds || activeIds.length === 0) return 0;

    const snapshot = await this.state.getSnapshot(matchId);
    const currentRound = snapshot?.score?.round ?? 0;

    let sentCount = 0;

    for (const id of activeIds) {
      const broadcast = await this.getBroadcast(id);
      if (!broadcast || broadcast.cancelled || broadcast.completed) {
        await this.redis.srem(ACTIVE_BROADCASTS_KEY, id);
        continue;
      }

      const serverProg = broadcast.servers[serverId];
      if (!serverProg || serverProg.completed || serverProg.roundsRemaining <= 0) {
        continue;
      }

      // Avoid double-sending on the same round
      if (serverProg.lastSentRound === currentRound && currentRound > 0) {
        continue;
      }

      // Send via RCON
      try {
        await this.cmds.say(serverId, broadcast.formattedMessage);
        sentCount++;

        serverProg.roundsSent += 1;
        serverProg.roundsRemaining -= 1;
        serverProg.lastSentRound = currentRound;
        serverProg.lastSentAt = Date.now();

        if (serverProg.roundsRemaining <= 0) {
          serverProg.completed = true;
        }

        // Check if all servers of this broadcast are completed
        const isBroadcastDone = Object.values(broadcast.servers).every((s) => s.completed);
        if (isBroadcastDone) {
          broadcast.completed = true;
          await this.redis.srem(ACTIVE_BROADCASTS_KEY, id);
        }

        await this.saveBroadcast(broadcast);
        this.notifyBroadcastEvent('progress', broadcast);

        this.logger.log(
          `[BuytimeBroadcast] Delivered to ${serverId} at round ${currentRound} (${serverProg.roundsRemaining} remaining): "${broadcast.formattedMessage}"`,
        );
      } catch (err) {
        this.logger.error(`[BuytimeBroadcast] Error sending to ${serverId}: ${String(err)}`);
      }
    }

    return sentCount;
  }

  /**
   * Re-arm an existing broadcast for additional rounds (e.g. show 2 more rounds).
   */
  async rearmBroadcast(id: string, dto: RearmBroadcastDto = {}): Promise<BuytimeBroadcast> {
    const broadcast = await this.getBroadcast(id);
    if (!broadcast) {
      throw new NotFoundException(`Annonce ${id} introuvable`);
    }

    const requested = dto.additionalRounds ?? dto.roundsCount ?? 1;
    const additionalRounds = Math.max(1, Math.floor(Number(requested) || 1));
    broadcast.roundsTotal += additionalRounds;
    broadcast.completed = false;
    broadcast.cancelled = false;

    for (const prog of Object.values(broadcast.servers)) {
      prog.roundsRemaining += additionalRounds;
      prog.completed = false;
    }

    await this.saveBroadcast(broadcast);
    await this.redis.sadd(ACTIVE_BROADCASTS_KEY, id);

    this.notifyBroadcastEvent('rearmed', broadcast);
    this.logger.log(`[BuytimeBroadcast] Broadcast ${id} re-armed for +${additionalRounds} round(s)`);
    return broadcast;
  }

  /**
   * Cancel an armed broadcast, stopping future round dispatches.
   */
  async cancelBroadcast(id: string): Promise<BuytimeBroadcast> {
    const broadcast = await this.getBroadcast(id);
    if (!broadcast) {
      throw new NotFoundException(`Annonce ${id} introuvable`);
    }

    broadcast.cancelled = true;
    broadcast.completed = true;
    for (const prog of Object.values(broadcast.servers)) {
      prog.completed = true;
      prog.roundsRemaining = 0;
    }

    await this.saveBroadcast(broadcast);
    await this.redis.srem(ACTIVE_BROADCASTS_KEY, id);

    this.notifyBroadcastEvent('cancelled', broadcast);
    this.logger.log(`[BuytimeBroadcast] Broadcast ${id} cancelled`);
    return broadcast;
  }

  /**
   * List all broadcasts (active and past).
   */
  async listBroadcasts(): Promise<BuytimeBroadcast[]> {
    const keys = await this.redis.keys(`${REDIS_PREFIX}*`);
    const broadcasts: BuytimeBroadcast[] = [];

    for (const key of keys) {
      if (key.includes(':active_ids')) continue;
      const data = await this.redis.get(key);
      if (data) {
        try {
          broadcasts.push(JSON.parse(data) as BuytimeBroadcast);
        } catch {
          // ignore corrupted json
        }
      }
    }

    // Sort by createdAt desc
    return broadcasts.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get single broadcast by ID.
   */
  async getBroadcast(id: string): Promise<BuytimeBroadcast | null> {
    const data = await this.redis.get(`${REDIS_PREFIX}${id}`);
    if (!data) return null;
    try {
      return JSON.parse(data) as BuytimeBroadcast;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private async saveBroadcast(broadcast: BuytimeBroadcast): Promise<void> {
    // 24 hour TTL to clean up old broadcasts
    await this.redis.set(`${REDIS_PREFIX}${broadcast.id}`, JSON.stringify(broadcast), 'EX', 86400);
  }

  private async isCompetitiveMatchRunning(serverId: string): Promise<boolean> {
    const matchId = await this.state.getMatchIdFromServerId(serverId);
    if (!matchId) return false;
    const phase = await this.state.getPhase(matchId);
    return phase === MatchPhase.LIVE_MAIN || phase === MatchPhase.OVERTIME;
  }

  private async resolveTargetServers(targets?: 'all' | string[]): Promise<string[]> {
    if (Array.isArray(targets) && targets.length > 0 && targets[0] !== 'all') {
      return targets.map((t) => t.trim()).filter((t) => !!t);
    }

    // Retrieve all active/known servers from Prisma
    if (this.prisma) {
      try {
        const servers = await this.prisma.server.findMany({
          where: { status: { not: 'OFFLINE' } },
          select: { name: true },
        });
        if (servers.length > 0) {
          return servers.map((s) => s.name);
        }
      } catch (err) {
        this.logger.debug(`[resolveTargetServers] Prisma query error: ${String(err)}`);
      }
    }

    return ['srv-a'];
  }

  private notifyBroadcastEvent(action: 'created' | 'progress' | 'rearmed' | 'cancelled', broadcast: BuytimeBroadcast) {
    try {
      this.emitter.emitLobbyAdmin('broadcast:updated', { action, broadcast });
    } catch {
      // best-effort
    }
  }
}
