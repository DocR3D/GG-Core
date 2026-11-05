// src/application/config/tournament-config.service.ts

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '@adapters/database/prisma.service';
import type { Prisma } from '@prisma/client';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import type Redis from 'ioredis';
import {
  CanonicalCommand,
  MessageKey,
  ResolvedCommand,
  TournamentCustomConfig,
  TournamentEffectiveConfig,
} from '@domain/config/config.types';
import {
  DEFAULT_BOT_TAG,
  DEFAULT_COMMAND_ALIASES,
  DEFAULT_MATCH_RULES,
  DEFAULT_MESSAGES,
} from '@domain/config/config.constants';
import { interpolateTemplate } from '@domain/config/template.utils';
import { normalizeChatCommand } from '@domain/rules/rules.constants';

const CACHE_TTL_SEC = 30;

@Injectable()
export class TournamentConfigService {
  private readonly logger = new Logger(TournamentConfigService.name);

  // In-memory fallback cache (used when Redis is not available or in unit tests)
  private readonly memCache = new Map<string, { config: TournamentEffectiveConfig; expiresAt: number }>();
  private readonly memMatchTournament = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CMD) private readonly redis?: Redis,
  ) {}

  /**
   * Returns the default baseline configuration.
   */
  getDefaults(): TournamentEffectiveConfig {
    return {
      botTag: DEFAULT_BOT_TAG,
      commandAliases: { ...DEFAULT_COMMAND_ALIASES },
      disabledCommands: [],
      messages: { ...DEFAULT_MESSAGES },
      matchRules: { ...DEFAULT_MATCH_RULES },
    };
  }

  /**
   * Merges custom tournament configuration overrides on top of defaults.
   */
  mergeWithDefaults(custom?: TournamentCustomConfig | null): TournamentEffectiveConfig {
    const defaults = this.getDefaults();
    if (!custom) return defaults;

    const botTag = custom.botTag?.trim() || defaults.botTag;

    const commandAliases = { ...defaults.commandAliases };
    if (custom.commandAliases) {
      for (const [cmd, aliases] of Object.entries(custom.commandAliases)) {
        if (Array.isArray(aliases) && aliases.length > 0) {
          commandAliases[cmd as CanonicalCommand] = aliases
            .map((a) => normalizeChatCommand(a))
            .filter(Boolean);
        }
      }
    }

    const disabledCommands = Array.isArray(custom.disabledCommands)
      ? custom.disabledCommands.filter(Boolean)
      : [];

    const messages = { ...defaults.messages };
    if (custom.messages) {
      for (const [key, tpl] of Object.entries(custom.messages)) {
        if (typeof tpl === 'string' && tpl.trim()) {
          messages[key as MessageKey] = tpl;
        }
      }
    }

    const matchRules = {
      ...defaults.matchRules,
      ...(custom.matchRules ?? {}),
    };

    return {
      botTag,
      commandAliases,
      disabledCommands,
      messages,
      matchRules,
    };
  }

  /**
   * Retrieves effective configuration for a tournament (with caching).
   */
  async getTournamentConfig(tournamentId?: string | null): Promise<TournamentEffectiveConfig> {
    if (!tournamentId) return this.getDefaults();

    // Check memory cache
    const now = Date.now();
    const memCached = this.memCache.get(tournamentId);
    if (memCached && memCached.expiresAt > now) {
      return memCached.config;
    }

    // Check Redis cache if present
    const redisKey = `config:tournament:${tournamentId}`;
    if (this.redis) {
      try {
        const cachedStr = await this.redis.get(redisKey);
        if (cachedStr) {
          const parsed = JSON.parse(cachedStr) as TournamentEffectiveConfig;
          this.memCache.set(tournamentId, { config: parsed, expiresAt: now + CACHE_TTL_SEC * 1000 });
          return parsed;
        }
      } catch (err) {
        this.logger.warn(`Redis error getting tournament config cache: ${err}`);
      }
    }

    // Load from PostgreSQL
    let custom: TournamentCustomConfig | undefined;
    try {
      const tournament = await this.prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { settings: true },
      });
      const settings = tournament?.settings as { config?: TournamentCustomConfig } | null;
      custom = settings?.config;
    } catch (err) {
      this.logger.warn(`Failed to load tournament config from DB for ${tournamentId}: ${err}`);
    }

    const effective = this.mergeWithDefaults(custom);

    // Save to memory cache
    this.memCache.set(tournamentId, { config: effective, expiresAt: now + CACHE_TTL_SEC * 1000 });

    // Save to Redis
    if (this.redis) {
      try {
        await this.redis.set(redisKey, JSON.stringify(effective), 'EX', CACHE_TTL_SEC);
      } catch (err) {
        this.logger.warn(`Redis error setting tournament config cache: ${err}`);
      }
    }

    return effective;
  }

  /**
   * Finds the tournamentId associated with a running match.
   */
  async getTournamentIdFromMatch(matchId: string): Promise<string | null> {
    if (!matchId) return null;

    // Check memory
    if (this.memMatchTournament.has(matchId)) {
      return this.memMatchTournament.get(matchId)!;
    }

    // Check Redis
    if (this.redis) {
      try {
        const cachedTid = await this.redis.get(`match:${matchId}:tournamentId`);
        if (cachedTid) {
          this.memMatchTournament.set(matchId, cachedTid);
          return cachedTid;
        }

        // Try via matchMapId stored in Redis
        const mapId = await this.redis.get(`match:${matchId}:dbMatchMapId`);
        if (mapId) {
          const matchMap = await this.prisma.matchMap.findUnique({
            where: { id: mapId },
            select: { match: { select: { tournamentId: true } } },
          });
          const tid = matchMap?.match?.tournamentId;
          if (tid) {
            await this.redis.set(`match:${matchId}:tournamentId`, tid, 'EX', 3600);
            this.memMatchTournament.set(matchId, tid);
            return tid;
          }
        }
      } catch (err) {
        this.logger.warn(`Redis error resolving tournament for match ${matchId}: ${err}`);
      }
    }

    // Direct database fallback via matchMap id
    try {
      const matchMap = await this.prisma.matchMap.findUnique({
        where: { id: matchId },
        select: { match: { select: { tournamentId: true } } },
      });
      const tid = matchMap?.match?.tournamentId;
      if (tid) {
        this.memMatchTournament.set(matchId, tid);
        return tid;
      }
    } catch {
      // matchId might not be an UUID (e.g. sandbox "m-1234")
    }

    return null;
  }

  /**
   * Sets the tournamentId associated with a match in cache.
   */
  async setMatchTournamentId(matchId: string, tournamentId: string): Promise<void> {
    this.memMatchTournament.set(matchId, tournamentId);
    if (this.redis) {
      try {
        await this.redis.set(`match:${matchId}:tournamentId`, tournamentId, 'EX', 86400);
      } catch (err) {
        this.logger.warn(`Failed to set match tournamentId in Redis: ${err}`);
      }
    }
  }

  /**
   * Retrieves effective configuration for a running match.
   */
  async getMatchConfig(matchId: string): Promise<TournamentEffectiveConfig> {
    const tournamentId = await this.getTournamentIdFromMatch(matchId);
    return this.getTournamentConfig(tournamentId);
  }

  /**
   * Resolves a raw in-game command string to its canonical action and checks permissions.
   */
  async resolveCommand(matchId: string, rawInput: string): Promise<ResolvedCommand | null> {
    if (!rawInput) return null;
    const clean = normalizeChatCommand(rawInput);
    if (!clean) return null;

    const config = await this.getMatchConfig(matchId);

    for (const [cmd, aliases] of Object.entries(config.commandAliases) as [CanonicalCommand, string[]][]) {
      if (aliases.includes(clean)) {
        const isAllowed = !config.disabledCommands.includes(cmd);
        return {
          canonical: cmd,
          rawInput: clean,
          isAllowed,
        };
      }
    }

    return null;
  }

  /**
   * Formats a CS2 chat message using configured templates and variables.
   */
  async formatMessage(
    matchIdOrTournamentId: string,
    key: MessageKey,
    params: Record<string, unknown> = {},
  ): Promise<string> {
    // If the id looks like a matchId, try to resolve its tournament config; otherwise fetch directly
    let config: TournamentEffectiveConfig;
    const tid = await this.getTournamentIdFromMatch(matchIdOrTournamentId);
    if (tid) {
      config = await this.getTournamentConfig(tid);
    } else {
      config = await this.getTournamentConfig(matchIdOrTournamentId);
    }

    const template = config.messages[key] || DEFAULT_MESSAGES[key] || '';
    const fullParams: Record<string, unknown> = {
      tag: config.botTag,
      ...params,
    };

    return interpolateTemplate(template, fullParams);
  }

  /**
   * Updates custom tournament settings in PostgreSQL JSONB and clears cache.
   */
  async updateTournamentConfig(
    tournamentId: string,
    customConfig: TournamentCustomConfig,
  ): Promise<TournamentEffectiveConfig> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { settings: true },
    });
    if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);

    const existingSettings = (tournament.settings as Record<string, unknown>) ?? {};
    const updatedSettings = {
      ...existingSettings,
      config: customConfig,
    };

    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { settings: updatedSettings as unknown as Prisma.InputJsonValue },
    });

    // Invalidate caches
    this.memCache.delete(tournamentId);
    if (this.redis) {
      try {
        await this.redis.del(`config:tournament:${tournamentId}`);
      } catch (err) {
        this.logger.warn(`Failed to delete Redis config cache: ${err}`);
      }
    }

    return this.getTournamentConfig(tournamentId);
  }

  /**
   * Clears custom tournament settings, reverting to default baseline.
   */
  async resetTournamentConfig(tournamentId: string): Promise<TournamentEffectiveConfig> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { settings: true },
    });
    if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);

    const existingSettings = (tournament.settings as Record<string, unknown>) ?? {};
    delete existingSettings.config;

    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { settings: existingSettings as unknown as Prisma.InputJsonValue },
    });

    this.memCache.delete(tournamentId);
    if (this.redis) {
      try {
        await this.redis.del(`config:tournament:${tournamentId}`);
      } catch (err) {
        this.logger.warn(`Failed to delete Redis config cache: ${err}`);
      }
    }

    return this.getDefaults();
  }
}
