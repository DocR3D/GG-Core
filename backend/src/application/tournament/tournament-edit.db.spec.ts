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
});
