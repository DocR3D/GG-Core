import 'dotenv/config';
import { PrismaService } from '@adapters/database/prisma.service';
import { TournamentPersistenceService } from '@adapters/database/tournament-persistence.service';
import { TournamentStagesService } from './tournament-stages.service';
import { VETO_CLOSED, VetoService } from './veto.service';

/**
 * Group vetos one round at a time (decided with the user), on a REAL PostgreSQL: only round 1 is open, a later
 * round opens when the previous ones are finished or when an admin opens it; captains only see what they have
 * to play now. Disabled by default - `make test-db` (DB_IT=1).
 */
const describeDb = process.env.DB_IT === '1' ? describe : describe.skip;
const POOL = ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_train'];

describeDb('Veto by round - real PostgreSQL', () => {
  const prisma = new PrismaService();
  const stages = new TournamentStagesService(prisma);
  const veto = new VetoService(prisma);
  const persistence = new TournamentPersistenceService(prisma);
  const stamp = Date.now().toString().slice(-6);
  const created: { tournamentId?: string; teamIds: string[]; steamIds: string[] } = { teamIds: [], steamIds: [] };

  beforeAll(() => prisma.$connect());
  afterAll(async () => {
    if (created.tournamentId) await prisma.tournament.deleteMany({ where: { id: created.tournamentId } });
    await prisma.team.deleteMany({ where: { id: { in: created.teamIds } } });
    await prisma.player.deleteMany({ where: { steamId: { in: created.steamIds } } });
    await prisma.$disconnect();
  });

  it('opens the group vetos round by round, the admin can open a round earlier', async () => {
    const t = await stages.createTournament({ name: `IT veto rounds ${stamp}` });
    created.tournamentId = t.id;
    await veto.setTournamentConfig(t.id, { mapPool: POOL, sideMode: 'knife' });
    const teams = await stages.createTeams(['A', 'B', 'C'].map((x) => `IT Rounds ${x} ${stamp}`));
    created.teamIds = teams.map((x) => x.id);
    const steam = (i: number) => `[U:1:8${stamp}${i}]`;
    for (const [i, team] of teams.entries()) {
      created.steamIds.push(steam(i));
      await veto.addPlayers(t.id, team.id, [{ username: `cap${i}`, steamId: steam(i), captain: true }]);
    }
    const stage = await stages.createStage(t.id, { name: 'Poules', type: 'ROUND_ROBIN', order: 1 });
    await stages.generateGroups(stage.id, { teamIds: created.teamIds, groupCount: 1, format: 'BO1' });

    // 3 teams: 3 rounds of one match (one team rests)
    const matches = await prisma.match.findMany({ where: { stageId: stage.id }, orderBy: { roundNumber: 'asc' } });
    expect(matches.map((m) => m.roundNumber)).toEqual([1, 2, 3]);
    const [r1, r2, r3] = matches;

    expect((await veto.getState(r1.id)).phase).toBe('rps');
    const closed = await veto.getState(r2.id);
    expect(closed).toMatchObject({ phase: 'unavailable', reason: expect.stringContaining(`${VETO_CLOSED} 1`) });

    // a captain of the round-2 match cannot play it, and only sees what is open
    const cap = (teamId: string) => ({ steamId: steam(created.teamIds.indexOf(teamId)), admin: false, name: 'cap' });
    await expect(veto.playRps(r2.id, cap(r2.teamHomeId!), 'rock')).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining(VETO_CLOSED) });
    const both = created.teamIds.find((id) => [r1.teamHomeId, r1.teamAwayId].includes(id) && [r2.teamHomeId, r2.teamAwayId].includes(id))!;
    expect((await veto.listForCaptain(cap(both))).map((v) => v.matchId)).toEqual([r1.id]);
    // the admin overview still lists every match, the closed ones with their reason
    expect((await veto.listForTournament(t.id)).find((v) => v.matchId === r2.id)?.reason).toContain(VETO_CLOSED);

    // the admin opens round 3 early: open, round 2 still closed
    expect(await veto.openRound(stage.id, 3)).toMatchObject({ opened: 1 });
    expect((await veto.getState(r3.id)).phase).toBe('rps');
    expect((await veto.getState(r2.id)).phase).toBe('unavailable');

    // round 1 finished: round 2 opens by itself
    await persistence.recordManualGameResult({ matchId: r1.id, mapOrder: 1, scoreHome: 13, scoreAway: 7, reportedBy: 'it' });
    expect((await veto.getState(r2.id)).phase).toBe('rps');
  });
});
