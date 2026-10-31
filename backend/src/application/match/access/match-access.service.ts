// src/application/match/access/match-access.service.ts
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type Redis from 'ioredis';
import { randomInt } from 'crypto';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { WsBroadcaster } from '@adapters/ws/broadcaster.service';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { redisConst } from '@app/match/state/redis.keys';
import { steam64ToSteam3 } from '@app/auth/steam-openid';

/** Who may join the server of a match: its password, and the players allowed (empty = no whitelist). */
export interface MatchAccess {
  password?: string | null;
  /** SteamIDs in any format (SteamID64 or [U:1:x]); stored in the CS2 log format */
  allowedSteamIds?: string[] | null;
}

export const KICK_NOT_REGISTERED = "Vous n'êtes pas inscrit sur ce match";

// No 0/O, 1/l/i: the password may be read aloud or typed in the console
const PASSWORD_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Random server password (10 characters, easy to type). */
export function generateServerPassword(length = 10): string {
  return Array.from({ length }, () => PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)]).join('');
}

/** SteamID64 or Steam3 → the CS2 log format ([U:1:x]); null when not a SteamID. */
export function toLogSteamId(id: string | null | undefined): string | null {
  const s = String(id ?? '').trim();
  if (/^\[U:1:\d+\]$/.test(s)) return s;
  if (/^\d{17}$/.test(s)) return steam64ToSteam3(s);
  return null;
}

/**
 * Access to the server of a match (zero plugin: native sv_password and kickid only):
 * - the password is set on the server when the match starts (sv_password) and given to the players by the site;
 *   GOTV is left open (tv_password "") for the spectators;
 * - with a whitelist, a player whose SteamID is not allowed is kicked as soon as CS2 logs his connection
 *   (bots and GOTV are never kicked). The admins are alerted on the WebSocket.
 */
@Injectable()
export class MatchAccessService {
  private readonly log = new Logger(MatchAccessService.name);

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    @Inject(forwardRef(() => MatchCommandsService)) private readonly cmds: MatchCommandsService,
    private readonly ws: WsBroadcaster,
  ) {}

  /**
   * Stores the access of a match and applies its password on the server. A match without password clears the
   * server's one (each match sets the access of its server); without allowed players there is no whitelist.
   */
  async apply(matchId: string, serverId: string, access: MatchAccess = {}) {
    const password = access.password?.trim() || '';
    const allowed = [...new Set((access.allowedSteamIds ?? []).map(toLogSteamId).filter((s): s is string => !!s))];

    const tx = this.redis.multi().del(redisConst.matchPassword(matchId), redisConst.matchAllowed(matchId));
    if (password) tx.set(redisConst.matchPassword(matchId), password);
    if (allowed.length) tx.sadd(redisConst.matchAllowed(matchId), ...allowed);
    await tx.exec();

    await this.cmds.rcon({ serverId, matchId, command: `sv_password "${password}"` }).catch(() => {});
    // GOTV open to everyone (the "Regarder" button of the match page): it is delayed (tv_delay of the competitive
    // config, 105 s on the dev server), so watching it cannot help a team
    await this.cmds.rcon({ serverId, matchId, command: 'tv_password ""' }).catch(() => {});
    this.log.log(`[access] ${matchId} on ${serverId}: password ${password ? 'set' : 'none'}, whitelist ${allowed.length ? `${allowed.length} players` : 'off'}`);
    return { password: password || null, whitelist: allowed.length };
  }

  getPassword(matchId: string): Promise<string | null> {
    return this.redis.get(redisConst.matchPassword(matchId));
  }

  /**
   * A player connected to the server of `matchId`: kicked when the match has a whitelist and his SteamID is not
   * in it. Returns whether he was kicked.
   */
  async onPlayerConnected(matchId: string, serverId: string | undefined, player: { name?: string; steamId?: string; userId?: number }) {
    const steamId = toLogSteamId(player?.steamId);
    if (!steamId || !serverId) return false; // bots (BOT), GOTV, console: never kicked
    if (!(await this.redis.exists(redisConst.matchAllowed(matchId)))) return false; // no whitelist
    if (await this.redis.sismember(redisConst.matchAllowed(matchId), steamId)) return false;

    const userId = Number(player.userId);
    if (!Number.isInteger(userId) || userId < 0) {
      this.log.warn(`[access] ${steamId} not allowed on ${matchId} but no userid in the log: not kicked`);
      await this.ws.push(matchId, 'access:not_allowed', { matchId, serverId, player: { name: player.name, steamId }, kicked: false }, 'admin');
      return false;
    }
    await this.cmds.rcon({ serverId, matchId, command: `kickid ${userId} "${KICK_NOT_REGISTERED}"` });
    this.log.warn(`[access] ${player.name ?? '?'} ${steamId} kicked from ${serverId} (not registered on ${matchId})`);
    await this.ws.push(matchId, 'access:not_allowed', { matchId, serverId, player: { name: player.name, steamId }, kicked: true }, 'admin');
    return true;
  }
}
