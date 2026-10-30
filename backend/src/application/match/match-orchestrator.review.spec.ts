/**
 * Server Game Over vs GG-Core (seen on a real server: CS2 declared a 3-3 DRAW after OT1 while GG-Core
 * announced OT2). Score = server, verdict = GG-Core rules; any disagreement freezes the result for an admin.
 */
import { MatchOrchestrator } from './match-orchestrator.service';
import { DEFAULT_MATCH_SETTINGS, MatchReview } from '@domain/match-settings.types';
import { MatchPhase } from '@domain/phase.types';

const MATCH_ID = 'm-review';
const SERVER_ID = 'srv-a';

function setup(phase: string, ggScore: { ct: number; t: number }) {
  let review: MatchReview | null = null;
  const cmds = {
    rcon: jest.fn().mockResolvedValue({ ok: true }),
    exec: jest.fn().mockResolvedValue({ ok: true }),
    say: jest.fn().mockResolvedValue(undefined),
    kickAll: jest.fn().mockResolvedValue({ ok: true }),
  };
  const state = {
    getPhase: jest.fn().mockResolvedValue(phase),
    getSnapshot: jest.fn().mockResolvedValue({ score: ggScore, teams: {}, sides: { home: 'CT', away: 'T' } }),
    getReview: jest.fn(async () => review),
    setReview: jest.fn(async (_m: string, r: MatchReview | null) => { review = r; }),
    reconcileScore: jest.fn().mockResolvedValue(undefined),
    getServerIdFromMatchId: jest.fn().mockResolvedValue(SERVER_ID),
    getMatchIdFromServerId: jest.fn().mockResolvedValue(MATCH_ID),
    getSettings: jest.fn().mockResolvedValue({ ...DEFAULT_MATCH_SETTINGS, postgameKickDelaySec: 0 }),
  };
  const ws = { push: jest.fn().mockResolvedValue(undefined) };
  const ctxFactory = { make: jest.fn(() => ({ serverId: SERVER_ID, say: jest.fn() })) };
  const orch = new MatchOrchestrator(ws as any, {} as any, {} as any, cmds as any, state as any, {} as any, ctxFactory as any, {} as any);
  const endMatch = jest.spyOn(orch, 'endMatch').mockResolvedValue(undefined);
  return { orch, cmds, state, ws, endMatch, getReview: () => review };
}

describe('MatchOrchestrator - server Game Over review', () => {
  it('confirme sans rien geler quand GG-Core est en postgame avec le même score', async () => {
    const t = setup(MatchPhase.POSTGAME, { ct: 5, t: 7 });
    await t.orch.checkServerGameOver(MATCH_ID, SERVER_ID, { ct: 5, t: 7 });
    expect(t.getReview()).toBeNull();
    expect(t.ws.push).not.toHaveBeenCalled();
  });

  it("gèle le résultat quand le serveur termine alors que GG-Core continue (nul 3-3 après OT1)", async () => {
    const t = setup(MatchPhase.OVERTIME, { ct: 3, t: 3 });
    await t.orch.checkServerGameOver(MATCH_ID, SERVER_ID, { ct: 3, t: 3 });

    expect(t.getReview()).toEqual(expect.objectContaining({
      reason: 'server_ended_match', serverScore: { ct: 3, t: 3 }, ggPhase: MatchPhase.OVERTIME,
    }));
    expect(t.ws.push).toHaveBeenCalledWith(MATCH_ID, 'match:review_required', expect.objectContaining({ matchId: MATCH_ID }), 'admin');
    expect(t.cmds.say).toHaveBeenCalledWith(SERVER_ID, expect.stringContaining('un admin va arbitrer'));
    expect(t.endMatch).not.toHaveBeenCalled();
  });

  it('gèle aussi quand les deux ont fini mais avec des scores différents', async () => {
    const t = setup(MatchPhase.POSTGAME, { ct: 13, t: 11 });
    await t.orch.checkServerGameOver(MATCH_ID, SERVER_ID, { ct: 11, t: 13 });
    expect(t.getReview()?.reason).toBe('final_score_mismatch');
  });

  it("accept-server : reprend le score du serveur et termine le match (nul si égalité)", async () => {
    const t = setup(MatchPhase.OVERTIME, { ct: 3, t: 3 });
    await t.orch.checkServerGameOver(MATCH_ID, SERVER_ID, { ct: 3, t: 3 });

    const res = await t.orch.resolveReview(MATCH_ID, 'accept_server');

    expect(res).toEqual({ ok: true, decision: 'accept_server' });
    expect(t.state.reconcileScore).toHaveBeenCalledWith(MATCH_ID, 3, 3);
    expect(t.endMatch).toHaveBeenCalledWith(MATCH_ID, null, expect.anything());
    expect(t.getReview()).toBeNull();
  });

  it('dismiss : lève le gel sans toucher au match', async () => {
    const t = setup(MatchPhase.OVERTIME, { ct: 3, t: 3 });
    await t.orch.checkServerGameOver(MATCH_ID, SERVER_ID, { ct: 3, t: 3 });

    await t.orch.resolveReview(MATCH_ID, 'dismiss');

    expect(t.getReview()).toBeNull();
    expect(t.endMatch).not.toHaveBeenCalled();
    expect(t.state.reconcileScore).not.toHaveBeenCalled();
    expect(t.ws.push).toHaveBeenCalledWith(MATCH_ID, 'match:review_resolved', expect.objectContaining({ decision: 'dismiss' }), 'admin');
  });

  it('refuse une décision quand aucun résultat n’est gelé', async () => {
    const t = setup(MatchPhase.LIVE_MAIN, { ct: 1, t: 0 });
    expect(await t.orch.resolveReview(MATCH_ID, 'dismiss')).toEqual({ ok: false, why: 'no_review' });
  });
});
