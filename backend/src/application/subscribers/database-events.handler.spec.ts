import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseEventsHandler } from './database-events.handler';
import { TournamentPersistenceService } from '@adapters/database/tournament-persistence.service';
import { EventTypes } from '@domain/events/event.types';

describe('DatabaseEventsHandler', () => {
  let handler: DatabaseEventsHandler;
  let persistence: {
    recordEventLog: jest.Mock;
    resolvePlayer: jest.Mock;
    recordPlayerKill: jest.Mock;
  };

  beforeEach(async () => {
    persistence = {
      recordEventLog: jest.fn().mockResolvedValue({ id: BigInt(1) }),
      resolvePlayer: jest.fn().mockResolvedValue({ id: 'player-zywoo-1', username: 'ZywOo' }),
      recordPlayerKill: jest.fn().mockResolvedValue({ id: 'stat-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseEventsHandler,
        {
          provide: TournamentPersistenceService,
          useValue: persistence,
        },
      ],
    }).compile();

    handler = module.get<DatabaseEventsHandler>(DatabaseEventsHandler);
  });

  it('should record every event into EventPrimary (event sourcing)', async () => {
    const event = {
      type: EventTypes.ROUND_START,
      matchId: 'match-1',
      timestamp: 1700000000000,
      payload: {},
    } as any;

    await handler.handle(event);

    expect(persistence.recordEventLog).toHaveBeenCalledWith(
      'match-1',
      EventTypes.ROUND_START,
      {},
      1700000000000,
    );
  });

  it('should resolve killer and record player kill stats on KILL event', async () => {
    const killEvent = {
      type: EventTypes.KILL,
      matchId: 'match-1',
      timestamp: 1700000001000,
      payload: {
        kind: 'player',
        killer: {
          name: 'ZywOo',
          steamId: '76561198000000001',
          team: 'CT',
        },
        victim: {
          name: 's1mple',
          steamId: '76561198000000002',
          team: 'T',
        },
        headshot: true,
        weapon: 'ak47',
      },
    } as any;

    await handler.handle(killEvent);

    expect(persistence.resolvePlayer).toHaveBeenCalledWith({
      steamId: '76561198000000001',
      username: 'ZywOo',
    });

    expect(persistence.recordPlayerKill).toHaveBeenCalledWith({
      matchMapId: 'match-1',
      playerId: 'player-zywoo-1',
      teamId: 'CT',
      isHeadshot: true,
      damageDealt: 100,
    });
  });

  it('should ignore kill stats on world/suicide kills but still record event sourcing log', async () => {
    const suicideEvent = {
      type: EventTypes.KILL,
      matchId: 'match-1',
      timestamp: 1700000002000,
      payload: {
        kind: 'suicide',
        player: {
          name: 'ZywOo',
          steamId: '76561198000000001',
          team: 'CT',
        },
      },
    } as any;

    await handler.handle(suicideEvent);

    expect(persistence.recordEventLog).toHaveBeenCalled();
    expect(persistence.recordPlayerKill).not.toHaveBeenCalled();
  });

  it('should safely swallow database errors to prevent match engine crashes', async () => {
    persistence.recordEventLog.mockRejectedValueOnce(new Error('DB connection timed out'));

    const event = {
      type: EventTypes.BOMB_PLANTED,
      matchId: 'match-1',
      payload: {},
    } as any;

    await expect(handler.handle(event)).resolves.not.toThrow();
  });
});
