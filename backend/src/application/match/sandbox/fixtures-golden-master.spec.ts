import * as fs from 'fs';
import * as path from 'path';
import { SidesScoreService } from '../state/sides-score.service';
import { TimeoutsService } from '../state/timeouts.service';
import { TeamsRosterService } from '../state/rosters.service';
import { EconomyService } from '../state/economy.service';
import { PlayerStatsService } from '../state/player-stats.service';
import { SnapshotQuery } from '../state/snapshot.query';
import { MatchStateService } from '../state/match-state.service';
import { KillAndBombEventsHandler } from '../../subscribers/kill-bomb-events.handler';
import { LiveRule } from '../rules/live.rule';
import { parseCs2LineFallback } from './sandbox.service';
import { MatchPhase } from '@domain/phase.types';
import { EventTypes } from '@domain/events/event.types';

/**
 * In-memory Redis mock supporting Strings, Hashes, Lists, multi() and pipeline()
 * to execute the real state services and handlers deterministically in Jest.
 */
function createInMemoryRedis() {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Record<string, string>>();
  const lists = new Map<string, string[]>();

  const api: any = {
    get: async (key: string) => strings.get(key) ?? null,
    set: async (key: string, val: any) => {
      strings.set(key, String(val));
      return 'OK';
    },
    del: async (...keys: string[]) => {
      for (const k of keys.flat()) {
        strings.delete(k);
        hashes.delete(k);
        lists.delete(k);
      }
      return 1;
    },
    type: async (key: string) => {
      if (hashes.has(key)) return 'hash';
      if (lists.has(key)) return 'list';
      if (strings.has(key)) return 'string';
      return 'none';
    },
    hget: async (key: string, field: string) => {
      const h = hashes.get(key);
      return h && field in h ? h[field] : null;
    },
    hset: async (key: string, fieldOrObj: string | Record<string, any>, val?: any) => {
      const cur = { ...(hashes.get(key) || {}) };
      if (typeof fieldOrObj === 'string') {
        cur[fieldOrObj] = String(val ?? '');
      } else if (fieldOrObj && typeof fieldOrObj === 'object') {
        for (const [k, v] of Object.entries(fieldOrObj)) {
          if (v !== undefined && v !== null) {
            cur[k] = String(v);
          }
        }
      }
      hashes.set(key, cur);
      return 1;
    },
    hdel: async (key: string, ...fields: string[]) => {
      const cur = hashes.get(key);
      if (!cur) return 0;
      for (const f of fields.flat()) {
        delete cur[f];
      }
      return 1;
    },
    hgetall: async (key: string) => {
      return { ...(hashes.get(key) || {}) };
    },
    hmget: async (key: string, ...fields: string[]) => {
      const h = hashes.get(key) || {};
      return fields.flat().map((f) => (f in h ? h[f] : null));
    },
    hincrby: async (key: string, field: string, increment: number) => {
      const cur = { ...(hashes.get(key) || {}) };
      const next = parseInt(cur[field] || '0', 10) + Number(increment);
      cur[field] = String(next);
      hashes.set(key, cur);
      return next;
    },
    lpos: async (key: string, val: string) => {
      const arr = lists.get(key) || [];
      const idx = arr.indexOf(String(val));
      return idx === -1 ? null : idx;
    },
    lrange: async (key: string, start: number, stop: number) => {
      const arr = lists.get(key) || [];
      if (stop === -1) return [...arr.slice(start)];
      return [...arr.slice(start, stop + 1)];
    },
    rpush: async (key: string, ...vals: string[]) => {
      const arr = [...(lists.get(key) || [])];
      for (const v of vals.flat()) arr.push(String(v));
      lists.set(key, arr);
      return arr.length;
    },
    lrem: async (key: string, _count: number, val: string) => {
      const arr = lists.get(key) || [];
      const next = arr.filter((x) => x !== String(val));
      lists.set(key, next);
      return arr.length - next.length;
    },
    multi: () => {
      const ops: (() => Promise<any>)[] = [];
      const chain: any = {
        set: (k: string, v: any) => { ops.push(() => api.set(k, v)); return chain; },
        del: (...k: string[]) => { ops.push(() => api.del(...k)); return chain; },
        hset: (k: string, f: any, v?: any) => { ops.push(() => api.hset(k, f, v)); return chain; },
        hdel: (k: string, ...f: string[]) => { ops.push(() => api.hdel(k, ...f)); return chain; },
        hincrby: (k: string, f: string, inc: number) => { ops.push(() => api.hincrby(k, f, inc)); return chain; },
        rpush: (k: string, ...v: string[]) => { ops.push(() => api.rpush(k, ...v)); return chain; },
        lrem: (k: string, c: number, v: string) => { ops.push(() => api.lrem(k, c, v)); return chain; },
        exec: async () => {
          const res = [];
          for (const op of ops) res.push([null, await op()]);
          return res;
        },
      };
      return chain;
    },
  };
  api.pipeline = api.multi;
  return api;
}

describe('Fixtures Golden Master Suite — 11 End-to-End Match Replays (Raw Logs & JSON Scenarios)', () => {
  const fixturesDir = path.resolve(__dirname, '../../../../../test/fixtures');
  const outcomesPath = path.join(fixturesDir, 'expected-outcomes.json');
  const outcomes = JSON.parse(fs.readFileSync(outcomesPath, 'utf8')) as Record<string, any>;
  const fixtureIds = Object.keys(outcomes);

  it('has all 11 registered fixtures in expected-outcomes.json', () => {
    expect(fixtureIds.length).toBe(11);
  });

  it.each(fixtureIds)(
    'replays %s and matches all expected score, phase, sides, streaks, roster and player K/D/A/Score metrics',
    async (fixtureId) => {
      const expected = outcomes[fixtureId];
      const matchId = `gm-${fixtureId}`;
      const serverId = 'srv-gm';

      const redis = createInMemoryRedis();
      const sidesScore = new SidesScoreService(redis);
      const timeouts = new TimeoutsService(redis);
      const rosters = new TeamsRosterService(redis, sidesScore);
      const economy = new EconomyService(redis, sidesScore, rosters);
      const playerStats = new PlayerStatsService(redis);
      const snapshotQ = new SnapshotQuery(redis, sidesScore);
      const matchState = new MatchStateService(
        sidesScore,
        timeouts,
        rosters,
        economy,
        playerStats,
        snapshotQ,
      );

      const mockOrch: any = {
        onBombPlanted: jest.fn().mockResolvedValue(undefined),
        rcon: jest.fn().mockResolvedValue(undefined),
        restartGame: jest.fn().mockResolvedValue(undefined),
        push: jest.fn().mockResolvedValue(undefined),
        roundEnd: jest.fn(async (mid: string, winner: 'CT' | 'T') => {
          await matchState.roundEnd(mid, winner);
        }),
        setPhase: jest.fn(async (mid: string, p: MatchPhase) => {
          await matchState.setPhase(mid, p);
        }),
        swapSides: jest.fn(async (mid: string) => {
          return await matchState.swapSides(mid);
        }),
        endMatch: jest.fn(async (mid: string) => {
          await matchState.setPhase(mid, MatchPhase.POSTGAME);
        }),
      };

      const combatHandler = new KillAndBombEventsHandler(mockOrch, matchState);
      const liveRule = new LiveRule({ handle: jest.fn() } as any);
      const onTeamRoundWin = (liveRule as any).events.get(EventTypes.TEAM_ROUND_WIN);

      const ctx: any = {
        matchId,
        serverId,
        say: jest.fn().mockResolvedValue(undefined),
        orch: mockOrch,
        state: matchState,
      };

      // Initialize match state identically to SandboxService
      await matchState.setServerIdToMatchId(serverId, matchId);
      await matchState.setSides(matchId, { home: 'CT', away: 'T' });
      await matchState.initScore(matchId);
      await matchState.setLastScoredRound(matchId, 0);
      await matchState.setHalftimePlayed(matchId, false);
      await matchState.setOvertimeCount(matchId, 0);
      await matchState.initEconomy(matchId);
      await matchState.setPhase(matchId, MatchPhase.LIVE_MAIN);
      await matchState.setSettings(matchId, {
        overtimeEnabled: true,
        mrFormat: 12,
        overtimeMrFormat: 3,
        warmupAtHalftime: false,
        warmupAtOvertime: false,
        warmupAfterKnife: false,
        knifeEnabled: false,
      });

      // Load events from raw-log or scenario JSON
      let events: any[] = [];
      if (expected.type === 'raw-log') {
        const logPath = path.join(fixturesDir, 'raw-logs', fixtureId);
        expect(fs.existsSync(logPath)).toBe(true);
        const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/);
        for (const line of lines) {
          const parsed = parseCs2LineFallback(line, matchId, serverId);
          if (parsed) events.push(parsed);
        }
      } else {
        const scPath = path.join(fixturesDir, 'scenarios', fixtureId);
        expect(fs.existsSync(scPath)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(scPath, 'utf8'));
        events = Array.isArray(parsed) ? parsed : (parsed.events || []);
      }

      // Replay all events sequentially
      for (const rawEv of events) {
        const ev = { ...rawEv, matchId, serverId };
        await combatHandler.handle(ev);

        const phase = await matchState.getPhase(matchId);
        if (
          phase !== MatchPhase.POSTGAME &&
          (ev.type === EventTypes.TEAM_ROUND_WIN || ev.type === EventTypes.SFUI_TARGET_BOMBED)
        ) {
          await onTeamRoundWin(ev, ctx);
        }
      }

      const snapshot = await matchState.getSnapshot(matchId);

      const allPlayers = [...snapshot.scoreboard.home, ...snapshot.scoreboard.away];
      const totals = allPlayers.reduce(
        (acc, p) => ({
          kills: acc.kills + p.kills,
          deaths: acc.deaths + p.deaths,
          assists: acc.assists + p.assists,
          flashAssists: acc.flashAssists + p.flashAssists,
          headshots: acc.headshots + p.headshots,
          plants: acc.plants + p.plants,
          defuses: acc.defuses + p.defuses,
          score: acc.score + p.score,
        }),
        { kills: 0, deaths: 0, assists: 0, flashAssists: 0, headshots: 0, plants: 0, defuses: 0, score: 0 },
      );

      const actualPlayersBySteamId: Record<string, any> = {};
      for (const p of [...allPlayers].sort((a, b) => a.steamId.localeCompare(b.steamId))) {
        actualPlayersBySteamId[p.steamId] = {
          name: p.name,
          logical: p.logical,
          side: p.side,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          flashAssists: p.flashAssists,
          headshots: p.headshots,
          hsPercent: p.hsPercent,
          plants: p.plants,
          defuses: p.defuses,
          score: p.score,
        };
      }

      if (process.env.UPDATE_GOLDEN === '1') {
        const updated = {
          type: expected.type,
          label: expected.label,
          phase: snapshot.phase,
          round: snapshot.score.round,
          halftimePlayed: snapshot.halftimePlayed,
          overtimeCount: snapshot.overtimeCount,
          score: { ct: snapshot.score.ct, t: snapshot.score.t },
          sides: snapshot.sides,
          rosterCounts: {
            home: snapshot.scoreboard.home.length,
            away: snapshot.scoreboard.away.length,
          },
          streaks: snapshot.streaks,
          totals,
          scoreboardOrder: {
            ct: snapshot.scoreboard.ct.map((p) => p.steamId),
            t: snapshot.scoreboard.t.map((p) => p.steamId),
          },
          players: actualPlayersBySteamId,
        };
        outcomes[fixtureId] = updated;
        Object.assign(expected, updated);
        fs.writeFileSync(outcomesPath, JSON.stringify(outcomes, null, 2) + '\n', 'utf8');
      }

      // 1. Phase, Round, Halftime, Overtime
      expect(snapshot.phase).toBe(expected.phase);
      expect(snapshot.score.round).toBe(expected.round);
      expect(snapshot.halftimePlayed).toBe(expected.halftimePlayed);
      expect(snapshot.overtimeCount).toBe(expected.overtimeCount);

      // 2. Team Scores & Sides
      expect(snapshot.score.ct).toBe(expected.score.ct);
      expect(snapshot.score.t).toBe(expected.score.t);
      expect(snapshot.sides).toEqual(expected.sides);

      // 3. Roster Equilibrium & Disjointness
      const homePlayers = snapshot.scoreboard.home;
      const awayPlayers = snapshot.scoreboard.away;
      expect(homePlayers.length).toBe(expected.rosterCounts.home);
      expect(awayPlayers.length).toBe(expected.rosterCounts.away);

      const homeIds = new Set(homePlayers.map((p) => p.steamId));
      const awayIds = new Set(awayPlayers.map((p) => p.steamId));
      for (const id of homeIds) {
        expect(awayIds.has(id)).toBe(false);
      }

      // 4. Economy Streaks & Loss Bonus
      expect(snapshot.streaks).toEqual(expected.streaks);

      // 5. Aggregate Combat Totals
      expect(totals).toEqual(expected.totals);

      // 6. Scoreboard Ordering (CT and T sorted by descending score)
      expect(snapshot.scoreboard.ct.map((p) => p.steamId)).toEqual(expected.scoreboardOrder.ct);
      expect(snapshot.scoreboard.t.map((p) => p.steamId)).toEqual(expected.scoreboardOrder.t);

      // 7. Individual Player K/D/A, FlashAssists, Headshots, HS%, Plants, Defuses and Valve Score
      expect(actualPlayersBySteamId).toEqual(expected.players);
      for (const p of allPlayers) {
        const expectedFormulaScore =
          p.kills * 2 + p.headshots + p.assists + p.plants * 2 + p.defuses * 2;
        expect(p.score).toBe(expectedFormulaScore);
        expect(p.flashAssists).toBeLessThanOrEqual(p.assists);
      }
    },
  );
});
