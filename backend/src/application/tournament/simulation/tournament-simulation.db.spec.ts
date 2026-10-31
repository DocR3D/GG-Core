import 'dotenv/config';
import { PrismaService } from '@adapters/database/prisma.service';
import { TournamentPersistenceService } from '@adapters/database/tournament-persistence.service';
import { TournamentStagesService } from '../tournament-stages.service';
import { TournamentSimulationService, TournamentScenario } from './tournament-simulation.service';

/** Simulated tournament on a REAL PostgreSQL - `make test-db` (DB_IT=1). */
const describeDb = process.env.DB_IT === '1' ? describe : describe.skip;

describeDb('Tournament simulation - real PostgreSQL', () => {
  const prisma = new PrismaService();
  const stages = new TournamentStagesService(prisma);
  const sim = new TournamentSimulationService(prisma, stages, new TournamentPersistenceService(prisma));
  const scenario: TournamentScenario = {
    name: `IT sim ${Date.now()}`,
    teams: 8,
    playersPerTeam: 5,
    stages: [
      { key: 'groups', name: 'Poules', type: 'ROUND_ROBIN', order: 1, groupCount: 2, format: 'BO1' },
      { key: 'elite', name: 'Élite', type: 'DOUBLE_ELIM', order: 2, formats: { upper: 'BO3', lower: 'BO1', grandFinal: 'BO3' } },
    ],
    qualify: { from: 'groups', rules: [{ ranks: [1, 2, 3, 4], to: 'elite' }] },
    results: { upsetRate: 0.25, randomSeed: 7, maps: ['de_mirage', 'de_nuke'] },
  };

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  it('plays a whole tournament (groups → double elimination) with fake players / stats, then deletes it cleanly', async () => {
    let run = await sim.start({ scenario, delayMs: 0, parallel: 4 });
    for (let i = 0; i < 200 && (run.status === 'running' || run.status === 'paused'); i++) {
      await new Promise((r) => setTimeout(r, 100));
      run = sim.getRun(run.id);
    }
    expect(run.status).toBe('done');
    expect(run.seriesPlayed).toBe(12 + 14); // 2 groups of 4 = 12, bracket of 8 = 2n-2 = 14

    const t = await prisma.tournament.findUniqueOrThrow({ where: { id: run.tournamentId } });
    expect(t.status).toBe('COMPLETED');
    const gf = await prisma.match.findFirstOrThrow({ where: { tournamentId: t.id, bracketType: 'FINAL' }, include: { maps: true } });
    expect(gf.status).toBe('FINISHED');
    expect(gf.maps.every((m) => m.resultSource === 'MANUAL' && m.reportedBy === 'simulation')).toBe(true);

    // 10 stat lines (5 players x 2 teams) per game, kills of one team = deaths of the other
    const game = gf.maps[0];
    const stats = await prisma.playerMapStats.findMany({ where: { matchMapId: game.id } });
    expect(stats).toHaveLength(10);
    const byTeam = (id: string) => stats.filter((s) => s.teamId === id);
    const sum = (rows: typeof stats, k: 'kills' | 'deaths') => rows.reduce((a, r) => a + r[k], 0);
    expect(sum(byTeam(gf.teamHomeId!), 'kills')).toBe(sum(byTeam(gf.teamAwayId!), 'deaths'));

    const detail = await stages.getMatchDetail(gf.id);
    expect(detail.games[0].stats).toHaveLength(10);

    // Same scenario again: replaces the previous tournament
    // (started paused: it builds teams / players / stages, then blocks on its first LIVE game)
    const rerun = await sim.start({ scenario, delayMs: 0, parallel: 4, paused: true });
    expect(await prisma.tournament.findUnique({ where: { id: t.id } })).toBeNull();
    for (let i = 0; i < 100; i++) {
      if (await prisma.matchMap.count({ where: { match: { tournamentId: rerun.tournamentId }, status: 'LIVE' } })) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // A third start while that one is still active is refused (it would delete the tournament being played)
    await expect(sim.start({ scenario, delayMs: 0 })).rejects.toMatchObject({ code: 'conflict' });
    sim.control(rerun.id, 'stop');
    for (let i = 0; i < 50 && sim.getRun(rerun.id).status !== 'stopped'; i++) await new Promise((r) => setTimeout(r, 100));
    expect(sim.getRun(rerun.id).status).toBe('stopped');

    const deleted = await stages.deleteTournament(rerun.tournamentId);
    expect(deleted.teamsDeleted).toBe(8);
    expect(deleted.playersDeleted).toBe(40);
  });

  it('deterministic: the same scenario gives the same tournament, whatever the number of parallel series', async () => {
    const signature = async (parallel: number) => {
      let run = await sim.start({ scenario: { ...scenario, name: `IT det ${Date.now()}` }, delayMs: 0, parallel, withStats: false });
      for (let i = 0; i < 300 && (run.status === 'running' || run.status === 'paused'); i++) {
        await new Promise((r) => setTimeout(r, 100));
        run = sim.getRun(run.id);
      }
      expect(run.status).toBe('done');
      const matches = await prisma.match.findMany({
        where: { tournamentId: run.tournamentId },
        include: { teamHome: true, teamAway: true, winner: true, maps: { orderBy: { mapOrder: 'asc' } }, group: true },
      });
      const sig = matches
        .map((m) => `${m.group?.name ?? ''}${m.bracketType}${m.roundNumber}#${m.bracketPosition} ${m.teamHome?.name}-${m.teamAway?.name} ` +
          `${m.scoreHome}:${m.scoreAway} ${m.winner?.name} [${m.maps.map((g) => `${g.mapName} ${g.scoreHome}-${g.scoreAway}`).join(',')}]`)
        .sort();
      await stages.deleteTournament(run.tournamentId);
      return sig;
    };
    const sequential = await signature(1);
    const parallel = await signature(8);
    expect(parallel).toEqual(sequential);
  });

  it('prepares a tournament to test: stops at the chosen step (qualified = brackets generated, nothing played in them)', async () => {
    const qualified = await sim.prepare({ teams: 10, groupCount: 2, after: 'two', stopAt: 'qualified' });
    const done = await sim.prepare({ teams: 4, groupCount: 2, after: 'two', topPerGroup: 1, stopAt: 'done', withPlayers: false });
    try {
      expect(qualified.reached).toBe('qualified');
      const stagesOf = await prisma.stage.findMany({ where: { tournamentId: qualified.tournamentId }, orderBy: { order: 'asc' }, include: { teams: true, matches: true } });
      expect(stagesOf.map((x) => [x.name, x.teams.length])).toEqual([['Poules', 10], ['Élite', 6], ['Amateur', 4]]);
      expect(stagesOf[0].matches.every((m) => m.status === 'FINISHED')).toBe(true);
      expect(stagesOf.slice(1).every((x) => x.matches.length > 0 && x.matches.every((m) => m.status !== 'FINISHED'))).toBe(true);
      // fake players, the first of each team is its captain; the map pool is set
      const captains = await prisma.teamRoster.count({ where: { tournamentId: qualified.tournamentId, isCaptain: true } });
      expect(captains).toBe(10);
      const t = await prisma.tournament.findUniqueOrThrow({ where: { id: qualified.tournamentId } });
      expect((t.settings as any).veto.mapPool).toHaveLength(7);

      // 4 teams, 1 per group to the Élite: two finals of 2 teams, played to the end
      expect(done.reached).toBe('done');
      const finals = await prisma.match.findMany({ where: { tournamentId: done.tournamentId, bracketType: 'FINAL' } });
      expect(finals).toHaveLength(2);
      expect(finals.every((m) => m.status === 'FINISHED')).toBe(true);
      expect((await prisma.tournament.findUniqueOrThrow({ where: { id: done.tournamentId } })).status).toBe('COMPLETED');
    } finally {
      await stages.deleteTournament(qualified.tournamentId);
      await stages.deleteTournament(done.tournamentId);
    }
  });

  it('prepares a tournament played live: answers at once, then plays game by game in the background', async () => {
    const prepared = await sim.prepare({ teams: 4, groupCount: 1, after: 'none', stopAt: 'groups_played', pace: 'live', delayMs: 200, parallel: 2, results: 'random', withPlayers: false });
    try {
      expect(prepared.reached).toBe('running');
      let run = sim.getRun(prepared.runId!);
      expect(run.status).toBe('running');
      for (let i = 0; i < 100 && run.status === 'running'; i++) {
        await new Promise((r) => setTimeout(r, 100));
        run = sim.getRun(prepared.runId!);
      }
      expect(run.status).toBe('done');
      expect(run.seriesPlayed).toBe(6);
      const matches = await prisma.match.findMany({ where: { tournamentId: prepared.tournamentId } });
      expect(matches.every((m) => m.status === 'FINISHED')).toBe(true);
    } finally {
      await stages.deleteTournament(prepared.tournamentId);
    }
  });
});
