// src/application/match/access/team-placement.service.ts
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { WsBroadcaster } from '@adapters/ws/broadcaster.service';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { redisConst } from '@app/match/state/redis.keys';
import { decidePlacement, PlacementVerdict } from '@domain/team-placement';
import { normalizeSide } from '@domain/side.types';
import { toLogSteamId } from './match-access.service';

const clean = (name: string | null | undefined) => String(name ?? '').replace(/["\\]/g, '').trim();

/**
 * Sides chosen in the veto (side mode "pick", no knife round): before the live, are the two teams on their side?
 * - where each player stands is followed from the "switched from team" log lines (per server: a player keeps his
 *   side across matches until he leaves);
 * - when both teams are ready: right sides → live; both teams inverted → mp_swapteams then live; otherwise the
 *   live waits, the misplaced players are named in the chat and the admins alerted;
 * - the team names are set in game (mp_teamname_1 = the team starting CT, mp_teamname_2 = T) after a possible
 *   swap: checked on the dev server, mp_swapteams moves the players but the names stay on their side.
 */
@Injectable()
export class TeamPlacementService {
  private readonly log = new Logger(TeamPlacementService.name);

  constructor(
    @Inject(REDIS_CMD) private readonly redis: Redis,
    @Inject(forwardRef(() => MatchCommandsService)) private readonly cmds: MatchCommandsService,
    private readonly state: MatchStateService,
    private readonly ws: WsBroadcaster,
  ) {}

  /** The SteamIDs of each roster for this match (CS2 log format), shown in the snapshot too. */
  async setLineups(matchId: string, home: string[], away: string[]) {
    const ids = (list: string[]) => [...new Set(list.map(toLogSteamId).filter((s): s is string => !!s))];
    const tx = this.redis.multi().del(redisConst.lineupHome(matchId), redisConst.lineupAway(matchId));
    if (ids(home).length) tx.rpush(redisConst.lineupHome(matchId), ...ids(home));
    if (ids(away).length) tx.rpush(redisConst.lineupAway(matchId), ...ids(away));
    await tx.exec();
  }

  /** A player changed side (`to`) or left the server (`to` = null). */
  async track(serverId: string | undefined, player: { name?: string; steamId?: string }, to: string | null) {
    const steamId = toLogSteamId(player?.steamId);
    if (!serverId || !steamId) return; // bots, GOTV
    const key = redisConst.serverPlayerSides(serverId);
    if (to) await this.redis.hset(key, steamId, JSON.stringify({ side: to, name: player.name ?? '' }));
    else await this.redis.hdel(key, steamId);
  }

  /**
   * Called when both teams are ready, before the countdown to the live. Returns false when the live must wait
   * (players on the wrong side). Matches without sides chosen in the veto are never checked.
   */
  async checkBeforeLive(matchId: string, serverId: string): Promise<boolean> {
    const settings = await this.state.getSettings(matchId);
    if (!settings?.fixedSides) return true;

    const [sides, home, away, raw, snapshot] = await Promise.all([
      this.state.getSides(matchId),
      this.redis.lrange(redisConst.lineupHome(matchId), 0, -1),
      this.redis.lrange(redisConst.lineupAway(matchId), 0, -1),
      this.redis.hgetall(redisConst.serverPlayerSides(serverId)),
      this.state.getSnapshot(matchId),
    ]);
    const where: Record<string, { side: string; name: string }> = {};
    for (const [id, v] of Object.entries(raw ?? {})) {
      try {
        where[id] = JSON.parse(v);
      } catch {
        /* ignore a broken entry */
      }
    }
    if (!sides) return true; // no sides recorded: nothing to compare with
    const expected = { home: normalizeSide(sides.home), away: normalizeSide(sides.away) };
    const names = { home: clean(snapshot?.teams?.home_name) || 'Domicile', away: clean(snapshot?.teams?.away_name) || 'Extérieur' };
    const verdict: PlacementVerdict = decidePlacement({
      expected,
      lineups: { home, away },
      sides: Object.fromEntries(Object.entries(where).map(([id, w]) => [id, w.side])),
    });
    this.log.log(`[placement] ${matchId}: ${verdict.kind}`);

    if (verdict.kind === 'wrong') {
      const who = verdict.misplaced.map((p) => where[p.steamId]?.name || p.steamId).join(', ');
      await this.cmds.say(serverId, `[GG-Core] Mauvais camp : ${names.home} doit jouer ${expected.home}, ${names.away} ${expected.away}.`);
      await this.cmds.say(serverId, `[GG-Core] À changer de camp : ${who}. Retapez !ready ensuite.`);
      await this.ws.push(matchId, 'sides:misplaced', { matchId, expected, misplaced: verdict.misplaced.map((p) => ({ ...p, name: where[p.steamId]?.name })) }, 'admin');
      return false;
    }
    if (verdict.kind === 'swap') {
      await this.cmds.rcon({ serverId, matchId, command: 'mp_swapteams' });
      await this.cmds.say(serverId, `[GG-Core] Équipes inversées : échange des camps (${names.home} en ${expected.home}).`);
    }
    if (verdict.kind === 'unknown') {
      await this.ws.push(matchId, 'sides:unchecked', { matchId, expected, reason: verdict.reason }, 'admin');
    }
    // names after the swap: they stay on their side when the players are moved
    const onCt = expected.home === 'CT' ? names.home : names.away;
    const onT = expected.home === 'CT' ? names.away : names.home;
    await this.cmds.rcon({ serverId, matchId, command: `mp_teamname_1 "${onCt}"` });
    await this.cmds.rcon({ serverId, matchId, command: `mp_teamname_2 "${onT}"` });
    return true;
  }
}
