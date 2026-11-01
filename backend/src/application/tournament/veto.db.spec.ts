import 'dotenv/config';
import { PrismaService } from '@adapters/database/prisma.service';
import { TournamentPersistenceService } from '@adapters/database/tournament-persistence.service';
import { TournamentStagesService } from './tournament-stages.service';
import { VetoActor, VetoService } from './veto.service';

/**
 * Rock-paper-scissors + map veto on a REAL PostgreSQL: captains, hidden choices, turns, games created, sides for
 * the launch, admin undo / reset. Disabled by default - `make test-db` (DB_IT=1, schema pushed).
 */
const describeDb = process.env.DB_IT === '1' ? describe : describe.skip;

const POOL = ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_train'];
const CAP_HOME = '76561198000000101';
const CAP_AWAY = '76561198000000102';
const CAP_AWAY_LOG = '[U:1:39734374]'; // same account, CS2 log format

describeDb('Veto - real PostgreSQL', () => {
  const prisma = new PrismaService();
  const stages = new TournamentStagesService(prisma);
  const persistence = new TournamentPersistenceService(prisma);
  const veto = new VetoService(prisma);
  const created: { tournamentId?: string; teamIds: string[] } = { teamIds: [] };
  const home: VetoActor = { steamId: CAP_HOME, admin: false, name: 'cap home' };
  const away: VetoActor = { steamId: CAP_AWAY, admin: false, name: 'cap away' };
  const stranger: VetoActor = { steamId: '76561198000000199', admin: false, name: 'stranger' };
  const admin: VetoActor = { admin: true, name: 'orga' };

  beforeAll(() => prisma.$connect());
  afterAll(async () => {
    if (created.tournamentId) await prisma.tournament.deleteMany({ where: { id: created.tournamentId } });
    await prisma.team.deleteMany({ where: { id: { in: created.teamIds } } });
    await prisma.player.deleteMany({ where: { steamId: { in: [CAP_HOME, CAP_AWAY_LOG] } } });
    await prisma.player.deleteMany({ where: { username: 'IT_Home_2' } });
    await prisma.$disconnect();
  });

  it('BO3 in side mode "pick": RPS (tie, then win), veto by turns, games and sides for the launch, undo / reset', async () => {
    const t = await stages.createTournament({ name: `IT veto ${Date.now()}` });
    created.tournamentId = t.id;
    const [teamH, teamA] = await stages.createTeams(['IT Veto Home', 'IT Veto Away']);
    created.teamIds = [teamH.id, teamA.id];
    const match = await prisma.match.create({ data: { tournamentId: t.id, teamHomeId: teamH.id, teamAwayId: teamA.id, format: 'BO3', bracketType: 'UPPER' } });

    // No pool yet → unavailable
    expect((await veto.getState(match.id)).reason).toMatch(/map pool/);
    await veto.setTournamentConfig(t.id, { mapPool: POOL, sideMode: 'pick' });

    // Captains (SteamID64 for one, CS2 log format for the other: both recognized)
    await veto.addPlayers(t.id, teamH.id, [{ username: 'IT_Home_1', steamId: CAP_HOME, captain: true }, { username: 'IT_Home_2' }]);
    await veto.addPlayers(t.id, teamA.id, [{ username: 'IT_Away_1', steamId: CAP_AWAY_LOG, captain: true }]);
    let s = await veto.getState(match.id, home);
    expect(s.phase).toBe('rps');
    expect(s.teams.home.captain).toBe('IT_Home_1');
    expect(s.viewer).toEqual({ teamId: teamH.id, admin: false, canAct: true });
    expect((await veto.getState(match.id, stranger)).viewer.teamId).toBeNull();

    // Rock-paper-scissors: a stranger / an admin cannot play; a choice stays hidden from the opponent
    await expect(veto.playRps(match.id, stranger, 'rock')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(veto.playRps(match.id, admin, 'rock')).rejects.toMatchObject({ code: 'forbidden' });
    await veto.playRps(match.id, home, 'rock');
    await expect(veto.playRps(match.id, home, 'paper')).rejects.toMatchObject({ code: 'conflict' });
    s = await veto.getState(match.id, away);
    expect(s.rps.current).toEqual({ round: 1, homePlayed: true, awayPlayed: false, mine: undefined });
    expect(s.waitingFor).toEqual([teamA.id]);
    expect(s.lastActionAt).toBeInstanceOf(Date);

    // "My vetos": each captain finds its match, myTurn only for the one expected; a stranger has none
    const mineAway = await veto.listForCaptain(away);
    expect(mineAway).toEqual([expect.objectContaining({ matchId: match.id, phase: 'rps', waitingFor: [teamA.id], myTurn: true })]);
    expect((await veto.listForCaptain(home))[0]).toMatchObject({ matchId: match.id, myTurn: false });
    expect(await veto.listForCaptain(stranger)).toEqual([]);
    expect(JSON.stringify(s)).not.toContain('rock');
    await veto.playRps(match.id, away, 'rock'); // tie → round 2
    s = await veto.playRps(match.id, away, 'paper');
    expect(s.rps.current).toMatchObject({ round: 2, awayPlayed: true });
    s = await veto.playRps(match.id, home, 'scissors'); // scissors beats paper → home wins
    expect(s.phase).toBe('rps_decision');
    expect(s.rps.rounds).toEqual([{ round: 1, home: 'rock', away: 'rock' }, { round: 2, home: 'scissors', away: 'paper' }]);
    expect(s.rps.winnerTeamId).toBe(teamH.id);

    // The winner lets the opponent start: away = team "A"
    await expect(veto.chooseStart(match.id, away, { first: true })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await veto.getState(match.id)).waitingFor).toEqual([teamH.id]); // the RPS winner decides
    s = await veto.chooseStart(match.id, home, { first: false });
    expect(s.phase).toBe('veto');
    expect(s.startTeamId).toBe(teamA.id);
    expect(s.next).toEqual({ kind: 'ban', teamId: teamA.id });

    // Turns: not your turn → forbidden; a map already gone → invalid
    await expect(veto.playStep(match.id, home, { map: 'de_nuke' })).rejects.toMatchObject({ code: 'forbidden' });
    // a side sent when a ban is expected (e.g. right after someone else played): clear refusal
    await expect(veto.playStep(match.id, away, { side: 'CT' })).rejects.toMatchObject({ code: 'invalid', message: 'a map is expected (ban)' });
    await veto.playStep(match.id, away, { map: 'de_train' });
    await expect(veto.playStep(match.id, home, { map: 'de_train' })).rejects.toMatchObject({ code: 'invalid' });
    await veto.playStep(match.id, home, { map: 'de_anubis' });
    await veto.playStep(match.id, away, { map: 'de_mirage' }); // pick
    s = await veto.getState(match.id, home);
    expect(s.next).toEqual({ kind: 'side', teamId: teamH.id, map: 'de_mirage' });
    expect(s.seq).toBe(4 + 1 + 3); // 4 RPS choices, starting team, 3 steps
    await expect(veto.playStep(match.id, home, { map: 'de_nuke' })).rejects.toMatchObject({ message: 'a side is expected (CT or T) on de_mirage' });
    await veto.playStep(match.id, home, { side: 'CT' });
    // Admin plays for the absent home captain (pick), recorded as admin
    s = await veto.playStep(match.id, admin, { map: 'de_inferno' });
    expect(s.steps[s.steps.length - 1]).toMatchObject({ kind: 'pick', teamId: teamH.id, map: 'de_inferno', actedBy: 'admin:orga' });
    await veto.playStep(match.id, away, { side: 'T' });
    await veto.playStep(match.id, away, { map: 'de_dust2' });
    s = await veto.playStep(match.id, home, { map: 'de_nuke' });

    expect(s.phase).toBe('done');
    expect(s.waitingFor).toEqual([]);
    // Admin overview of the tournament
    const overview = await veto.listForTournament(t.id);
    expect(overview).toEqual([expect.objectContaining({ matchId: match.id, phase: 'done', waitingFor: [], home: { id: teamH.id, name: 'IT Veto Home' } })]);
    expect(s.maps).toEqual([
      { order: 1, map: 'de_mirage', pickedByTeamId: teamA.id, side: { teamId: teamH.id, side: 'CT' } },
      { order: 2, map: 'de_inferno', pickedByTeamId: teamH.id, side: { teamId: teamA.id, side: 'T' } },
      { order: 3, map: 'de_ancient', pickedByTeamId: null, side: null },
    ]);
    const games = await prisma.matchMap.findMany({ where: { matchId: match.id }, orderBy: { mapOrder: 'asc' } });
    expect(games.map((g) => [g.mapOrder, g.mapName, g.status])).toEqual([[1, 'de_mirage', 'PENDING'], [2, 'de_inferno', 'PENDING'], [3, 'de_ancient', 'PENDING']]);
    expect(await veto.startingSides(match.id, 1)).toEqual({ home: 'CT', away: 'T' });
    expect(await veto.startingSides(match.id, 2)).toEqual({ home: 'CT', away: 'T' }); // away took T
    expect(await veto.startingSides(match.id, 3)).toBeNull(); // decider: knife

    // Undo (admin only): the last ban comes back, the games go away
    await expect(veto.undo(match.id, home)).rejects.toMatchObject({ code: 'forbidden' });
    s = await veto.undo(match.id, admin);
    expect(s.next).toEqual({ kind: 'ban', teamId: teamH.id });
    expect(await prisma.matchMap.count({ where: { matchId: match.id } })).toBe(0);
    await veto.playStep(match.id, home, { map: 'de_nuke' });

    // Series won 2-0: the decider is not played
    await persistence.recordManualGameResult({ matchId: match.id, mapOrder: 1, scoreHome: 13, scoreAway: 5, reportedBy: 'it' });
    await expect(veto.reset(match.id, admin)).rejects.toMatchObject({ code: 'conflict' }); // a game is played
    await persistence.recordManualGameResult({ matchId: match.id, mapOrder: 2, scoreHome: 13, scoreAway: 9, reportedBy: 'it' });
    const decider = await prisma.matchMap.findUniqueOrThrow({ where: { matchId_mapOrder: { matchId: match.id, mapOrder: 3 } } });
    expect(decider.status).toBe('CANCELLED');
    expect((await veto.getState(match.id)).phase).toBe('done'); // still visible once the match is over
  });

  it('admin sets who starts (RPS played elsewhere), BO1 knife; reset starts over; games set without veto → unavailable', async () => {
    const t = await prisma.tournament.findUniqueOrThrow({ where: { id: created.tournamentId! } });
    const [h, a] = created.teamIds;
    await veto.setTournamentConfig(t.id, { mapPool: POOL.slice(0, 3), sideMode: 'knife' });
    const match = await prisma.match.create({ data: { tournamentId: t.id, teamHomeId: h, teamAwayId: a, format: 'BO1' } });

    let s = await veto.chooseStart(match.id, admin, { teamId: h });
    expect(s.next).toEqual({ kind: 'ban', teamId: h });
    await veto.playStep(match.id, home, { map: 'de_ancient' });
    s = await veto.playStep(match.id, away, { map: 'de_dust2' });
    expect(s.maps).toEqual([{ order: 1, map: 'de_anubis', pickedByTeamId: null, side: null }]);

    s = await veto.reset(match.id, admin);
    expect(s.phase).toBe('rps');
    expect(s.steps).toEqual([]);
    expect(await prisma.matchMap.count({ where: { matchId: match.id } })).toBe(0);

    const manual = await prisma.match.create({ data: { tournamentId: t.id, teamHomeId: h, teamAwayId: a, format: 'BO1' } });
    await prisma.matchMap.create({ data: { matchId: manual.id, mapOrder: 1, mapName: 'de_nuke' } });
    expect((await veto.getState(manual.id)).reason).toMatch(/without a veto/);
  });

  it('grand final BO3, upper finalist one map up: usual veto, the map left is the advantage map (not played)', async () => {
    const t = await prisma.tournament.findUniqueOrThrow({ where: { id: created.tournamentId! } });
    const [h, a] = created.teamIds;
    await veto.setTournamentConfig(t.id, { mapPool: POOL, sideMode: 'knife' });
    const gf = await prisma.match.create({
      data: { tournamentId: t.id, teamHomeId: h, teamAwayId: a, format: 'BO3', bracketType: 'FINAL', advantageHome: 1 },
    });
    await veto.chooseStart(gf.id, admin, { teamId: a });
    for (const map of ['de_train', 'de_anubis', 'de_mirage', 'de_inferno', 'de_dust2']) await veto.playStep(gf.id, admin, { map });
    const s = await veto.playStep(gf.id, admin, { map: 'de_nuke' }); // ban ban pick pick ban ban
    expect(s.maps).toEqual([
      { order: 1, map: 'de_mirage', pickedByTeamId: a, side: null },
      { order: 2, map: 'de_inferno', pickedByTeamId: h, side: null },
      { order: 3, map: 'de_ancient', pickedByTeamId: null, side: null, advantageTeamId: h },
    ]);
    const games = await prisma.matchMap.findMany({ where: { matchId: gf.id }, orderBy: { mapOrder: 'asc' } });
    expect(games.map((g) => g.mapName)).toEqual(['de_mirage', 'de_inferno']); // only the picks are played

    // the upper finalist wins the first map: 1 (advantage) + 1 = 2 → champion, the second map is not played
    await persistence.recordManualGameResult({ matchId: gf.id, mapOrder: 1, scoreHome: 13, scoreAway: 7, reportedBy: 'it' });
    const after = await prisma.match.findUniqueOrThrow({ where: { id: gf.id }, include: { maps: { orderBy: { mapOrder: 'asc' } } } });
    expect([after.status, after.winnerId, after.scoreHome, after.scoreAway]).toEqual(['FINISHED', h, 2, 0]);
    expect(after.maps.map((g) => g.status)).toEqual(['FINISHED', 'CANCELLED']);
  });
});
