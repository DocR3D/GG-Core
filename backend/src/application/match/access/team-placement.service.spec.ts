import { TeamPlacementService } from './team-placement.service';
import { toLogSteamId } from './match-access.service';
import { FakeRedis } from '../../../testing/fake-redis';
import { redisConst } from '@app/match/state/redis.keys';

const M = 'm-1';
const SRV = 'srv-a';

// Four players per team, in the two SteamID forms the site and the game logs use.
const HOME = ['76561198000000001', '76561198000000002'];
const AWAY = ['76561198000000011', '76561198000000012'];
const log = (id: string) => toLogSteamId(id) as string;

type Sides = { home: 'CT' | 'T'; away: 'CT' | 'T' };

function setup(opts: { fixedSides?: boolean; sides?: Sides | null; homeName?: string; awayName?: string } = {}) {
  const redis = new FakeRedis();
  const said: string[] = [];
  const rcons: string[] = [];
  const pushed: Array<{ event: string; payload: Record<string, any>; room?: string }> = [];
  const cmds = {
    say: jest.fn((_srv: string, text: string) => { said.push(text); return Promise.resolve(); }),
    rcon: jest.fn((a: { command: string }) => { rcons.push(a.command); return Promise.resolve(); }),
  };
  const state = {
    getSettings: jest.fn().mockResolvedValue(opts.fixedSides === false ? { fixedSides: false } : { fixedSides: true }),
    getSides: jest.fn().mockResolvedValue(opts.sides === undefined ? { home: 'CT', away: 'T' } : opts.sides),
    getSnapshot: jest.fn().mockResolvedValue({ teams: { home_name: opts.homeName ?? 'Alpha', away_name: opts.awayName ?? 'Bravo' } }),
  };
  const ws = { push: jest.fn((_m: string, event: string, payload: Record<string, any>, room?: string) => { pushed.push({ event, payload, room }); }) };
  const svc = new TeamPlacementService(redis as never, cmds as never, state as never, ws as never);
  /** Who stands on which side right now, as the "switched from team" log lines would have recorded it. */
  const place = async (players: Record<string, string>) => {
    for (const [id, side] of Object.entries(players)) await svc.track(SRV, { steamId: id, name: `P${id.slice(-2)}` }, side);
  };
  return { redis, svc, said, rcons, pushed, place, state };
}

/** Both rosters registered, everyone on the side given for each team. */
async function lineupsAndPlace(h: ReturnType<typeof setup>, homeOn: string, awayOn: string) {
  await h.svc.setLineups(M, HOME, AWAY);
  await h.place({ ...Object.fromEntries(HOME.map((id) => [id, homeOn])), ...Object.fromEntries(AWAY.map((id) => [id, awayOn])) });
}

describe('TeamPlacementService', () => {
  describe('rosters', () => {
    it('stores each roster as log SteamIDs, without duplicates or ids it cannot read, replacing the previous one', async () => {
      const { svc, redis } = setup();
      await svc.setLineups(M, [HOME[0], HOME[0], 'not-an-id', ''], [AWAY[0]]);
      expect(await redis.lrange(redisConst.lineupHome(M), 0, -1)).toEqual([log(HOME[0])]);
      expect(await redis.lrange(redisConst.lineupAway(M), 0, -1)).toEqual([log(AWAY[0])]);

      await svc.setLineups(M, HOME, []);
      expect(await redis.lrange(redisConst.lineupHome(M), 0, -1)).toEqual(HOME.map(log));
      expect(await redis.lrange(redisConst.lineupAway(M), 0, -1)).toEqual([]); // an empty roster leaves nothing behind
    });
  });

  describe('following the players', () => {
    it('keeps the side of a player per server, forgets him when he leaves, ignores bots and a missing server', async () => {
      const { svc, redis } = setup();
      await svc.track(SRV, { steamId: HOME[0], name: 'Alice' }, 'CT');
      expect(JSON.parse((await redis.hgetall(redisConst.serverPlayerSides(SRV)))[log(HOME[0])])).toEqual({ side: 'CT', name: 'Alice' });

      await svc.track(SRV, { steamId: HOME[0], name: 'Alice' }, 'TERRORIST'); // changed side
      expect(JSON.parse((await redis.hgetall(redisConst.serverPlayerSides(SRV)))[log(HOME[0])]).side).toBe('TERRORIST');

      await svc.track('srv-b', { steamId: HOME[0] }, 'CT'); // another server: a separate record
      expect(Object.keys(await redis.hgetall(redisConst.serverPlayerSides('srv-b')))).toHaveLength(1);

      await svc.track(SRV, { steamId: HOME[0] }, null); // left
      expect(await redis.hgetall(redisConst.serverPlayerSides(SRV))).toEqual({});

      await svc.track(SRV, { steamId: 'BOT' }, 'CT');
      await svc.track(undefined, { steamId: HOME[1] }, 'CT');
      expect(await redis.hgetall(redisConst.serverPlayerSides(SRV))).toEqual({});
    });
  });

  describe('check before the live', () => {
    it('lets the live start without any check when the sides were not chosen in the veto, or none is recorded', async () => {
      const free = setup({ fixedSides: false });
      expect(await free.svc.checkBeforeLive(M, SRV)).toBe(true);
      expect(free.rcons).toEqual([]);
      expect(free.said).toEqual([]);

      const none = setup({ sides: null });
      await lineupsAndPlace(none, 'CT', 'TERRORIST');
      expect(await none.svc.checkBeforeLive(M, SRV)).toBe(true);
      expect(none.rcons).toEqual([]);
    });

    it('everybody on the right side: live goes on, and the team names are set on the side they start', async () => {
      const h = setup({ sides: { home: 'CT', away: 'T' } });
      await lineupsAndPlace(h, 'CT', 'TERRORIST');

      expect(await h.svc.checkBeforeLive(M, SRV)).toBe(true);

      expect(h.rcons).toEqual(['mp_teamname_1 "Alpha"', 'mp_teamname_2 "Bravo"']); // 1 = starts CT
      expect(h.said).toEqual([]);
      expect(h.pushed).toEqual([]);
    });

    it('home starting T: the first team name goes to the away team (the one on CT)', async () => {
      const h = setup({ sides: { home: 'T', away: 'CT' } });
      await lineupsAndPlace(h, 'TERRORIST', 'CT');

      expect(await h.svc.checkBeforeLive(M, SRV)).toBe(true);

      expect(h.rcons).toEqual(['mp_teamname_1 "Bravo"', 'mp_teamname_2 "Alpha"']);
    });

    it('both teams on the wrong side: swaps them with mp_swapteams, says so, then sets the names after the swap', async () => {
      const h = setup({ sides: { home: 'CT', away: 'T' } });
      await lineupsAndPlace(h, 'TERRORIST', 'CT'); // all inverted

      expect(await h.svc.checkBeforeLive(M, SRV)).toBe(true);

      expect(h.rcons).toEqual(['mp_swapteams', 'mp_teamname_1 "Alpha"', 'mp_teamname_2 "Bravo"']);
      expect(h.said).toEqual(['[GG-Core] Équipes inversées : échange des camps (Alpha en CT).']);
    });

    it('some players on the wrong side: the live waits, the chat names them, the admins are alerted, nothing is sent to the game', async () => {
      const h = setup({ sides: { home: 'CT', away: 'T' } });
      await lineupsAndPlace(h, 'CT', 'TERRORIST');
      await h.place({ [HOME[1]]: 'TERRORIST' }); // one home player on the wrong side

      expect(await h.svc.checkBeforeLive(M, SRV)).toBe(false);

      expect(h.rcons).toEqual([]);
      expect(h.said).toEqual([
        '[GG-Core] Mauvais camp : Alpha doit jouer CT, Bravo T.',
        `[GG-Core] À changer de camp : P${HOME[1].slice(-2)}. Retapez !ready ensuite.`,
      ]);
      expect(h.pushed).toHaveLength(1);
      expect(h.pushed[0]).toMatchObject({ event: 'sides:misplaced', room: 'admin' });
      expect(h.pushed[0].payload.expected).toEqual({ home: 'CT', away: 'T' });
      expect(h.pushed[0].payload.misplaced).toEqual([
        expect.objectContaining({ steamId: log(HOME[1]), team: 'home', on: 'T', expected: 'CT', name: `P${HOME[1].slice(-2)}` }),
      ]);
    });

    it('falls back on the SteamID when a misplaced player has no known name', async () => {
      const h = setup();
      await h.svc.setLineups(M, HOME, AWAY);
      await h.place({ [AWAY[0]]: 'TERRORIST', [HOME[0]]: 'CT', [HOME[1]]: 'CT' });
      await h.redis.hset(redisConst.serverPlayerSides(SRV), log(HOME[1]), JSON.stringify({ side: 'TERRORIST' })); // no name stored

      expect(await h.svc.checkBeforeLive(M, SRV)).toBe(false);
      expect(h.said[1]).toContain(log(HOME[1]));
    });

    it('a team nobody of which is on a side cannot be checked: the live goes on and the admins are told it was not checked', async () => {
      const h = setup();
      await h.svc.setLineups(M, HOME, AWAY);
      await h.place({ [HOME[0]]: 'CT', [HOME[1]]: 'CT' }); // nobody of the away team yet

      expect(await h.svc.checkBeforeLive(M, SRV)).toBe(true);

      expect(h.pushed).toEqual([expect.objectContaining({ event: 'sides:unchecked', room: 'admin' })]);
      expect(h.pushed[0].payload.reason).toBe('a team has no player on a side');
      expect(h.rcons).toHaveLength(2); // the names are set all the same
    });

    it('a roster without any usable SteamID cannot be checked either', async () => {
      const h = setup();
      await h.svc.setLineups(M, ['x'], AWAY);
      expect(await h.svc.checkBeforeLive(M, SRV)).toBe(true);
      expect(h.pushed[0].payload.reason).toBe('a roster has no SteamID');
    });

    it('spectators and players not on a side are not counted as misplaced', async () => {
      const h = setup({ sides: { home: 'CT', away: 'T' } });
      await lineupsAndPlace(h, 'CT', 'TERRORIST');
      await h.place({ [HOME[1]]: 'Spectator' });

      expect(await h.svc.checkBeforeLive(M, SRV)).toBe(true);
      expect(h.said).toEqual([]);
    });

    it('survives a damaged record of the game servers side list', async () => {
      const h = setup();
      await lineupsAndPlace(h, 'CT', 'TERRORIST');
      await h.redis.hset(redisConst.serverPlayerSides(SRV), 'garbage', '{not json');

      expect(await h.svc.checkBeforeLive(M, SRV)).toBe(true);
    });

    it('cleans team names for the game console (quotes, backslashes) and falls back on Domicile / Extérieur', async () => {
      const dirty = setup({ homeName: 'Les "Pros" \\ FR', awayName: '' });
      await lineupsAndPlace(dirty, 'CT', 'TERRORIST');
      await dirty.svc.checkBeforeLive(M, SRV);
      expect(dirty.rcons).toEqual(['mp_teamname_1 "Les Pros  FR"', 'mp_teamname_2 "Extérieur"']);
    });
  });
});
