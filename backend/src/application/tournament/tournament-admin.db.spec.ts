import 'dotenv/config';
import { PrismaService } from '@adapters/database/prisma.service';
import { TournamentPersistenceService } from '@adapters/database/tournament-persistence.service';
import { TournamentStagesService } from './tournament-stages.service';
import { TournamentAdminService } from './tournament-admin.service';
import { VetoService } from './veto.service';

/**
 * Admin operations of the LAN day on a REAL PostgreSQL, on an 8-team double elimination: forfeit, format on the
 * fly, team replaced, bonus matches (fun / for 7th place). Disabled by default - `make test-db` (DB_IT=1).
 */
const describeDb = process.env.DB_IT === '1' ? describe : describe.skip;

describeDb('Admin operations - real PostgreSQL', () => {
  const prisma = new PrismaService();
  const stages = new TournamentStagesService(prisma);
  const persistence = new TournamentPersistenceService(prisma);
  const veto = new VetoService(prisma);
  const admin = new TournamentAdminService(prisma, persistence, veto);
  const created: { tournamentId?: string; teamIds: string[] } = { teamIds: [] };

  beforeAll(() => prisma.$connect());
  afterAll(async () => {
    if (created.tournamentId) await prisma.tournament.deleteMany({ where: { id: created.tournamentId } });
    await prisma.team.deleteMany({ where: { id: { in: created.teamIds } } });
    await prisma.$disconnect();
  });

  const match = (id: string) => prisma.match.findUniqueOrThrow({ where: { id }, include: { maps: true } });
  const playable = (tournamentId: string) =>
    prisma.match.findMany({
      where: { tournamentId, stageId: { not: null }, status: { not: 'FINISHED' }, teamHomeId: { not: null }, teamAwayId: { not: null } },
      orderBy: [{ roundNumber: 'asc' }, { bracketPosition: 'asc' }],
    });

  it('forfeit, format on the fly, team replaced, then a bonus match settles 7th / 8th', async () => {
    const t = await stages.createTournament({ name: `IT admin ${Date.now()}` });
    created.tournamentId = t.id;
    const teams = await stages.createTeams(Array.from({ length: 9 }, (_, i) => `IT Admin ${i + 1}`));
    created.teamIds = teams.map((x) => x.id);
    const [spare, ...eight] = created.teamIds;
    const stage = await stages.createStage(t.id, { name: 'Élite', type: 'DOUBLE_ELIM', order: 1 });
    await stages.generateDoubleElimination(stage.id, { teamIds: eight, formats: { upper: 'BO1', lower: 'BO1', grandFinal: 'BO3' } });

    // --- Forfeit: the absent team loses, the other moves on (winner slot), the loser drops to the lower bracket
    const [first] = await playable(t.id);
    const f = await admin.forfeit(first.id, first.teamAwayId!, 'orga');
    expect(f).toMatchObject({ status: 'FINISHED', winnerId: first.teamHomeId, isForfeit: true, scoreHome: 1, scoreAway: 0 });
    // the map won by forfeit is a 13-0 game (counts in a group score difference)
    const forfeitGames = await prisma.matchMap.findMany({ where: { matchId: first.id } });
    expect(forfeitGames.map((g) => [g.scoreHome, g.scoreAway, g.status, g.reportedBy])).toEqual([[13, 0, 'FINISHED', 'forfait (orga)']]);
    const next = await match(first.nextMatchId!);
    expect([next.teamHomeId, next.teamAwayId]).toContain(first.teamHomeId);
    const lower = await match(first.loserNextMatchId!);
    expect([lower.teamHomeId, lower.teamAwayId]).toContain(first.teamAwayId);
    await expect(admin.forfeit(first.id, first.teamAwayId!)).rejects.toMatchObject({ code: 'conflict' });

    // --- Format on the fly: the lower bracket in BO3; the grand final (map advantage) refuses BO1
    const lowerBo3 = await admin.setFormat({ stageId: stage.id, bracket: 'LOWER', format: 'BO3' });
    expect(lowerBo3.changed.length).toBeGreaterThan(0);
    expect(lowerBo3.skipped).toEqual([]);
    const gfBo1 = await admin.setFormat({ stageId: stage.id, bracket: 'FINAL', format: 'BO1' });
    expect(gfBo1.skipped).toEqual([expect.objectContaining({ reason: expect.stringMatching(/advantage/) })]);
    const finished = await admin.setFormat({ matchIds: [first.id], format: 'BO3' });
    expect(finished.skipped).toEqual([{ matchId: first.id, reason: 'match already finished' }]);

    // --- Team replaced in a match not started: its veto (begun with the old team) is erased
    const [second] = await playable(t.id);
    await veto.setTournamentConfig(t.id, { mapPool: ['de_ancient', 'de_anubis', 'de_dust2'], sideMode: 'knife' });
    const adminActor = { admin: true, name: 'it' };
    await veto.chooseStart(second.id, adminActor, { teamId: second.teamHomeId! });
    await veto.playStep(second.id, adminActor, { map: 'de_ancient' });
    const replaced = await admin.replaceTeam(second.id, second.teamAwayId!, spare);
    expect(replaced).toMatchObject({ teamAwayId: spare, vetoReset: true });
    expect((await veto.getState(second.id)).phase).toBe('rps');
    await expect(admin.replaceTeam(first.id, first.teamHomeId!, spare)).rejects.toMatchObject({ code: 'conflict' }); // finished

    // --- Play the whole bracket (home wins every game)
    for (let guard = 0; guard < 40; guard++) {
      const todo = await playable(t.id);
      if (!todo.length) break;
      for (const m of todo) {
        const fresh = await match(m.id);
        if (fresh.status === 'FINISHED') continue;
        await persistence.recordManualGameResult({ matchId: m.id, mapOrder: fresh.maps.length + 1, scoreHome: 13, scoreAway: 5, reportedBy: 'it' });
      }
    }
    let ranking = (await stages.getOverview(t.id)).stages[0].ranking!;
    const shared = ranking.filter((r) => r.place === '7-8');
    expect(shared).toHaveLength(2);

    // --- Bonus matches: one for fun (draw allowed, out of the stats), one for 7th place (counts, needs a winner)
    const teamId = async (name: string) => (await prisma.team.findFirstOrThrow({ where: { name, id: { in: created.teamIds } } })).id;
    const [g, h] = [await teamId(shared[0].team), await teamId(shared[1].team)];
    await expect(admin.createBonusMatch(t.id, { homeTeamId: g, awayTeamId: g })).rejects.toMatchObject({ code: 'invalid' });
    const outsider = (await prisma.team.create({ data: { name: `IT Admin outsider ${Date.now()}` } })).id;
    created.teamIds.push(outsider);
    await expect(admin.createBonusMatch(t.id, { homeTeamId: g, awayTeamId: outsider })).rejects.toMatchObject({ code: 'invalid' });

    const fun = await admin.createBonusMatch(t.id, { homeTeamId: g, awayTeamId: h });
    expect([fun.placement, fun.countsInStats, fun.stageId]).toEqual([null, false, null]);
    await persistence.recordManualGameResult({ matchId: fun.id, mapOrder: 1, scoreHome: 12, scoreAway: 12, reportedBy: 'it' });
    expect((await match(fun.id)).status).toBe('FINISHED'); // a draw ends a fun match

    const for7th = await admin.createBonusMatch(t.id, { homeTeamId: g, awayTeamId: h, placement: 7 });
    expect([for7th.placement, for7th.countsInStats]).toEqual([7, true]);
    await expect(
      persistence.recordManualGameResult({ matchId: for7th.id, mapOrder: 1, scoreHome: 12, scoreAway: 12, reportedBy: 'it' }),
    ).rejects.toMatchObject({ code: 'invalid' }); // a placement match needs a winner
    await persistence.recordManualGameResult({ matchId: for7th.id, mapOrder: 1, scoreHome: 7, scoreAway: 13, reportedBy: 'it' });
    ranking = (await stages.getOverview(t.id)).stages[0].ranking!;
    expect(ranking.find((r) => r.team === shared[1].team)!.place).toBe('7'); // away won
    expect(ranking.find((r) => r.team === shared[0].team)!.place).toBe('8');

    // --- A bonus match can be removed until it starts; a bracket match never
    const extra = await admin.createBonusMatch(t.id, { homeTeamId: g, awayTeamId: h });
    await expect(admin.deleteBonusMatch(extra.id)).resolves.toEqual({ deleted: extra.id });
    await expect(admin.deleteBonusMatch(for7th.id)).rejects.toMatchObject({ code: 'conflict' });
    await expect(admin.deleteBonusMatch(first.id)).rejects.toMatchObject({ code: 'conflict' });
  });
});
