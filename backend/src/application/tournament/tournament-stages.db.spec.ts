import 'dotenv/config';
import { PrismaService } from '@adapters/database/prisma.service';
import { TournamentPersistenceService } from '@adapters/database/tournament-persistence.service';
import { TournamentStagesService } from './tournament-stages.service';

/**
 * Group stage on a REAL PostgreSQL: generation, results entered by an admin, standings, qualification
 * to Elite / Amateur. Disabled by default — `make test-db` (DB_IT=1, schema pushed).
 */
const describeDb = process.env.DB_IT === '1' ? describe : describe.skip;

describeDb('Group stage — real PostgreSQL', () => {
  const prisma = new PrismaService();
  const persistence = new TournamentPersistenceService(prisma);
  const stages = new TournamentStagesService(prisma);
  const created: { tournamentId?: string; teamIds: string[] } = { teamIds: [] };

  beforeAll(() => prisma.$connect());
  afterAll(async () => {
    if (created.tournamentId) await prisma.tournament.deleteMany({ where: { id: created.tournamentId } });
    await prisma.team.deleteMany({ where: { id: { in: created.teamIds } } });
    await prisma.$disconnect();
  });

  it('8 teams, 2 groups → standings → ranks 1-2 to Elite, 3-4 to Amateur (crossed seeds)', async () => {
    const tournament = await stages.createTournament({ name: `IT groups ${Date.now()}` });
    created.tournamentId = tournament.id;
    expect(tournament.game).toBe('cs2');
    const teams = await stages.createTeams(Array.from({ length: 8 }, (_, i) => `IT Seed ${i + 1}`));
    created.teamIds = teams.map((t) => t.id);
    const seed = (id: string) => created.teamIds.indexOf(id) + 1;

    const groupsStage = await stages.createStage(tournament.id, { name: 'Poules', type: 'ROUND_ROBIN', order: 1 });
    const elite = await stages.createStage(tournament.id, { name: 'Élite', type: 'DOUBLE_ELIM', order: 2 });
    const amateur = await stages.createStage(tournament.id, { name: 'Amateur', type: 'DOUBLE_ELIM', order: 3 });

    const generated = await stages.generateGroups(groupsStage.id, { teamIds: created.teamIds, groupCount: 2 });
    expect(generated.groups.map((g) => g.standings.map((r) => seed(r.teamId)))).toEqual([[1, 4, 5, 8], [2, 3, 6, 7]]);
    expect(generated.groups.map((g) => g.matchesTotal)).toEqual([6, 6]);

    // Qualifying before the end is refused
    await expect(
      stages.qualify(groupsStage.id, { rules: [{ ranks: [1, 2], targetStageId: elite.id }] }),
    ).rejects.toMatchObject({ code: 'conflict' });

    // Admin enters every group match: the better seed always wins 13-x
    const matches = await prisma.match.findMany({ where: { stageId: groupsStage.id } });
    for (const m of matches) {
      const homeBetter = seed(m.teamHomeId!) < seed(m.teamAwayId!);
      await persistence.recordManualGameResult({
        matchId: m.id, mapOrder: 1, scoreHome: homeBetter ? 13 : 7, scoreAway: homeBetter ? 7 : 13, reportedBy: 'admin-it',
      });
    }

    const standings = await stages.getStandings(groupsStage.id);
    expect(standings.groups.map((g) => g.standings.map((r) => [seed(r.teamId), r.points]))).toEqual([
      [[1, 9], [4, 6], [5, 3], [8, 0]],
      [[2, 9], [3, 6], [6, 3], [7, 0]],
    ]);

    const qualified = await stages.qualify(groupsStage.id, {
      rules: [
        { ranks: [1, 2], targetStageId: elite.id },
        { ranks: [3, 4], targetStageId: amateur.id },
      ],
    });
    // Crossed: 1st A, 1st B, 2nd A, 2nd B
    expect(qualified.map((q) => [q.name, q.seeds.map(seed)])).toEqual([
      ['Élite', [1, 2, 4, 3]],
      ['Amateur', [5, 6, 8, 7]],
    ]);
    const eliteTeams = await prisma.stageTeam.findMany({ where: { stageId: elite.id }, orderBy: { seed: 'asc' } });
    expect(eliteTeams.map((t) => seed(t.teamId))).toEqual([1, 2, 4, 3]);

    // Groups cannot be regenerated once matches are played
    await expect(stages.generateGroups(groupsStage.id, { groupCount: 2 })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('double elimination of 6 teams (byes): generated, played to the end by admin entries, final ranking', async () => {
    const tournament = await prisma.tournament.findFirstOrThrow({ where: { id: created.tournamentId } });
    const stage = await stages.createStage(tournament.id, { name: 'Élite IT', type: 'DOUBLE_ELIM', order: 10 });
    const six = created.teamIds.slice(0, 6);
    const seed = (id: string | null) => six.indexOf(id!) + 1;

    const gen = await stages.generateDoubleElimination(stage.id, { teamIds: six });
    expect(gen).toEqual(expect.objectContaining({ teams: 6, matches: 10, formats: { upper: 'BO1', lower: 'BO1', grandFinal: 'BO3' } }));
    const gf = await prisma.match.findFirstOrThrow({ where: { stageId: stage.id, bracketType: 'FINAL' } });
    expect(gf.advantageHome).toBe(1);
    // seeds 1 and 2 are exempted from the first round: they already sit in round 2
    const r2 = await prisma.match.findMany({ where: { stageId: stage.id, bracketType: 'UPPER', roundNumber: 2 } });
    expect(r2.flatMap((m) => [m.teamHomeId, m.teamAwayId]).filter(Boolean).map(seed).sort()).toEqual([1, 2]);

    // Play everything: the better seed always wins, one map per game
    for (let guard = 0; guard < 20; guard++) {
      const ready = await prisma.match.findMany({
        where: { stageId: stage.id, status: { not: 'FINISHED' }, teamHomeId: { not: null }, teamAwayId: { not: null } },
      });
      if (!ready.length) break;
      for (const m of ready) {
        const homeWins = seed(m.teamHomeId) < seed(m.teamAwayId);
        await persistence.recordManualGameResult({
          matchId: m.id, mapOrder: 1, scoreHome: homeWins ? 13 : 4, scoreAway: homeWins ? 4 : 13, reportedBy: 'admin-it',
        });
      }
    }
    const all = await prisma.match.findMany({ where: { stageId: stage.id } });
    expect(all.every((m) => m.status === 'FINISHED')).toBe(true);
    const final = all.find((m) => m.bracketType === 'FINAL')!;
    // Seed 1 won the upper bracket: in the grand final at HOME with its map advantage, one map was enough
    expect(seed(final.teamHomeId)).toBe(1);
    expect(seed(final.winnerId)).toBe(1);
    expect([final.scoreHome, final.scoreAway]).toEqual([2, 0]);

    const overview = await stages.getOverview(tournament.id);
    const ranking = overview.stages.find((s) => s.name === 'Élite IT')!.ranking!;
    const byPlace = (p: string) => ranking.filter((r) => r.place === p).map((r) => r.team).sort();
    expect(byPlace('1')).toEqual(['IT Seed 1']);
    expect(byPlace('2')).toEqual(['IT Seed 2']);
    expect(byPlace('3')).toEqual(['IT Seed 3']);
    expect(ranking).toHaveLength(6);

    // Match detail: the grand final comes from the upper (home) and lower (away) finals and leads nowhere
    const gfDetail = await stages.getMatchDetail(final.id);
    expect(gfDetail.label).toBe('GF');
    expect(gfDetail.from.map((f) => [f.slot, f.what, f.match.label[0]])).toEqual([['HOME', 'Vainq.', 'H'], ['AWAY', 'Vainq.', 'B']]);
    expect(gfDetail.next).toEqual([]);
    expect(gfDetail.games.every((g) => g.source === 'MANUAL' && g.reportedBy === 'admin-it')).toBe(true);
    // an upper match sends its winner up and its loser down
    const upper = all.find((m) => m.bracketType === 'UPPER' && m.roundNumber === 1)!;
    const upperDetail = await stages.getMatchDetail(upper.id);
    expect(upperDetail.next.map((n) => [n.what, n.match.label[0]])).toEqual([['vainqueur', 'H'], ['perdant', 'B']]);

    await expect(stages.generateDoubleElimination(stage.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('draws: allowed in groups (1 point each), refused in a bracket', async () => {
    const t = await stages.createTournament({ name: `IT draws ${Date.now()}` });
    const teams = await stages.createTeams(['IT D1', 'IT D2', 'IT D3']);
    const groups = await stages.createStage(t.id, { name: 'P', type: 'ROUND_ROBIN', order: 1 });
    const bracket = await stages.createStage(t.id, { name: 'A', type: 'DOUBLE_ELIM', order: 2 });
    try {
      await stages.generateGroups(groups.id, { teamIds: teams.map((x) => x.id), groupCount: 1 });
      const groupMatch = await prisma.match.findFirstOrThrow({ where: { stageId: groups.id } });
      await persistence.recordManualGameResult({ matchId: groupMatch.id, mapOrder: 1, scoreHome: 12, scoreAway: 12, reportedBy: 'admin-it' });
      const st = await stages.getStandings(groups.id);
      const drawn = st.groups[0].standings.filter((r) => r.draws === 1);
      expect(drawn.map((r) => r.points)).toEqual([1, 1]);

      await stages.generateDoubleElimination(bracket.id, { teamIds: teams.map((x) => x.id) });
      const ready = await prisma.match.findFirstOrThrow({
        where: { stageId: bracket.id, teamHomeId: { not: null }, teamAwayId: { not: null } },
      });
      await expect(
        persistence.recordManualGameResult({ matchId: ready.id, mapOrder: 1, scoreHome: 12, scoreAway: 12, reportedBy: 'admin-it' }),
      ).rejects.toMatchObject({ code: 'invalid' });
    } finally {
      await stages.deleteTournament(t.id);
    }
  });

  it('deleting a tournament removes its stages / matches and the teams that play nowhere else', async () => {
    const other = await stages.createTournament({ name: `IT other ${Date.now()}` });
    const doomed = await stages.createTournament({ name: `IT doomed ${Date.now()}` });
    const [shared, own1, own2] = await stages.createTeams(['IT shared', 'IT own 1', 'IT own 2']);
    const s1 = await stages.createStage(other.id, { name: 'P', type: 'ROUND_ROBIN', order: 1 });
    await prisma.stageTeam.create({ data: { stageId: s1.id, teamId: shared.id, seed: 1 } });
    const s2 = await stages.createStage(doomed.id, { name: 'P', type: 'ROUND_ROBIN', order: 1 });
    await stages.generateGroups(s2.id, { teamIds: [shared.id, own1.id, own2.id], groupCount: 1 });

    const res = await stages.deleteTournament(doomed.id);
    expect(res).toEqual({ deleted: doomed.name, teamsDeleted: 2, playersDeleted: 0 });
    expect(await prisma.team.count({ where: { id: { in: [own1.id, own2.id] } } })).toBe(0);
    expect(await prisma.team.findUnique({ where: { id: shared.id } })).not.toBeNull(); // still in the other tournament
    expect(await prisma.match.count({ where: { tournamentId: doomed.id } })).toBe(0);

    await stages.deleteTournament(other.id);
    expect(await prisma.team.findUnique({ where: { id: shared.id } })).toBeNull();
  });
});
