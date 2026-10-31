import 'dotenv/config';
import { PrismaService } from '@adapters/database/prisma.service';
import { TournamentStagesService } from './tournament-stages.service';
import { TournamentEditService } from './tournament-edit.service';
import { TournamentAdminService } from './tournament-admin.service';
import { TournamentPersistenceService } from '@adapters/database/tournament-persistence.service';
import { VetoService } from './veto.service';

/**
 * Editing what was created for a tournament, on a REAL PostgreSQL (unique SteamID, cascades): rename and status,
 * team renamed / taken out (only before it plays), player corrected / taken out of a roster.
 * Disabled by default - `make test-db` (DB_IT=1).
 */
const describeDb = process.env.DB_IT === '1' ? describe : describe.skip;

describeDb('Tournament edit - real PostgreSQL', () => {
  const prisma = new PrismaService();
  const stages = new TournamentStagesService(prisma);
  const veto = new VetoService(prisma);
  const edit = new TournamentEditService(prisma);
  const admin = new TournamentAdminService(prisma, new TournamentPersistenceService(prisma), veto);
  const created: { tournamentId?: string; teamIds: string[]; steamIds: string[] } = { teamIds: [], steamIds: [] };
  const stamp = Date.now().toString().slice(-6);
  const steam = (n: number) => `[U:1:9${stamp}${n}]`;

  beforeAll(() => prisma.$connect());
  afterAll(async () => {
    if (created.tournamentId) await prisma.tournament.deleteMany({ where: { id: created.tournamentId } });
    await prisma.team.deleteMany({ where: { id: { in: created.teamIds } } });
    await prisma.player.deleteMany({ where: { steamId: { in: created.steamIds } } });
    await prisma.$disconnect();
  });

  it('renames, changes status, corrects players, takes a team out only before it plays', async () => {
    const t = await stages.createTournament({ name: `IT edit ${stamp}` });
    created.tournamentId = t.id;
    const [a, b, c] = await stages.createTeams([`IT Edit A ${stamp}`, `IT Edit B ${stamp}`, `IT Edit C ${stamp}`]);
    created.teamIds = [a.id, b.id, c.id];
    created.steamIds = [steam(1), steam(2), steam(3), '76561197960265729'];
    const [pa] = await veto.addPlayers(t.id, a.id, [{ username: 'a1', steamId: steam(1), captain: true }, { username: 'a2', steamId: steam(2) }]);
    await veto.addPlayers(t.id, b.id, [{ username: 'b1', steamId: steam(3) }]);
    await veto.addPlayers(t.id, c.id, [{ username: 'c1' }]);

    // tournament
    expect(await edit.updateTournament(t.id, { name: '  Renommé  ', status: 'ACTIVE' })).toMatchObject({ name: 'Renommé', status: 'ACTIVE' });
    await expect(edit.updateTournament(t.id, { status: 'LIVE' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(edit.updateTournament('not-a-uuid', { name: 'x' })).rejects.toMatchObject({ code: 'not_found' });

    // team
    expect(await edit.updateTeam(a.id, { name: 'Rouge', tag: 'RGE' })).toMatchObject({ name: 'Rouge', tag: 'RGE' });

    // player: SteamID corrected (both formats), refused when another player has it or when malformed
    const p2 = (await stages.tournamentTeams(t.id)).find((x) => x.id === a.id)!.players.find((p) => p.username === 'a2')!;
    expect(await edit.updatePlayer(p2.id, { steamId: '76561197960265729' })).toMatchObject({ steamId: '76561197960265729' });
    await expect(edit.updatePlayer(p2.id, { steamId: steam(3) })).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('b1') });
    await expect(edit.updatePlayer(p2.id, { steamId: 'STEAM_0:1:2' })).rejects.toMatchObject({ code: 'invalid' });
    expect(await edit.updatePlayer(p2.id, { steamId: '' })).toMatchObject({ steamId: null });

    // player taken out of the roster: kept, no longer in the team
    expect(await edit.removePlayer(t.id, a.id, p2.id)).toMatchObject({ removed: true });
    expect(await prisma.player.findUnique({ where: { id: p2.id } })).not.toBeNull();
    const teamA = (await stages.tournamentTeams(t.id)).find((x) => x.id === a.id)!;
    expect(teamA.players.map((p) => p.username)).toEqual(['a1']);
    await expect(edit.removePlayer(t.id, a.id, p2.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(pa.captain).toBe(true);

    // team C, no match yet: taken out, and deleted (no other tournament)
    expect(await edit.removeTeam(t.id, c.id)).toEqual({ teamId: c.id, playersRemoved: 1, teamDeleted: true });
    expect(await prisma.team.findUnique({ where: { id: c.id } })).toBeNull();

    // team B plays a match: refused (replace it instead)
    await admin.createBonusMatch(t.id, { homeTeamId: a.id, awayTeamId: b.id });
    await expect(edit.removeTeam(t.id, b.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('closes the groups early, resets a stage (results lost only with force), renames and deletes stages', async () => {
    const persistence = new TournamentPersistenceService(prisma);
    const t = await stages.createTournament({ name: `IT stages edit ${stamp}` });
    const teams = await stages.createTeams(['P1', 'P2', 'P3', 'P4'].map((x) => `IT StageEdit ${x} ${stamp}`));
    created.teamIds.push(...teams.map((x) => x.id));
    try {
      const groups = await stages.createStage(t.id, { name: 'Poules', type: 'ROUND_ROBIN', order: 1 });
      const bracket = await stages.createStage(t.id, { name: 'Arbre', type: 'DOUBLE_ELIM', order: 2 });
      await stages.generateGroups(groups.id, { teamIds: teams.map((x) => x.id), groupCount: 1, format: 'BO1' });

      // only round 1 played: the qualification waits for the other rounds
      const round1 = await prisma.match.findMany({ where: { stageId: groups.id, roundNumber: 1 } });
      for (const m of round1) await persistence.recordManualGameResult({ matchId: m.id, mapOrder: 1, scoreHome: 13, scoreAway: 8, reportedBy: 'it' });
      const rule = [{ ranks: [1, 2, 3, 4], targetStageId: bracket.id }];
      await expect(stages.qualify(groups.id, { rules: rule })).rejects.toMatchObject({ code: 'conflict' });

      // groups closed: the 4 matches not played are cancelled, the qualification goes on the played ones
      expect(await edit.closeGroups(groups.id)).toMatchObject({ matchesCancelled: 4 });
      const standings = await stages.getStandings(groups.id);
      expect(standings.groups[0]).toMatchObject({ matchesPlayed: 2, matchesTotal: 2 });
      await stages.qualify(groups.id, { rules: rule, manualOrder: { [standings.groups[0].groupId]: standings.groups[0].standings.map((r) => r.teamId) } });

      // the bracket is generated and one match played: reset refused without force, then done, the qualified teams stay
      await stages.generateDoubleElimination(bracket.id, {});
      const first = await prisma.match.findFirstOrThrow({ where: { stageId: bracket.id, teamHomeId: { not: null }, teamAwayId: { not: null } } });
      await persistence.recordManualGameResult({ matchId: first.id, mapOrder: 1, scoreHome: 13, scoreAway: 4, reportedBy: 'it' });
      await expect(edit.resetStage(bracket.id)).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('force') });
      expect(await edit.resetStage(bracket.id, true)).toMatchObject({ resultsLost: 1 });
      expect(await prisma.match.count({ where: { stageId: bracket.id } })).toBe(0);
      expect(await prisma.stageTeam.count({ where: { stageId: bracket.id } })).toBe(4);
      await stages.generateDoubleElimination(bracket.id, {}); // again, from the qualified teams

      // rename; the type only without matches; delete
      expect(await edit.updateStage(bracket.id, { name: 'Élite' })).toMatchObject({ name: 'Élite' });
      await expect(edit.updateStage(bracket.id, { type: 'ROUND_ROBIN' })).rejects.toMatchObject({ code: 'conflict' });
      expect(await edit.deleteStage(bracket.id)).toMatchObject({ deleted: 'Élite', resultsLost: 0 });
      expect(await prisma.stage.findUnique({ where: { id: bracket.id } })).toBeNull();
    } finally {
      await prisma.tournament.deleteMany({ where: { id: t.id } });
    }
  });
});
