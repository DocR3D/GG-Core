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
});
