import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseEventsHandler } from './database-events.handler';
import { TournamentPersistenceService } from '@adapters/database/tournament-persistence.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { EventTypes } from '@domain/events/event.types';

const MAP_UUID = '11111111-1111-4111-8111-111111111111';
const HOME_UUID = '22222222-2222-4222-8222-222222222222';
const AWAY_UUID = '33333333-3333-4333-8333-333333333333';

describe('DatabaseEventsHandler', () => {
  let handler: DatabaseEventsHandler;
  let persistence: {
    recordEventLog: jest.Mock;
    resolvePlayer: jest.Mock;
    recordPlayerKill: jest.Mock;
    findMatchMap: jest.Mock;
  };
  let state: {
    getDbMatchMapId: jest.Mock;
    sideToLogical: jest.Mock;
    getTeamIds: jest.Mock;
  };

  const killEvent = (matchId: string, team = 'CT') =>
    ({
      type: EventTypes.KILL,
      matchId,
      serverId: 'srv-a',
      timestamp: 1700000001000,
      payload: {
        kind: 'player',
        killer: { name: 'Player_01', steamId: '[U:1:100000001]', team },
        victim: { name: 'Player_06', steamId: '[U:1:100000006]', team: team === 'CT' ? 'TERRORIST' : 'CT' },
        headshot: true,
        weapon: 'ak47',
      },
    }) as any;

  beforeEach(async () => {
    persistence = {
      recordEventLog: jest.fn().mockResolvedValue({ id: BigInt(1) }),
      resolvePlayer: jest.fn().mockResolvedValue({ id: 'player-uuid-1', username: 'Player_01' }),
      recordPlayerKill: jest.fn().mockResolvedValue({ id: 'stat-1' }),
      findMatchMap: jest.fn().mockImplementation(async (id: string) =>
        id === MAP_UUID ? { id: MAP_UUID, matchId: 'match-uuid', match: { format: 'BO1' } } : null,
      ),
    };
    state = {
      getDbMatchMapId: jest.fn().mockResolvedValue(null),
      sideToLogical: jest.fn().mockImplementation(async (_m: string, side: string) => (side === 'CT' ? 'home' : 'away')),
      getTeamIds: jest.fn().mockResolvedValue({ home_id: HOME_UUID, away_id: AWAY_UUID }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseEventsHandler,
        { provide: TournamentPersistenceService, useValue: persistence },
        { provide: MatchStateService, useValue: state },
      ],
    }).compile();

    handler = module.get<DatabaseEventsHandler>(DatabaseEventsHandler);
  });

  it('records every event in EventPrimary keyed by the real-time matchId, even when not linked to a MatchMap', async () => {
    const event = { type: EventTypes.ROUND_START, matchId: 'm-sandbox-1', serverId: 'srv-a', timestamp: 1700000000000, payload: {} } as any;

    await handler.handle(event);

    expect(persistence.findMatchMap).not.toHaveBeenCalled(); // non-UUID matchId: no DB lookup
    expect(persistence.recordEventLog).toHaveBeenCalledWith(null, EventTypes.ROUND_START, {}, 1700000000000, {
      matchId: 'm-sandbox-1',
      serverId: 'srv-a',
    });
  });

  it('attaches events to the MatchMap linked at init (match:{id}:db_match_map)', async () => {
    state.getDbMatchMapId.mockResolvedValue(MAP_UUID);

    await handler.handle({ type: EventTypes.ROUND_START, matchId: 'm-final', payload: {}, timestamp: 1 } as any);

    expect(persistence.recordEventLog).toHaveBeenCalledWith(MAP_UUID, EventTypes.ROUND_START, {}, 1, {
      matchId: 'm-final',
      serverId: null,
    });
  });

  it('accepts a matchId that is directly the UUID of an existing MatchMap', async () => {
    await handler.handle({ type: EventTypes.ROUND_START, matchId: MAP_UUID, payload: {}, timestamp: 1 } as any);

    expect(persistence.recordEventLog).toHaveBeenCalledWith(MAP_UUID, EventTypes.ROUND_START, {}, 1, expect.any(Object));
  });

  it('caches the matchId → MatchMap resolution between events', async () => {
    state.getDbMatchMapId.mockResolvedValue(MAP_UUID);

    await handler.handle({ type: EventTypes.ROUND_START, matchId: 'm-final', payload: {} } as any);
    await handler.handle({ type: EventTypes.TEAM_ROUND_WIN, matchId: 'm-final', payload: { winner: 'CT' } } as any);

    expect(state.getDbMatchMapId).toHaveBeenCalledTimes(1);
    expect(persistence.findMatchMap).toHaveBeenCalledTimes(1);
  });

  it('records kill stats with the linked MatchMap and the killer team UUID (side → logical → team)', async () => {
    state.getDbMatchMapId.mockResolvedValue(MAP_UUID);

    await handler.handle(killEvent('m-final', 'TERRORIST'));

    expect(state.sideToLogical).toHaveBeenCalledWith('m-final', 'T');
    expect(persistence.resolvePlayer).toHaveBeenCalledWith({ steamId: '[U:1:100000001]', username: 'Player_01' });
    expect(persistence.recordPlayerKill).toHaveBeenCalledWith({
      matchMapId: MAP_UUID,
      playerId: 'player-uuid-1',
      teamId: AWAY_UUID,
      isHeadshot: true,
      damageDealt: 100,
    });
  });

  it('skips kill stats (but keeps the event log) when the match is not linked to a MatchMap', async () => {
    await handler.handle(killEvent('m-sandbox-1'));

    expect(persistence.recordEventLog).toHaveBeenCalled();
    expect(persistence.resolvePlayer).not.toHaveBeenCalled();
    expect(persistence.recordPlayerKill).not.toHaveBeenCalled();
  });

  it('skips kill stats when team ids are not database UUIDs', async () => {
    state.getDbMatchMapId.mockResolvedValue(MAP_UUID);
    state.getTeamIds.mockResolvedValue({ home_id: 'team-a', away_id: null });

    await handler.handle(killEvent('m-final'));

    expect(persistence.recordPlayerKill).not.toHaveBeenCalled();
  });

  it('ignores kill stats on world/suicide kills but still records the event log', async () => {
    state.getDbMatchMapId.mockResolvedValue(MAP_UUID);
    const suicideEvent = {
      type: EventTypes.KILL,
      matchId: 'm-final',
      timestamp: 1700000002000,
      payload: { kind: 'suicide', player: { name: 'Player_01', steamId: '[U:1:100000001]', team: 'CT' } },
    } as any;

    await handler.handle(suicideEvent);

    expect(persistence.recordEventLog).toHaveBeenCalled();
    expect(persistence.recordPlayerKill).not.toHaveBeenCalled();
  });

  it('safely swallows database errors to prevent match engine crashes', async () => {
    persistence.recordEventLog.mockRejectedValueOnce(new Error('DB connection timed out'));

    const event = { type: EventTypes.BOMB_PLANTED, matchId: 'match-1', payload: {} } as any;

    await expect(handler.handle(event)).resolves.not.toThrow();
  });
});
