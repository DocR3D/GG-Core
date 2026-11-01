/**
 * MatchOrchestrator.endMatch - postgame server actions (seen on a real CS2 server):
 *  - the warmup reset waits for the end-of-match intermission (postgameResetDelaySec);
 *  - players still connected are kicked after postgameKickDelaySec (people stay on the server at the LAN);
 *  - neither touches the server if a new match was started on it meanwhile.
 */
import { MatchOrchestrator } from './match-orchestrator.service';
import { DEFAULT_MATCH_SETTINGS } from '@domain/match-settings.types';

const MATCH_ID = 'm-postgame';
const SERVER_ID = 'srv-a';

function setup(settings: Partial<typeof DEFAULT_MATCH_SETTINGS> = {}, persistence?: any) {
  const cmds = {
    rcon: jest.fn().mockResolvedValue({ ok: true }),
    exec: jest.fn().mockResolvedValue({ ok: true }),
    kickAll: jest.fn().mockResolvedValue({ ok: true }),
  };
  const state = {
    getServerIdFromMatchId: jest.fn().mockResolvedValue(SERVER_ID),
    getMatchIdFromServerId: jest.fn().mockResolvedValue(MATCH_ID),
    getSettings: jest.fn().mockResolvedValue({ ...DEFAULT_MATCH_SETTINGS, ...settings }),
    getSnapshot: jest.fn().mockResolvedValue({
      score: { ct: 13, t: 7 },
      teams: { home_name: 'Team Alpha', away_name: 'Team Bravo' },
      sides: { home: 'CT', away: 'T' },
    }),
    sideToLogical: jest.fn().mockResolvedValue('home'),
    getDbMatchMapId: jest.fn().mockResolvedValue(null),
  };
  const ws = { push: jest.fn().mockResolvedValue(undefined) };
  const sides = { setPhase: jest.fn().mockResolvedValue(undefined) };
  const orch = new MatchOrchestrator(ws as any, {} as any, {} as any, cmds as any, state as any, sides as any, {} as any, {} as any, persistence);
  const ctx = { serverId: SERVER_ID, say: jest.fn().mockResolvedValue(undefined) } as any;
  return { orch, cmds, state, ctx };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('MatchOrchestrator.endMatch - résultat du game en base', () => {
  it('écrit le score home/away (selon les côtés finaux) en automatique / confirmé', async () => {
    const persistence = {
      recordGameResult: jest.fn().mockResolvedValue(null),
      resolveBracketMatchId: jest.fn().mockResolvedValue(null),
    };
    const { orch, state, ctx } = setup({ postgameKickDelaySec: 0 }, persistence);
    state.getDbMatchMapId.mockResolvedValue('map-uuid');
    // home a fini côté T : CT 7 - T 13 → home 13, away 7
    state.getSnapshot.mockResolvedValue({ score: { ct: 7, t: 13 }, teams: { home_name: 'A', away_name: 'B' }, sides: { home: 'T', away: 'CT' } });

    await orch.endMatch(MATCH_ID, 'T', ctx);

    expect(persistence.recordGameResult).toHaveBeenCalledWith(expect.objectContaining({
      matchMapId: 'map-uuid', scoreHome: 13, scoreAway: 7, source: 'AUTOMATIC', status: 'CONFIRMED', reportedBy: 'cs2',
    }));
  });
});

describe('MatchOrchestrator.endMatch - postgame', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reset après postgameResetDelaySec puis kick de tous les joueurs après postgameKickDelaySec', async () => {
    const { orch, cmds, ctx } = setup({ postgameResetDelaySec: 30, postgameKickDelaySec: 120 });
    await orch.endMatch(MATCH_ID, 'CT', ctx);

    expect(cmds.rcon).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'mp_warmup_start 1' }));
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(cmds.rcon).toHaveBeenCalledWith(expect.objectContaining({ command: 'mp_warmup_start 1' }));
    expect(cmds.kickAll).not.toHaveBeenCalled();

    jest.advanceTimersByTime(90_000);
    await flush();
    expect(cmds.kickAll).toHaveBeenCalledWith(expect.objectContaining({ serverId: SERVER_ID }));
  });

  it('ne kicke personne si un nouveau match a démarré sur le serveur entre-temps', async () => {
    const { orch, cmds, state, ctx } = setup({ postgameKickDelaySec: 120 });
    await orch.endMatch(MATCH_ID, 'CT', ctx);
    state.getMatchIdFromServerId.mockResolvedValue('m-next');

    jest.advanceTimersByTime(120_000);
    await flush();
    expect(cmds.kickAll).not.toHaveBeenCalled();
    expect(cmds.rcon).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'mp_warmup_start 1' }));
  });

  it('postgameKickDelaySec = 0 désactive le kick', async () => {
    const { orch, cmds, ctx } = setup({ postgameKickDelaySec: 0 });
    await orch.endMatch(MATCH_ID, 'CT', ctx);
    jest.advanceTimersByTime(600_000);
    await flush();
    expect(cmds.kickAll).not.toHaveBeenCalled();
  });

  it("postgameAction 'restart' : quit (qui déconnecte déjà tout le monde), pas de kick", async () => {
    const { orch, cmds, ctx } = setup({ postgameAction: 'restart', postgameKickDelaySec: 120 });
    await orch.endMatch(MATCH_ID, 'CT', ctx);
    jest.advanceTimersByTime(600_000);
    await flush();
    expect(cmds.rcon).toHaveBeenCalledWith(expect.objectContaining({ command: 'quit' }));
    expect(cmds.kickAll).not.toHaveBeenCalled();
  });
});
