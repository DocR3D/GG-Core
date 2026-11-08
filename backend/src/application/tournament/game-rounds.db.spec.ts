import 'dotenv/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '@adapters/database/prisma.service';
import { GameRoundsService } from './game-rounds.service';

/**
 * Real PostgreSQL (the specs that mock Prisma cannot see a wrong column or type). Off by default:
 *   DB_IT=1 npx jest --config jest.config.ts game-rounds.db      (database up to date: `npx prisma db push`)
 */
const describeDb = process.env.DB_IT === '1' ? describe : describe.skip;

describeDb('GameRoundsService - real PostgreSQL', () => {
  const prisma = new PrismaService();
  const service = new GameRoundsService(prisma);
  const gameId = `it-rounds-${randomUUID().slice(0, 8)}`;
  const otherGameId = `${gameId}-other`;

  const insert = (matchId: string, type: string, timestamp: number, payload: object) =>
    prisma.eventPrimary.create({ data: { matchId, serverId: 'srv-it', type, timestamp: BigInt(timestamp), payload } });

  beforeAll(async () => {
    await prisma.$connect();
    await insert(gameId, 'team_round_win', 1000, { winner: 'CT', reason: 'defused', score: { ct: 1, t: 0 } });
    await insert(gameId, 'kill', 1500, { killer: 'x' }); // not a round end: ignored
    await insert(gameId, 'team_round_win', 2000, { winner: 'T', reason: 'bomb_exploded', score: { ct: 1, t: 1 } });
    await insert(gameId, 'team_round_win', 3000, { winner: 'CT', reason: 'elim', score: { ct: 2, t: 1 } });
    await insert(gameId, 'team_round_win', 4000, { winner: 'T', reason: 'elim', score: { ct: 1, t: 2 } }); // back to round 2, replayed
    await insert(otherGameId, 'team_round_win', 1000, { winner: 'T', score: { ct: 0, t: 1 } }); // another game: not mixed in
  });

  afterAll(async () => {
    await prisma.eventPrimary.deleteMany({ where: { matchId: { in: [gameId, otherGameId] } } });
    await prisma.$disconnect();
  });

  it('returns the rounds of this game only, the replayed round replacing the old one', async () => {
    const rounds = await service.forGame(gameId);
    expect(rounds.map((r) => [r.number, r.winner, r.reason])).toEqual([
      [1, 'CT', 'defused'],
      [2, 'T', 'bomb_exploded'],
      [3, 'T', 'elim'],
    ]);
    expect(rounds[2]).toMatchObject({ ct: 1, t: 2, at: 4000 });
  });

  it('returns nothing for a game with no round', async () => {
    expect(await service.forGame(`${gameId}-none`)).toEqual([]);
  });
});
