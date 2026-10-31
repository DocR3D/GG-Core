/**
 * MatchEventsHandler: the server's game_over goes to the orchestrator (never to the rules), and while a
 * result is frozen for an admin, game events are only archived (the server may have restarted a game).
 */
import { MatchEventsHandler } from './match-events.handler';

const MATCH_ID = 'm-freeze';

function setup(review: object | null) {
  const orch = { onServerGameOver: jest.fn() };
  const ruleHandler = jest.fn().mockResolvedValue(undefined);
  const rule = { name: 'live', events: new Map([['team_round_win', ruleHandler]]) };
  const deps = {
    phaseHandler: { handle: jest.fn().mockResolvedValue(false) },
    roundHandler: { handle: jest.fn().mockResolvedValue(undefined) },
    combatHandler: { handle: jest.fn().mockResolvedValue(undefined) },
    dbHandler: { handle: jest.fn().mockResolvedValue(undefined) },
    registry: { getRule: jest.fn().mockReturnValue(rule) },
    phase: { getPhase: jest.fn().mockResolvedValue('live_main') },
    mss: { getReview: jest.fn().mockResolvedValue(review), getMatchIdFromServerId: jest.fn() },
    ctxFactory: { make: jest.fn(() => ({ orch })), orchestrator: orch },
  };
  const handler = new MatchEventsHandler(
    deps.phaseHandler as any, deps.roundHandler as any, deps.combatHandler as any, deps.dbHandler as any,
    deps.registry as any, deps.phase as any, deps.mss as any, deps.ctxFactory as any,
    {} as any, {} as any, // access (whitelist), placement (sides): not on the game over path
  );
  return { handler, deps, orch, ruleHandler };
}

describe('MatchEventsHandler - Game Over & frozen result', () => {
  it('envoie game_over (score CT:T) à l’orchestrateur, sans passer par les règles', async () => {
    const t = setup(null);
    await t.handler.handle({ type: 'game_over', matchId: MATCH_ID, serverId: 'srv-a', payload: { scoreCT: 3, scoreT: 3 } } as any);
    expect(t.orch.onServerGameOver).toHaveBeenCalledWith(MATCH_ID, 'srv-a', { ct: 3, t: 3 });
    expect(t.deps.registry.getRule).not.toHaveBeenCalled();
  });

  it('résultat gelé : archive l’événement mais ne touche ni au score, ni aux stats, ni aux règles', async () => {
    const t = setup({ reason: 'server_ended_match' });
    await t.handler.handle({ type: 'team_round_win', matchId: MATCH_ID, serverId: 'srv-a', payload: {} } as any);
    expect(t.deps.dbHandler.handle).toHaveBeenCalled();
    expect(t.deps.roundHandler.handle).not.toHaveBeenCalled();
    expect(t.deps.combatHandler.handle).not.toHaveBeenCalled();
    expect(t.ruleHandler).not.toHaveBeenCalled();
  });

  it('sans gel, le flux normal continue jusqu’à la règle active', async () => {
    const t = setup(null);
    await t.handler.handle({ type: 'team_round_win', matchId: MATCH_ID, serverId: 'srv-a', payload: {} } as any);
    expect(t.ruleHandler).toHaveBeenCalled();
  });
});
