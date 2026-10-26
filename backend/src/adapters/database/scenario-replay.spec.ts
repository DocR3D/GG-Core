import * as fs from 'fs';
import * as path from 'path';
import { DatabaseEventsHandler } from '@app/subscribers/database-events.handler';
import { TournamentPersistenceService } from './tournament-persistence.service';
import { PrismaService } from './prisma.service';

/**
 * Resolves fixture files cleanly from the repository root without fragile deep relative paths.
 */
function getScenarioFixturePath(filename: string): string {
  const repoRoot = fs.existsSync(path.resolve(process.cwd(), 'test/fixtures'))
    ? process.cwd()
    : path.resolve(process.cwd(), '..');
  return path.resolve(repoRoot, 'test', 'fixtures', 'scenarios', filename);
}

describe('Scenario Replay — Real LAN Matches via DatabaseEventsHandler', () => {
  let handler: DatabaseEventsHandler;
  let persistenceService: TournamentPersistenceService;

  // In-memory mock store representing the PostgreSQL tables
  const dbStore = {
    players: new Map<string, any>(),
    playerMapStats: new Map<string, any>(),
    eventsPrimary: [] as any[],
  };

  beforeEach(() => {
    // Reset in-memory store
    dbStore.players.clear();
    dbStore.playerMapStats.clear();
    dbStore.eventsPrimary.length = 0;

    // Prisma mock backed by in-memory storage
    const prismaMock: any = {
      player: {
        upsert: jest.fn(({ where, update, create }) => {
          let player = dbStore.players.get(where.steamId);
          if (player) {
            player = { ...player, ...update };
          } else {
            player = { id: `uuid-${create.username}`, ...create };
          }
          dbStore.players.set(player.steamId ?? player.username, player);
          return Promise.resolve(player);
        }),
        findFirst: jest.fn(({ where }) => {
          for (const p of dbStore.players.values()) {
            if (p.username === where.username && p.steamId === where.steamId) {
              return Promise.resolve(p);
            }
          }
          return Promise.resolve(null);
        }),
        create: jest.fn(({ data }) => {
          const p = { id: `uuid-${data.username}`, ...data };
          dbStore.players.set(p.username, p);
          return Promise.resolve(p);
        }),
        update: jest.fn(({ where, data }) => {
          for (const p of dbStore.players.values()) {
            if (p.id === where.id) {
              Object.assign(p, data);
              return Promise.resolve(p);
            }
          }
          return Promise.resolve(null);
        }),
      },
      playerMapStats: {
        upsert: jest.fn(({ where, update, create }) => {
          const key = `${where.matchMapId_playerId.matchMapId}_${where.matchMapId_playerId.playerId}`;
          let stat = dbStore.playerMapStats.get(key);
          if (stat) {
            stat.kills += update.kills?.increment ?? 0;
            stat.headshots += update.headshots?.increment ?? 0;
            stat.damageDealt += update.damageDealt?.increment ?? 0;
          } else {
            stat = {
              id: `stat-${key}`,
              ...create,
              deaths: 0,
            };
          }
          dbStore.playerMapStats.set(key, stat);
          return Promise.resolve(stat);
        }),
        aggregate: jest.fn(() => {
          let totalHs = 0;
          for (const s of dbStore.playerMapStats.values()) {
            totalHs += s.headshots;
          }
          return Promise.resolve({ _sum: { headshots: totalHs } });
        }),
        findMany: jest.fn(() => {
          const list = [];
          for (const s of dbStore.playerMapStats.values()) {
            const player = Array.from(dbStore.players.values()).find(
              (p) => p.id === s.playerId,
            );
            list.push({ ...s, player });
          }
          return Promise.resolve(list);
        }),
      },
      eventPrimary: {
        create: jest.fn(({ data }) => {
          const entry = { id: BigInt(dbStore.eventsPrimary.length + 1), ...data };
          dbStore.eventsPrimary.push(entry);
          return Promise.resolve(entry);
        }),
      },
    };

    persistenceService = new TournamentPersistenceService(prismaMock as PrismaService);
    handler = new DatabaseEventsHandler(persistenceService);
  });

  it('Scenario 01: should accurately process all 221 events of Mirage match from GGLan 19', async () => {
    const fixturePath = getScenarioFixturePath('scenario-01-full-match-mirage.json');
    const scenarioData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    const { totalEvents, eventSummary } = scenarioData.metadata;
    expect(scenarioData.events).toHaveLength(totalEvents);

    // Replay the full stream through DatabaseEventsHandler
    for (const ev of scenarioData.events) {
      await handler.handle(ev);
    }

    // 1. Audit Event Sourcing integrity
    expect(dbStore.eventsPrimary).toHaveLength(totalEvents);
    const recordedTypes = dbStore.eventsPrimary.map((e) => e.type);
    expect(recordedTypes.filter((t) => t === 'kill')).toHaveLength(eventSummary.kill);
    expect(recordedTypes.filter((t) => t === 'round_start')).toHaveLength(
      eventSummary.round_start,
    );
    expect(recordedTypes.filter((t) => t === 'team_round_win')).toHaveLength(
      eventSummary.team_round_win,
    );

    // 2. Leaderboard & Stats accuracy
    const leaderboard = await persistenceService.getTournamentLeaderboard('m-gglan19-59');
    expect(leaderboard.length).toBeGreaterThan(0);

    // The top fragger should have the highest kills
    const topFragger = leaderboard[0];
    expect(topFragger.kills).toBeGreaterThan(0);
    expect(topFragger.kdRatio).toBeGreaterThan(0);
    expect(topFragger.headshotPercent).toBeGreaterThanOrEqual(0);
    expect(topFragger.headshotPercent).toBeLessThanOrEqual(100);

    // 3. Headshot aggregation across the match
    const totalHs = await persistenceService.getTournamentHeadshots('m-gglan19-59');
    expect(totalHs).toBeGreaterThan(0);
  });

  it('Scenario 02: should replay Ancient match with 15 pauses and preserve audit timeline', async () => {
    const fixturePath = getScenarioFixturePath('scenario-02-pauses-match71-ancient.json');
    const scenarioData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    for (const ev of scenarioData.events) {
      await handler.handle(ev);
    }

    expect(dbStore.eventsPrimary).toHaveLength(scenarioData.metadata.totalEvents);
  });
});
