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

const fixturesDir = path.resolve(__dirname, '../../../../../test/fixtures');
const outcomesPath = path.join(fixturesDir, 'expected-outcomes.json');

type FixtureType = 'raw-log' | 'scenario';

/** Every fixture on disk (raw CS2 logs + JSON scenarios). */
function listFixtureFiles(): { id: string; type: FixtureType }[] {
  const raw = fs.readdirSync(path.join(fixturesDir, 'raw-logs')).filter((f) => f.endsWith('.log'));
  const sc = fs.readdirSync(path.join(fixturesDir, 'scenarios')).filter((f) => f.endsWith('.json'));
  return [
    ...raw.map((id) => ({ id, type: 'raw-log' as const })),
    ...sc.map((id) => ({ id, type: 'scenario' as const })),
  ].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Replays one fixture through the real state services, combat handler and LiveRule scoring
 * (orchestrator stubbed), exactly like SandboxService does.
 */
async function replayFixture(fixtureId: string, type: FixtureType, opts: { untilLine?: number } = {}) {
  const matchId = `gm-${fixtureId}`;
  const serverId = 'srv-gm';

  const redis = createInMemoryRedis();
  const sidesScore = new SidesScoreService(redis);
  const timeouts = new TimeoutsService(redis);
  const rosters = new TeamsRosterService(redis, sidesScore);
  const economy = new EconomyService(redis, sidesScore, rosters);
  const playerStats = new PlayerStatsService(redis);
  const snapshotQ = new SnapshotQuery(redis, sidesScore);
  const matchState = new MatchStateService(sidesScore, timeouts, rosters, economy, playerStats, snapshotQ);

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
  if (type === 'raw-log') {
    const lines = fs.readFileSync(path.join(fixturesDir, 'raw-logs', fixtureId), 'utf8').split(/\r?\n/);
    for (const line of lines.slice(0, opts.untilLine ?? lines.length)) {
      const parsed = parseCs2LineFallback(line, matchId, serverId);
      if (parsed) events.push(parsed);
    }
  } else {
    const parsed = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'scenarios', fixtureId), 'utf8'));
    events = Array.isArray(parsed) ? parsed : parsed.events || [];
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

  const playersBySteamId: Record<string, any> = {};
  for (const p of [...allPlayers].sort((a, b) => a.steamId.localeCompare(b.steamId))) {
    playersBySteamId[p.steamId] = {
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

  return { snapshot, allPlayers, totals, playersBySteamId };
}

/**
 * CS2's own truth, from the raw log:
 * - final score from `Game Over: ... score CT:T`;
 * - per-player K/D/A from the last NON-EMPTY `round_stats` JSON block. CS2 emits that block a few seconds
 *   after each round end (stats up to that round); the block after `Game Over` is already reset to 0, so the
 *   last usable truth is one round before the end. `endLine` lets the replay stop at the same instant.
 */
function readCs2Truth(fixtureId: string) {
  const lines = fs.readFileSync(path.join(fixturesDir, 'raw-logs', fixtureId), 'utf8').split(/\r?\n/);
  const body = (l: string) => l.replace(/^.*?L \d{2}\/\d{2}\/\d{4} - [\d:.]+:\s*/, '');

  const gameOver = lines.map(body).find((l) => l.startsWith('Game Over:'));
  const finalScore = gameOver?.match(/score (\d+):(\d+)/);

  type Block = { endLine: number; score: { ct: number; t: number }; players: Record<string, { kills: number; deaths: number; assists: number }> };
  let last: Block | null = null;
  let current: string[] | null = null;
  lines.forEach((raw, i) => {
    const l = body(raw);
    if (l.startsWith('JSON_BEGIN{')) { current = []; return; }
    if (!current) return;
    if (!l.startsWith('}}JSON_END')) { current.push(l); return; }

    const block: string[] = current;
    current = null;
    const str = (key: string) => block.find((b) => b.startsWith(`"${key}"`))?.match(/:\s*"(.*)"/)?.[1] ?? '';
    const fields = str('fields').split(',').map((f) => f.trim());
    const players: Block['players'] = {};
    for (const b of block) {
      const m = b.match(/^"player_\d+"\s*:\s*"(.*)"/);
      if (!m) continue;
      const values = m[1].split(',').map((v) => v.trim());
      const accountId = values[fields.indexOf('accountid')];
      if (accountId === '0') continue; // GOTV / unassigned slot
      const get = (f: string) => Number(values[fields.indexOf(f)]);
      players[`[U:1:${accountId}]`] = { kills: get('kills'), deaths: get('deaths'), assists: get('assists') };
    }
    const hasStats = Object.values(players).some((p) => p.kills + p.deaths + p.assists > 0);
    if (hasStats) last = { endLine: i + 1, score: { ct: Number(str('score_ct')), t: Number(str('score_t')) }, players };
  });

  const block = last as Block | null;
  return {
    finalScore: finalScore ? { ct: Number(finalScore[1]), t: Number(finalScore[2]) } : null,
    endLine: block?.endLine ?? 0,
    scoreAtBlock: block?.score ?? null,
    players: block?.players ?? {},
  };
}

describe('Fixtures Golden Master Suite — End-to-End Match Replays (Raw Logs & JSON Scenarios)', () => {
  const outcomes = JSON.parse(fs.readFileSync(outcomesPath, 'utf8')) as Record<string, any>;
  const fixtures = listFixtureFiles();

  it('registers every fixture file of test/fixtures in expected-outcomes.json', () => {
    if (process.env.UPDATE_GOLDEN === '1') return;
    expect(Object.keys(outcomes).sort()).toEqual(fixtures.map((f) => f.id));
  });

  it.each(fixtures)(
    'replays $id and matches all expected score, phase, sides, streaks, roster and player K/D/A/Score metrics',
    async ({ id: fixtureId, type }) => {
      const { snapshot, allPlayers, totals, playersBySteamId } = await replayFixture(fixtureId, type);

      if (process.env.UPDATE_GOLDEN === '1') {
        outcomes[fixtureId] = {
          type,
          label: outcomes[fixtureId]?.label ?? fixtureId,
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
          players: playersBySteamId,
        };
        const sorted = Object.fromEntries(Object.entries(outcomes).sort(([a], [b]) => a.localeCompare(b)));
        fs.writeFileSync(outcomesPath, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
      }
      const expected = outcomes[fixtureId];
      expect(expected).toBeDefined();

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
      expect(playersBySteamId).toEqual(expected.players);
      for (const p of allPlayers) {
        const expectedFormulaScore = p.kills * 2 + p.headshots + p.assists + p.plants * 2 + p.defuses * 2;
        expect(p.score).toBe(expectedFormulaScore);
        expect(p.flashAssists).toBeLessThanOrEqual(p.assists);
      }
    },
  );
});

/**
 * The Golden Master freezes GG-Core's CURRENT behaviour. This suite checks it against the TRUTH:
 * CS2's own final score and per-player K/D/A (last `round_stats` block of the raw log).
 * Applies to every raw-log fixture that still carries the round_stats JSON blocks.
 */
/**
 * Known divergences between GG-Core and CS2's round_stats (scores always match; only K/D/A differ).
 * Declared with `it.failing`: the suite stays green while the gap exists and FAILS as soon as GG-Core
 * matches CS2 for that fixture — then remove the entry. See the 2026-10-28 analysis:
 *  - bomb deaths: CS2 counts `was killed by the bomb` (+ its `suicide with "world"` twin) as ONE death,
 *    GG-Core counts none;
 *  - `suicide with "world"` right after disconnected/switched: CS2 counts a death, GG-Core does not;
 *  - teamkills: round_stats `kills` = enemy kills (no −1 per teamkill), GG-Core applies −1;
 *  - backup restore (mp_backup_restore_load_file): CS2 rolls player stats back to the restored round,
 *    GG-Core keeps the voided round's kills and counts the restore respawn as a death for everyone,
 *    and omits players who joined a team briefly then disconnected (CS2 keeps them at 0/1/0).
 */
const KNOWN_ORACLE_GAPS: Record<string, string> = {
  'gglan19_dust2_ot3_40rounds_anonymized.log': 'bomb death + suicide after leave not counted',
  'gglan19_inferno_ot1_teamkills_anonymized.log': 'teamkill −1 kill vs round_stats enemy kills; bomb death',
  'gglan19_match69_nuke_backup_restore_anonymized.log': 'stats not rolled back on backup restore',
  'gglan19_match85_inferno_double_restore_anonymized.log': 'stats not rolled back on backup restore; brief joiners (suicide after leave) missing',
  'gglan19_mirage_13-11_anonymized.log': 'bomb deaths not counted',
  'gglan19_overpass_13-5_anonymized.log': 'bomb death not counted',
};

describe('CS2 Oracle — GG-Core scoreboard equals CS2 end-of-match round_stats', () => {
  // Older fixtures had every round_stats accountid collapsed to one value by a former anonymizer:
  // they carry no usable truth (fewer than 2 distinct players) and are skipped.
  const withTruth = listFixtureFiles().filter(
    (f) => f.type === 'raw-log' && Object.keys(readCs2Truth(f.id).players).length >= 2,
  );

  it.each(withTruth)('$id: final score and score at the last round_stats match CS2', async ({ id, type }) => {
    const truth = readCs2Truth(id);

    // Final score (full replay) vs `Game Over` line
    const full = await replayFixture(id, type);
    expect(truth.finalScore).not.toBeNull();
    expect({ ct: full.snapshot.score.ct, t: full.snapshot.score.t }).toEqual(truth.finalScore);

    // Score at the instant of CS2's last round_stats block
    const { snapshot } = await replayFixture(id, type, { untilLine: truth.endLine });
    expect({ ct: snapshot.score.ct, t: snapshot.score.t }).toEqual(truth.scoreAtBlock);
  });

  /** Per-player deltas GG-Core − CS2 at the instant of CS2's last round_stats block (readable failure). */
  async function expectPlayersMatchCs2(id: string, type: FixtureType) {
    const truth = readCs2Truth(id);
    const { playersBySteamId } = await replayFixture(id, type, { untilLine: truth.endLine });

    const deltas: Record<string, string> = {};
    for (const [steamId, cs2] of Object.entries(truth.players)) {
      const p = playersBySteamId[steamId];
      if (!p) {
        // CS2 lists empty slots (spectator / coach) too: only players with stats must be on the scoreboard
        if (cs2.kills + cs2.deaths + cs2.assists > 0) deltas[steamId] = 'missing on GG-Core scoreboard';
        continue;
      }
      const d = { K: p.kills - cs2.kills, D: p.deaths - cs2.deaths, A: p.assists - cs2.assists };
      if (d.K || d.D || d.A) deltas[steamId] = `ΔK=${d.K} ΔD=${d.D} ΔA=${d.A} (CS2 ${cs2.kills}/${cs2.deaths}/${cs2.assists})`;
    }
    expect(deltas).toEqual({});
  }

  const matching = withTruth.filter((f) => !(f.id in KNOWN_ORACLE_GAPS));
  const gaps = withTruth.filter((f) => f.id in KNOWN_ORACLE_GAPS);

  if (matching.length) {
    it.each(matching)('$id: every player K/D/A matches CS2', ({ id, type }) => expectPlayersMatchCs2(id, type));
  }
  if (gaps.length) {
    it.failing.each(gaps)('$id: K/D/A — KNOWN GAP (remove from KNOWN_ORACLE_GAPS once fixed)', ({ id, type }) =>
      expectPlayersMatchCs2(id, type),
    );
  }
});
