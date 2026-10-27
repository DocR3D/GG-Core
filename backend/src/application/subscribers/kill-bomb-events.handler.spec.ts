import { KillAndBombEventsHandler } from './kill-bomb-events.handler';
import { EventTypes } from '@domain/events/event.types';

describe('KillAndBombEventsHandler', () => {
  let handler: KillAndBombEventsHandler;
  let mockOrchestrator: any;
  let mockMatchState: any;

  beforeEach(() => {
    mockOrchestrator = {
      onBombPlanted: jest.fn().mockResolvedValue(undefined),
    };
    mockMatchState = {
      recordKill: jest.fn().mockResolvedValue(undefined),
      recordAssist: jest.fn().mockResolvedValue(undefined),
      recordBombPlant: jest.fn().mockResolvedValue(undefined),
      recordBombDefuse: jest.fn().mockResolvedValue(undefined),
      sideToLogical: jest.fn().mockResolvedValue('home'),
      upsertPlayer: jest.fn().mockResolvedValue(undefined),
    };
    handler = new KillAndBombEventsHandler(mockOrchestrator, mockMatchState);
  });

  it('records kill and auto-upserts players to roster', async () => {
    const killEv = {
      type: EventTypes.KILL,
      matchId: 'm-test',
      payload: {
        kind: 'player',
        killer: { steamId: 'p1', name: 'ZywOo', team: 'CT' },
        victim: { steamId: 'p2', name: 's1mple', team: 'TERRORIST' },
        headshot: true,
      },
    } as any;

    await handler.handle(killEv);

    expect(mockMatchState.recordKill).toHaveBeenCalledWith(
      'm-test',
      { steamId: 'p1', name: 'ZywOo' },
      { steamId: 'p2', name: 's1mple' },
      true,
      false,
    );
    expect(mockMatchState.upsertPlayer).toHaveBeenCalledWith(
      'm-test',
      {
        steamId: 'p1',
        name: 'ZywOo',
        logical: 'home',
      },
      { preserveLogical: false },
    );
  });

  it('records assists', async () => {
    const assistEv = {
      type: EventTypes.ASSIST,
      matchId: 'm-test',
      payload: {
        player: { steamId: 'p3', name: 'Spinx', team: 'CT' },
        victim: { steamId: 'p2', name: 's1mple', team: 'TERRORIST' },
        flashAssist: false,
      },
    } as any;

    await handler.handle(assistEv);

    expect(mockMatchState.recordAssist).toHaveBeenCalledWith(
      'm-test',
      {
        steamId: 'p3',
        name: 'Spinx',
      },
      false,
    );
  });

  it('records bomb plant and notifies orchestrator', async () => {
    const plantEv = {
      type: EventTypes.BOMB_PLANTED,
      matchId: 'm-test',
      payload: {
        planter: { steamId: 'p2', name: 's1mple' },
        site: 'A',
      },
    } as any;

    await handler.handle(plantEv);

    expect(mockOrchestrator.onBombPlanted).toHaveBeenCalledWith(plantEv);
    expect(mockMatchState.recordBombPlant).toHaveBeenCalledWith('m-test', {
      steamId: 'p2',
      name: 's1mple',
    });
  });

  it('records bomb defuse', async () => {
    const defuseEv = {
      type: EventTypes.BOMB_DEFUSED,
      matchId: 'm-test',
      payload: {
        defuser: { steamId: 'p1', name: 'ZywOo' },
        site: 'B',
      },
    } as any;

    await handler.handle(defuseEv);

    expect(mockMatchState.recordBombDefuse).toHaveBeenCalledWith('m-test', {
      steamId: 'p1',
      name: 'ZywOo',
    });
  });

  it('records suicide as victim death without killer', async () => {
    const suicideEv = {
      type: EventTypes.KILL,
      matchId: 'm-test',
      payload: {
        kind: 'suicide',
        player: { steamId: 'p2', name: 's1mple', team: 'TERRORIST' },
      },
    } as any;

    await handler.handle(suicideEv);

    expect(mockMatchState.recordKill).toHaveBeenCalledWith(
      'm-test',
      undefined,
      { steamId: 'p2', name: 's1mple' },
      false,
    );
    expect(mockMatchState.upsertPlayer).toHaveBeenCalledWith(
      'm-test',
      {
        steamId: 'p2',
        name: 's1mple',
        logical: 'home',
      },
      { preserveLogical: false },
    );
  });

  it('preserves player logical team once 12 or more rounds have been scored', async () => {
    mockMatchState.getScore = jest.fn().mockResolvedValue({ ct: 12, t: 12, round: 24 });

    await handler.handle({
      type: EventTypes.KILL,
      matchId: 'm-test',
      payload: {
        kind: 'player',
        killer: { steamId: 'p1', name: 'ZywOo', team: 'CT' },
        victim: { steamId: 'p2', name: 's1mple', team: 'TERRORIST' },
        headshot: false,
      },
    } as any);

    expect(mockMatchState.upsertPlayer).toHaveBeenCalledWith(
      'm-test',
      {
        steamId: 'p1',
        name: 'ZywOo',
        logical: 'home',
      },
      { preserveLogical: true },
    );
  });

  it('ignores combat events when match phase is POSTGAME', async () => {
    mockMatchState.getPhase = jest.fn().mockResolvedValue('postgame');

    await handler.handle({
      type: EventTypes.KILL,
      matchId: 'm-test',
      payload: {
        kind: 'player',
        killer: { steamId: 'p1', name: 'ZywOo', team: 'CT' },
        victim: { steamId: 'p2', name: 's1mple', team: 'TERRORIST' },
        headshot: false,
      },
    } as any);

    expect(mockMatchState.recordKill).not.toHaveBeenCalled();
    expect(mockMatchState.upsertPlayer).not.toHaveBeenCalled();
  });

  it('ignores technical suicide when player team is Unassigned or Spectator', async () => {
    const suicideEv = {
      type: EventTypes.KILL,
      matchId: 'm-test',
      payload: {
        kind: 'suicide',
        player: { steamId: 'p8', name: 'Player_08', team: 'Unassigned' },
      },
    } as any;

    await handler.handle(suicideEv);

    expect(mockMatchState.recordKill).not.toHaveBeenCalled();
    expect(mockMatchState.upsertPlayer).not.toHaveBeenCalled();
  });

  it('credits defuser from DEFUSE_BEGIN when TEAM_ROUND_WIN has reason=defused', async () => {
    await handler.handle({
      type: EventTypes.DEFUSE_BEGIN,
      matchId: 'm-test',
      payload: {
        player: { steamId: 'p1', name: 'ZywOo', team: 'CT' },
        hasKit: true,
      },
    } as any);

    await handler.handle({
      type: EventTypes.TEAM_ROUND_WIN,
      matchId: 'm-test',
      payload: {
        winner: 'CT',
        reason: 'defused',
      },
    } as any);

    expect(mockMatchState.recordBombDefuse).toHaveBeenCalledWith('m-test', {
      steamId: 'p1',
      name: 'ZywOo',
    });
  });

  it('detects teamkill when killer and victim share the same team', async () => {
    await handler.handle({
      type: EventTypes.KILL,
      matchId: 'm-test',
      payload: {
        kind: 'player',
        killer: { steamId: 'p1', name: 'ZywOo', team: 'CT' },
        victim: { steamId: 'p3', name: 'Spinx', team: 'CT' },
        headshot: true,
      },
    } as any);

    expect(mockMatchState.recordKill).toHaveBeenCalledWith(
      'm-test',
      { steamId: 'p1', name: 'ZywOo' },
      { steamId: 'p3', name: 'Spinx' },
      true,
      true,
    );
  });

  it('ignores friendly-fire assists when assister and victim share the same team', async () => {
    await handler.handle({
      type: EventTypes.ASSIST,
      matchId: 'm-test',
      payload: {
        player: { steamId: 'p1', name: 'ZywOo', team: 'TERRORIST' },
        victim: { steamId: 'p2', name: 'apEX', team: 'TERRORIST' },
        flashAssist: false,
      },
    } as any);

    expect(mockMatchState.recordAssist).not.toHaveBeenCalled();
  });
});
