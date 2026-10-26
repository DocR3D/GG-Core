/**
 * Tests de robustesse et résistance aux rafales (Burst / Rapid-Fire Replay) — LiveRule
 * Simule les cas réels observés lors des replays Sandbox accélérés ou des reconnexions
 */
import { LiveRule } from './live.rule';
import { EventTypes } from '@domain/events/event.types';
import { MatchPhase } from '@domain/phase.types';

const MATCH_ID = 'm-burst-test';
const SERVER_ID = 'srv-a';

describe('LiveRule — Burst & Rapid-Fire Replay Stress Tests', () => {
  let rule: LiveRule;

  beforeEach(() => {
    rule = new LiveRule();
  });

  function makeBurstContext() {
    let currentScore = { ct: 0, t: 0, round: 0 };
    let lastScoredRound = 0;
    let halftimePlayed = false;
    let currentPhase = MatchPhase.LIVE_MAIN;

    const ctx = {
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      say: jest.fn().mockResolvedValue(undefined),
      orch: {
        rcon: jest.fn().mockResolvedValue(undefined),
        restartGame: jest.fn().mockResolvedValue(undefined),
        push: jest.fn().mockResolvedValue(undefined),
        roundEnd: jest.fn().mockImplementation(async (_mid: string, winner: 'CT' | 'T') => {
          if (winner === 'CT') currentScore.ct++;
          else currentScore.t++;
          currentScore.round = currentScore.ct + currentScore.t;
        }),
        setPhase: jest.fn().mockImplementation(async (_mid: string, p: MatchPhase) => {
          currentPhase = p;
        }),
        swapSides: jest.fn().mockResolvedValue(true),
        endMatch: jest.fn().mockResolvedValue(undefined),
      },
      state: {
        getServerIdFromMatchId: jest.fn().mockResolvedValue(SERVER_ID),
        getSnapshot: jest.fn().mockImplementation(async () => ({
          score: { ...currentScore },
          sides: { home: 'CT', away: 'T' },
          teams: { home_name: 'TeamA', away_name: 'TeamB' },
        })),
        getLastScoredRound: jest.fn().mockImplementation(async () => lastScoredRound),
        setLastScoredRound: jest.fn().mockImplementation(async (_mid: string, r: number) => {
          lastScoredRound = r;
        }),
        isHalftimePlayed: jest.fn().mockImplementation(async () => halftimePlayed),
        setHalftimePlayed: jest.fn().mockImplementation(async (_mid: string, v: boolean) => {
          halftimePlayed = v;
        }),
        getOvertimeCount: jest.fn().mockResolvedValue(0),
        setOvertimeCount: jest.fn().mockResolvedValue(undefined),
        getSettings: jest.fn().mockResolvedValue({ mrFormat: 12, overtimeEnabled: true, warmupAtHalftime: false }),
      },
      getScore: () => ({ ...currentScore }),
      getPhase: () => currentPhase,
      getLastScored: () => lastScoredRound,
    };

    return ctx;
  }

  it('drops duplicate round win events in a rapid burst of identical rounds', async () => {
    const ctx = makeBurstContext();
    const handler = (rule as any).events.get(EventTypes.TEAM_ROUND_WIN);

    // Envoi en rafale de 10 événements avec le MÊME numéro de round (ex: round 5)
    const duplicateEvents = Array.from({ length: 10 }, () => ({
      matchId: MATCH_ID,
      round: 5,
      type: EventTypes.TEAM_ROUND_WIN,
      payload: { winner: 'CT', reason: 'elim' },
    }));

    for (const ev of duplicateEvents) {
      await handler(ev, ctx as any);
    }

    // Un seul roundEnd doit être pris en compte
    expect(ctx.orch.roundEnd).toHaveBeenCalledTimes(1);
    expect(ctx.getScore().ct).toBe(1);
    expect(ctx.getLastScored()).toBe(5);
  });

  it('handles rapid sequential replay of 20 rounds from 0 to regulation victory (13-7)', async () => {
    const ctx = makeBurstContext();
    const handler = (rule as any).events.get(EventTypes.TEAM_ROUND_WIN);

    // Séquence de 20 victoires consécutives (13 CT, 7 T)
    const winners: ('CT' | 'T')[] = [
      'CT', 'CT', 'T', 'CT', 'T', 'CT', 'CT', 'CT', 'T', 'CT', 'T', 'CT', // Mi-temps : 8 - 4
      'T', 'CT', 'T', 'CT', 'CT', 'T', 'CT', 'CT'                         // Fin : 13 - 7
    ];

    for (let r = 1; r <= winners.length; r++) {
      const ev = {
        matchId: MATCH_ID,
        round: r,
        type: EventTypes.TEAM_ROUND_WIN,
        payload: { winner: winners[r - 1], reason: 'elim' },
      };
      await handler(ev, ctx as any);
    }

    const finalScore = ctx.getScore();
    expect(finalScore.ct).toBe(13);
    expect(finalScore.t).toBe(7);
    expect(finalScore.round).toBe(20);

    // Vérifier la détection de mi-temps au round 12
    expect(ctx.orch.rcon).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'mp_swapteams' }),
    );
    expect(ctx.orch.swapSides).toHaveBeenCalledTimes(1);

    // Vérifier la fin de match au 13ème round gagné
    expect(ctx.orch.endMatch).toHaveBeenCalledTimes(1);
    expect(ctx.orch.endMatch).toHaveBeenCalledWith(MATCH_ID, 'CT', expect.anything());
  });

  it('triggers Overtime transition when score reaches 12-12 during rapid burst', async () => {
    const ctx = makeBurstContext();
    const handler = (rule as any).events.get(EventTypes.TEAM_ROUND_WIN);

    // 24 rounds alternés pour arriver à 12 - 12
    for (let r = 1; r <= 24; r++) {
      const winner = r % 2 === 0 ? 'T' : 'CT';
      const ev = {
        matchId: MATCH_ID,
        round: r,
        type: EventTypes.TEAM_ROUND_WIN,
        payload: { winner, reason: 'elim' },
      };
      await handler(ev, ctx as any);
    }

    expect(ctx.getScore()).toEqual({ ct: 12, t: 12, round: 24 });
    expect(ctx.orch.setPhase).toHaveBeenCalledWith(MATCH_ID, MatchPhase.OVERTIME);
  });
});
