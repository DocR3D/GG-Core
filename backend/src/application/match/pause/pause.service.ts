import { Injectable, Logger, Inject } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from '@app/match/state/redis.keys';
import { Logical } from '../state';

import { PeriodicMessenger } from '@app/shared/periodic/periodic-messenger.service';
import { buildTacPauseSpec, buildTecPauseSpec } from '@app/shared/periodic/messages-presets.types';

export type PauseReason = 'tactical' | 'technical' | 'admin';

type ArmedPick = {
  team: 'home' | 'away' | 'system';
  req: {
    reason: PauseReason;
    durationSec?: number | null;
    requestedAt: number;
    by?: { steamId?: string | null; name?: string | null; source: string };
  };
};

export type PauseState = {
  state: 'paused' | 'none';
  reason?: PauseReason;
  team?: Logical | 'system';
  startedAt?: number;
  tacBankHome?: number;
  tacBankAway?: number;
};

const tacId = (m: string) => `pause:tac:${m}`; // namespace "pause"
const tecId = (m: string) => `pause:tec:${m}`;
const lockKeyFor = (id: string) => `lock:periodic:${id}`;

// Verrou court pour éviter double activation si plusieurs observateurs voient "freeze"
const activateLock = (m: string) => `pause:lock:activate:${m}`;

@Injectable()
export class PauseMatchService {
  private readonly logger = new Logger(PauseMatchService.name);

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    private readonly messenger: PeriodicMessenger,
  ) {}

  private key(matchId: string) {
    return redisConst.pause(matchId);
  }

  // -----------------------------------------------------
  // Queries
  // -----------------------------------------------------
  async isPaused(matchId: string): Promise<boolean> {
    const s = await this.redis.hget(this.key(matchId), 'state');
    return s === 'paused';
  }

  async getPauseState(matchId: string): Promise<PauseState> {
    const h = await this.redis.hgetall(this.key(matchId));
    return {
      state: (h.state as any) || 'none',
      reason: (h.reason as any) || undefined,
      team: (h.team as any) || undefined,
      startedAt: h.started_at ? parseInt(h.started_at, 10) : undefined,
      tacBankHome: h.tac_bank_home ? parseInt(h.tac_bank_home, 10) : undefined,
      tacBankAway: h.tac_bank_away ? parseInt(h.tac_bank_away, 10) : undefined,
    };
  }

  /**
   * Phase courante ('live' | 'freeze' | 'end' | null)
   * Lit la clé de phase déjà présente dans ton state.
   */
  async getPhase(matchId: string): Promise<'live' | 'freeze' | 'end' | null> {
    const v = await this.redis.get(redisConst.phase(matchId));
    return v === 'live' || v === 'freeze' || v === 'end' ? v : null;
  }

  // -----------------------------------------------------
  // Actions
  // -----------------------------------------------------
  /**
   * pause(...):
   * - armOnly = true  → armement (stockage JSON) sans déclencher la pause
   * - armOnly = false → application immédiate (état + messages périodiques "pause")
   */
  async pause(
    matchId: string,
    serverId: string,
    opts: {
      reason: PauseReason;
      team?: 'home' | 'away' | 'system';
      durationSec?: number;
      armOnly?: boolean;
      by?: { steamId?: string | null; name?: string | null; source?: string };
    },
  ): Promise<void> {
    const key = this.key(matchId);
    const now = Date.now();
    const until = opts.durationSec ? now + opts.durationSec * 1000 : undefined;
    const team = opts.team ?? 'system';

    this.logger.log(
      `[pause] match=${matchId} reason=${opts.reason} team=${team} dur=${opts.durationSec ?? '-'} until=${until ?? '-'} armOnly=${opts.armOnly ?? false}`,
    );

    // Armement uniquement
    if (opts.armOnly) {
      const armField =
        team === 'home'
          ? 'arm_home_json'
          : team === 'away'
          ? 'arm_away_json'
          : 'arm_system_json';

      const req = JSON.stringify({
        reason: opts.reason,
        team,
        durationSec: opts.durationSec ?? null,
        requestedAt: now,
        by: {
          steamId: opts.by?.steamId ?? null,
          name: opts.by?.name ?? null,
          source: opts.by?.source ?? 'unknown', // "chat" | "admin" | "api"
        },
      });

      const ok = await this.redis.hsetnx(key, armField, req);
      if (ok) this.logger.debug(`[pause] armed slot=${armField} match=${matchId}`);
      else this.logger.warn(`[pause] slot already occupied slot=${armField} match=${matchId}`);
      return;
    }

    // Application immédiate (état "paused")
    await this.redis.hset(key, {
      state: 'paused',
      reason: opts.reason,
      team,
      until: until ? String(until) : '',
      started_at: String(now),
    });

    // Messages périodiques "pause" (namespace propre "pause:*")
    if (opts.reason === 'tactical') {
      const id = tacId(matchId);
      const base = buildTacPauseSpec({ matchId, serverId, redis: this.redis, intervalMs: 15_000 });
      // Forcer id/lockKey pour correspondre au cancel(...) de resume()
      this.messenger.schedule({ ...base, id, lockKey: lockKeyFor(id) });
    } else if (opts.reason === 'technical') {
      const id = tecId(matchId);
      const base = buildTecPauseSpec({ matchId, serverId, redis: this.redis, intervalMs: 30_000 });
      this.messenger.schedule({ ...base, id, lockKey: lockKeyFor(id) });
    } else {
      // admin: pas de messages périodiques par défaut
    }
  }

  /**
   * À appeler à l'ENTRÉE en FREEZE (depuis MatchPhaseService).
   * - Consomme la demande armée la plus ancienne
   * - Applique l'état "paused" + planifie les messages (pas de RCON ici)
   * Retourne { activated, reason, team, durationSec } si une pause a été activée.
   */
  async tryActivateAtFreeze(
    matchId: string,
  ): Promise<{ activated: boolean; reason?: PauseReason; team?: Logical | 'system'; durationSec?: number }> {
    // évite la course si plusieurs listeners appellent en même temps
    const gotLock = await this.redis.set(activateLock(matchId), '1', 'EX', 3, 'NX');
    if (!gotLock) return { activated: false };

    try {
      if (await this.isPaused(matchId)) return { activated: false };

      const { consumed, pick } = await this.consumeArmed(matchId);
      if (!consumed || !pick) return { activated: false };

      const duration = pick.req.durationSec ?? (pick.req.reason === 'tactical' ? 30 : 60);

      // applique l'état "paused" (messages périodiques inclus), sans RCON
      await this.pause(matchId, /* serverId */ 'n/a', {
        reason: pick.req.reason,
        team: pick.team === 'system' ? 'system' : (pick.team as Logical),
        durationSec: duration,
        armOnly: false,
        by: pick.req.by,
      });

      return {
        activated: true,
        reason: pick.req.reason,
        team: pick.team === 'system' ? 'system' : (pick.team as Logical),
        durationSec: duration,
      };
    } catch (err) {
      this.logger.error(`[tryActivateAtFreeze] match=${matchId} error`, err as any);
      return { activated: false };
    } finally {
      await this.redis.del(activateLock(matchId));
    }
  }

  /**
   * Consomme une requête de pause armée (sans déclencher la pause).
   * L’appelant décide si/ quand appliquer la pause (ex: au prochain FREEZE).
   */
  async consumeArmed(matchId: string): Promise<{ consumed: boolean; pick?: ArmedPick }> {
    const key = this.key(matchId);

    try {
      const h = await this.redis.hgetall(key);

      // Si déjà en pause, on NE consomme PAS pour ne pas perdre la demande.
      if (h.state === 'paused') {
        this.logger.debug(`[consumeArmed] match=${matchId} already paused - keep armed slots`);
        return { consumed: false };
      }

      const home = h.arm_home_json ? JSON.parse(h.arm_home_json) : null;
      const away = h.arm_away_json ? JSON.parse(h.arm_away_json) : null;
      const system = h.arm_system_json ? JSON.parse(h.arm_system_json) : null;

      const candidates = [
        home && { team: 'home' as const, req: home },
        away && { team: 'away' as const, req: away },
        system && { team: 'system' as const, req: system },
      ].filter(Boolean) as ArmedPick[];

      if (candidates.length === 0) {
        this.logger.debug(`[consumeArmed] match=${matchId} no armed request`);
        return { consumed: false };
      }

      // Choisir le plus ancien
      candidates.sort((a, b) => a.req.requestedAt - b.req.requestedAt);
      const pick = candidates[0];

      // Retirer le slot consommé
      await this.redis.hdel(key, `arm_${pick.team}_json`);
      this.logger.log(
        `[consumeArmed] match=${matchId} consumed armed request team=${pick.team} reason=${pick.req.reason} by=${JSON.stringify(pick.req.by)}`
      );

      // Ne PAS lancer la pause ici - on laisse l’appelant décider
      return { consumed: true, pick };
    } catch (err) {
      this.logger.error(`[consumeArmed] error match=${matchId}`, err as any);
      return { consumed: false };
    }
  }

  // -----------------------------------------------------
  // Resume
  // -----------------------------------------------------
  /**
   * Remet l'état à "none" et coupe les messages périodiques "pause".
   * Débite la banque tactique en fonction du temps réellement passé en pause.
   */
  async resume(matchId: string): Promise<void> {
    const key = this.key(matchId);
    const h = await this.redis.hgetall(key);
    if (h.state !== 'paused') return;

    const reason = h.reason as PauseReason | undefined;
    const team = (h.team as Logical | 'system' | undefined) ?? 'system';

    // Débit de la banque (tactical)
    if (reason === 'tactical' && (team === 'home' || team === 'away') && h.started_at) {
      const startedAt = parseInt(h.started_at, 10);
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      const field = team === 'home' ? 'tac_bank_home' : 'tac_bank_away';
      const bank = parseInt(h[field] ?? '0', 10);
      const debit = Math.min(elapsedSec, bank);
      const newBank = Math.max(0, bank - debit);
      await this.redis.hset(key, { [field]: String(newBank) });
    }

    // Stop des messages périodiques "pause" via ID stable
    const id = reason === 'tactical' ? tacId(matchId) : reason === 'technical' ? tecId(matchId) : null;
    if (id) this.messenger.cancel(id, lockKeyFor(id));

    // Reset état
    await this.redis.hset(key, { state: 'none', reason: '', team: '', started_at: '', until: '' });
  }

  // -----------------------------------------------------
  // Banks
  // -----------------------------------------------------
  async initTacBanks(matchId: string, secondsPerTeam = 300): Promise<void> {
    await this.redis.hset(this.key(matchId), {
      tac_bank_home: String(secondsPerTeam),
      tac_bank_away: String(secondsPerTeam),
    });
  }

  async getTacBank(matchId: string, team: Logical): Promise<number> {
    const field = team === 'home' ? 'tac_bank_home' : 'tac_bank_away';
    const v = await this.redis.hget(this.key(matchId), field);
    return parseInt(v ?? '0', 10);
  }

  async setTacBank(matchId: string, team: Logical, seconds: number): Promise<void> {
    const field = team === 'home' ? 'tac_bank_home' : 'tac_bank_away';
    await this.redis.hset(this.key(matchId), { [field]: String(Math.max(0, Math.floor(seconds))) });
  }

  async isPauseAllowed(
    matchId: string,
    opts: { reason: PauseReason; team?: Logical; minSec?: number },
  ): Promise<{ allowed: boolean; remainingSec?: number; why: string }> {
    const { reason, team, minSec = 1 } = opts;
    const h = await this.redis.hgetall(this.key(matchId));

    if (h.state === 'paused') return { allowed: false, why: 'already_paused' };
    if (reason === 'technical' || reason === 'admin') return { allowed: true, why: 'ok' };

    if (reason === 'tactical' && team) {
      const field = team === 'home' ? 'tac_bank_home' : 'tac_bank_away';
      const bank = parseInt(h[field] ?? '0', 10);
      return { allowed: bank >= minSec, remainingSec: bank, why: bank >= minSec ? 'ok' : 'no_bank' };
    }

    return { allowed: false, why: 'unknown_reason' };
  }

  // -----------------------------------------------------
  // Auto message flags (optionnels)
  // -----------------------------------------------------
  async armAutoMessage(matchId: string): Promise<void> {
    const key = this.key(matchId);
    await this.redis.hset(key, { auto_message_armed: '1' });
    this.logger.debug(`[armAutoMessage] match=${matchId} armed`);
  }

  async disarmAutoMessage(matchId: string): Promise<void> {
    const key = this.key(matchId);
    await this.redis.hdel(key, 'auto_message_armed');
    this.logger.debug(`[disarmAutoMessage] match=${matchId} disarmed`);
  }
}
