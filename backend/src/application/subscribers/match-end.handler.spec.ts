/**
 * Tests unitaires — MatchEndHandler
 *
 * TC-E01 : CS_WIN_PANEL_MATCH → triggerMatchEnd('cs_win_panel_match') + transition POSTGAME
 * TC-E02 : CS_WIN_PANEL_MATCH idempotent si déjà en POSTGAME
 * TC-E03 : CS_INTERMISSION en OVERTIME → fin de match (overtime_end)
 * TC-E04 : CS_INTERMISSION en LIVE_MAIN (round <= maxRounds/2) → runHalftime (fallback)
 * TC-E05 : CS_INTERMISSION en LIVE_MAIN (round > maxRounds/2) → ignoré
 * TC-E06 : BEGIN_NEW_MATCH → reset score + setPhase WARMUP_MAIN + push WS
 * TC-E07 : Autre type d'event → ignoré
 */
import { MatchEndHandler } from './match-end.handler';
import { EventTypes } from '@domain/events/event.types';
import { MatchPhase } from '@domain/phase.types';

const MATCH_ID = 'm-end';

const DEFAULT_SNAPSHOT = { score: { home: 5, away: 10, round: 15 }, matchId: MATCH_ID };

function makeOrch(phase: MatchPhase = MatchPhase.LIVE_MAIN) {
  return {
    getPhase:       jest.fn().mockResolvedValue(phase),
    triggerMatchEnd: jest.fn().mockResolvedValue(undefined),
    runHalftime:     jest.fn().mockResolvedValue(undefined),
    setPhase:        jest.fn().mockResolvedValue(undefined),
    push:            jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeState(opts: { round?: number; score?: any; config?: any; snapshot?: any } = {}) {
  return {
    initScore:      jest.fn().mockResolvedValue(undefined),
    getRound:       jest.fn().mockResolvedValue(opts.round ?? 15),
    getScore:       jest.fn().mockResolvedValue(opts.score ?? { t: 5, ct: 10 }),
    getMatchConfig: jest.fn().mockResolvedValue(opts.config ?? { maxRounds: 30, winRounds: 16, overtimeEnabled: false }),
    getSnapshot:    jest.fn().mockResolvedValue(opts.snapshot ?? DEFAULT_SNAPSHOT),
  } as any;
}

function makeEvent(type: string) {
  return { type, matchId: MATCH_ID } as any;
}

// ---------------------------------------------------------------------------
// TC-E01 — CS_WIN_PANEL_MATCH
// ---------------------------------------------------------------------------
describe('TC-E01 — MatchEndHandler : cs_win_panel_match → POSTGAME', () => {
  it('appelle triggerMatchEnd avec reason=cs_win_panel_match', async () => {
    const orch    = makeOrch(MatchPhase.LIVE_MAIN);
    const state   = makeState();
    const handler = new MatchEndHandler(orch, state);

    await handler.handle(makeEvent(EventTypes.CS_WIN_PANEL_MATCH));

    expect(orch.triggerMatchEnd).toHaveBeenCalledWith(MATCH_ID, 'cs_win_panel_match');
  });
});

// ---------------------------------------------------------------------------
// TC-E02 — CS_WIN_PANEL_MATCH idempotent
// ---------------------------------------------------------------------------
describe('TC-E02 — MatchEndHandler : cs_win_panel_match idempotent si déjà POSTGAME', () => {
  it('ne rappelle pas triggerMatchEnd si déjà en POSTGAME', async () => {
    const orch    = makeOrch(MatchPhase.POSTGAME);
    const state   = makeState();
    const handler = new MatchEndHandler(orch, state);

    await handler.handle(makeEvent(EventTypes.CS_WIN_PANEL_MATCH));

    expect(orch.triggerMatchEnd).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-E03 — CS_INTERMISSION en OVERTIME
// ---------------------------------------------------------------------------
describe('TC-E03 — MatchEndHandler : cs_intermission en OVERTIME', () => {
  it('déclenche triggerMatchEnd(overtime_end)', async () => {
    const orch    = makeOrch(MatchPhase.OVERTIME);
    const state   = makeState();
    const handler = new MatchEndHandler(orch, state);

    await handler.handle(makeEvent(EventTypes.CS_INTERMISSION));

    expect(orch.triggerMatchEnd).toHaveBeenCalledWith(MATCH_ID, 'overtime_end');
    expect(orch.runHalftime).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-E04 — CS_INTERMISSION en LIVE_MAIN, round <= maxRounds/2 → halftime fallback
// ---------------------------------------------------------------------------
describe('TC-E04 — MatchEndHandler : cs_intermission mi-temps (fallback)', () => {
  it('appelle runHalftime si round <= maxRounds/2', async () => {
    const orch    = makeOrch(MatchPhase.LIVE_MAIN);
    const state   = makeState({ round: 15, config: { maxRounds: 30, winRounds: 16, overtimeEnabled: false } });
    const handler = new MatchEndHandler(orch, state);

    await handler.handle(makeEvent(EventTypes.CS_INTERMISSION));

    expect(orch.runHalftime).toHaveBeenCalledWith(MATCH_ID);
    expect(orch.triggerMatchEnd).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-E05 — CS_INTERMISSION en LIVE_MAIN, round > maxRounds/2 → ignoré
// ---------------------------------------------------------------------------
describe('TC-E05 — MatchEndHandler : cs_intermission ignoré si round > maxRounds/2', () => {
  it('ne déclenche rien si round dépasse la mi-temps', async () => {
    const orch    = makeOrch(MatchPhase.LIVE_MAIN);
    const state   = makeState({ round: 20, config: { maxRounds: 30, winRounds: 16, overtimeEnabled: false } });
    const handler = new MatchEndHandler(orch, state);

    await handler.handle(makeEvent(EventTypes.CS_INTERMISSION));

    expect(orch.runHalftime).not.toHaveBeenCalled();
    expect(orch.triggerMatchEnd).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-E06 — BEGIN_NEW_MATCH
// ---------------------------------------------------------------------------
describe('TC-E06 — MatchEndHandler : begin_new_match', () => {
  it('reset score, setPhase WARMUP_MAIN, push match:state', async () => {
    const orch    = makeOrch(MatchPhase.POSTGAME);
    const state   = makeState();
    const handler = new MatchEndHandler(orch, state);

    await handler.handle(makeEvent(EventTypes.BEGIN_NEW_MATCH));

    expect(state.initScore).toHaveBeenCalledWith(MATCH_ID);
    expect(orch.setPhase).toHaveBeenCalledWith(MATCH_ID, MatchPhase.WARMUP_MAIN);
    expect(orch.push).toHaveBeenCalledWith(
      MATCH_ID,
      'match:state',
      expect.objectContaining({ matchId: MATCH_ID }),
    );
  });
});

// ---------------------------------------------------------------------------
// TC-E07 — Event non géré
// ---------------------------------------------------------------------------
describe('TC-E07 — MatchEndHandler : event non géré ignoré', () => {
  it('ne fait rien pour un type inconnu', async () => {
    const orch    = makeOrch();
    const state   = makeState();
    const handler = new MatchEndHandler(orch, state);

    await handler.handle(makeEvent(EventTypes.ROUND_START));

    expect(orch.triggerMatchEnd).not.toHaveBeenCalled();
    expect(orch.runHalftime).not.toHaveBeenCalled();
    expect(state.initScore).not.toHaveBeenCalled();
    expect(orch.setPhase).not.toHaveBeenCalled();
  });
});
