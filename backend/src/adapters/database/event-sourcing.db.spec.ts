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

describeDb('Event sourcing — real PostgreSQL', () => {
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
});
