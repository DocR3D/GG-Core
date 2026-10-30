import 'dotenv/config';
import { randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';
import { TournamentPersistenceService } from './tournament-persistence.service';
import { DatabaseEventsHandler } from '@app/subscribers/database-events.handler';
import { EventTypes } from '@domain/events/event.types';

/**
 * Test d'intégration sur un VRAI PostgreSQL (pas de mock Prisma).
 *
 * Les autres specs mockent Prisma : elles ne pouvaient pas voir que des matchId temps réel
 * ("m-sandbox-1") étaient envoyés dans des colonnes UUID → events_primary restait vide en production.
 *
 * Désactivé par défaut. Lancer avec une base à jour (`npx prisma db push`) :
 *   DB_IT=1 npx jest --config jest.config.ts event-sourcing.db
 */
const describeDb = process.env.DB_IT === '1' ? describe : describe.skip;

describeDb('Event sourcing - real PostgreSQL', () => {
  const prisma = new PrismaService();
  const persistence = new TournamentPersistenceService(prisma);
  const runId = randomUUID().slice(0, 8);
  const unlinkedMatchId = `m-it-${runId}`;
  const linkedMatchId = `m-it-linked-${runId}`;
  const steamId = `[U:1:9${runId.replace(/\D/g, '').slice(0, 6) || '0'}]`;

  let tournamentId: string;
  let homeTeamId: string;
  let awayTeamId: string;
  let matchMapId: string;
  let handler: DatabaseEventsHandler;

  beforeAll(async () => {
    await prisma.$connect();
    const tournament = await prisma.tournament.create({ data: { name: `IT ${runId}`, slug: `it-${runId}` } });
    const home = await prisma.team.create({ data: { name: `Home ${runId}` } });
    const away = await prisma.team.create({ data: { name: `Away ${runId}` } });
    const match = await prisma.match.create({
      data: { tournamentId: tournament.id, teamHomeId: home.id, teamAwayId: away.id, format: 'BO1' },
    });
    const map = await prisma.matchMap.create({ data: { matchId: match.id, mapName: 'de_inferno' } });
    tournamentId = tournament.id;
    homeTeamId = home.id;
    awayTeamId = away.id;
    matchMapId = map.id;

    // État temps réel minimal (normalement dans Redis) : seul linkedMatchId est rattaché au MatchMap
    const state: any = {
      getDbMatchMapId: async (m: string) => (m === linkedMatchId ? matchMapId : null),
      sideToLogical: async (_m: string, side: string) => (side === 'CT' ? 'home' : 'away'),
      getTeamIds: async () => ({ home_id: homeTeamId, away_id: awayTeamId }),
    };
    handler = new DatabaseEventsHandler(persistence, state);
  });

  afterAll(async () => {
    await prisma.eventPrimary.deleteMany({ where: { matchId: { in: [unlinkedMatchId, linkedMatchId] } } });
    await prisma.tournament.deleteMany({ where: { id: tournamentId } }); // cascade: matches, maps, stats
    await prisma.team.deleteMany({ where: { id: { in: [homeTeamId, awayTeamId] } } });
    await prisma.player.deleteMany({ where: { steamId } });
    await prisma.$disconnect();
  });

  const kill = (matchId: string) =>
    ({
      type: EventTypes.KILL,
      matchId,
      serverId: 'srv-it',
      timestamp: Date.now(),
      payload: {
        kind: 'player',
        killer: { name: 'Player_IT', steamId, team: 'CT' },
        victim: { name: 'Player_IT2', steamId: '[U:1:1]', team: 'TERRORIST' },
        headshot: true,
        weapon: 'ak47',
      },
    }) as any;

  it('persists events of a match that is not linked to the relational model (sandbox / test match)', async () => {
    await handler.handle({ type: EventTypes.ROUND_START, matchId: unlinkedMatchId, serverId: 'srv-it', payload: {} } as any);
    await handler.handle(kill(unlinkedMatchId));

    const rows = await prisma.eventPrimary.findMany({ where: { matchId: unlinkedMatchId }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.type)).toEqual([EventTypes.ROUND_START, EventTypes.KILL]);
    expect(rows.every((r) => r.matchMapId === null && r.serverId === 'srv-it')).toBe(true);
    expect(await prisma.player.count({ where: { steamId } })).toBe(0); // no stats without MatchMap
  });

  it('attaches events and kill stats to the linked MatchMap and team', async () => {
    await handler.handle(kill(linkedMatchId));
    await handler.handle(kill(linkedMatchId));

    const rows = await prisma.eventPrimary.findMany({ where: { matchId: linkedMatchId } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.matchMapId === matchMapId)).toBe(true);

    const stats = await prisma.playerMapStats.findMany({ where: { matchMapId }, include: { player: true } });
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ teamId: homeTeamId, kills: 2, headshots: 2 });
    expect(stats[0].player.steamId).toBe(steamId);
  });

  it('resolves the bracket match of a linked BO1 map', async () => {
    const map = await prisma.matchMap.findUniqueOrThrow({ where: { id: matchMapId } });
    await expect(persistence.resolveBracketMatchId(linkedMatchId, matchMapId)).resolves.toBe(map.matchId);
    await expect(persistence.resolveBracketMatchId(unlinkedMatchId, null)).resolves.toBeNull();
  });

  it('records the generic game result (enums, author, date) on the linked MatchMap; tournament / server default to cs2', async () => {
    await persistence.recordGameResult({
      matchMapId, scoreHome: 13, scoreAway: 11, winnerTeamId: homeTeamId,
      source: 'AUTOMATIC', status: 'CONFIRMED', reportedBy: 'cs2',
    });
    const map = await prisma.matchMap.findUniqueOrThrow({ where: { id: matchMapId } });
    expect(map).toEqual(expect.objectContaining({
      scoreHome: 13, scoreAway: 11, winnerId: homeTeamId, status: 'FINISHED',
      resultSource: 'AUTOMATIC', resultStatus: 'CONFIRMED', reportedBy: 'cs2',
    }));
    expect(map.reportedAt).toBeInstanceOf(Date);
    const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    expect(tournament.game).toBe('cs2');
  });

  it('admin entry of a BO3: 2 games won finish the series and send the winner to the next bracket match', async () => {
    const final = await prisma.match.create({ data: { tournamentId, format: 'BO3' } });
    const semi = await prisma.match.create({
      data: { tournamentId, teamHomeId: homeTeamId, teamAwayId: awayTeamId, format: 'BO3', nextMatchId: final.id },
    });

    const g1 = await persistence.recordManualGameResult({
      matchId: semi.id, mapOrder: 1, scoreHome: 13, scoreAway: 7, mapName: 'de_nuke', reportedBy: 'admin-it',
    });
    expect(g1.series).toEqual({ scoreHome: 1, scoreAway: 0, winnerId: null });
    expect((await prisma.match.findUniqueOrThrow({ where: { id: semi.id } })).status).toBe('LIVE');

    const g2 = await persistence.recordManualGameResult({
      matchId: semi.id, mapOrder: 2, scoreHome: 16, scoreAway: 14, reportedBy: 'admin-it',
    });
    expect(g2.series).toEqual({ scoreHome: 2, scoreAway: 0, winnerId: homeTeamId });
    expect(g2.game).toEqual(expect.objectContaining({ mapName: '-', resultSource: 'MANUAL', resultStatus: 'CONFIRMED' }));

    const done = await prisma.match.findUniqueOrThrow({ where: { id: semi.id } });
    expect(done).toEqual(expect.objectContaining({ status: 'FINISHED', winnerId: homeTeamId, scoreHome: 2, scoreAway: 0 }));
    expect((await prisma.match.findUniqueOrThrow({ where: { id: final.id } })).teamHomeId).toBe(homeTeamId);

    await expect(persistence.recordManualGameResult({
      matchId: semi.id, mapOrder: 3, scoreHome: 1, scoreAway: 13, reportedBy: 'admin-it',
    })).rejects.toMatchObject({ code: 'finished' });
  });

  it('stages, groups, stage teams and the new match fields round-trip (grand final advantage, bonus match)', async () => {
    const stage = await prisma.stage.create({
      data: { tournamentId, name: 'Poules', type: 'ROUND_ROBIN', order: 1, settings: { groupCount: 2 } },
    });
    const group = await prisma.stageGroup.create({ data: { stageId: stage.id, name: 'A' } });
    await prisma.stageTeam.createMany({
      data: [
        { stageId: stage.id, teamId: homeTeamId, groupId: group.id, seed: 1 },
        { stageId: stage.id, teamId: awayTeamId, groupId: group.id, seed: 2 },
      ],
    });
    const loaded = await prisma.stage.findUniqueOrThrow({ where: { id: stage.id }, include: { groups: { include: { teams: true } } } });
    expect(loaded.groups[0].teams.map((t) => t.seed).sort()).toEqual([1, 2]);

    // Grand final BO3, upper-bracket finalist one map up: one more map wins it
    const gf = await prisma.match.create({
      data: { tournamentId, stageId: stage.id, teamHomeId: homeTeamId, teamAwayId: awayTeamId, format: 'BO3', advantageHome: 1 },
    });
    const res = await persistence.recordManualGameResult({ matchId: gf.id, mapOrder: 1, scoreHome: 13, scoreAway: 9, reportedBy: 'admin-it' });
    expect(res.series).toEqual({ scoreHome: 2, scoreAway: 0, winnerId: homeTeamId });

    // Bonus placement match: outside any stage, stats not counted
    const bonus = await prisma.match.create({
      data: { tournamentId, teamHomeId: homeTeamId, teamAwayId: awayTeamId, stage: 'SHOWMATCH', countsInStats: false, placement: 7 },
    });
    expect(bonus).toEqual(expect.objectContaining({ stageId: null, countsInStats: false, placement: 7, isForfeit: false }));
  });
});
