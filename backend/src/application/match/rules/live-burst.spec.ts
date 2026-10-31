/**
 * Tests de robustesse et résistance aux rafales (Burst / Rapid-Fire Replay) - LiveRule
 * Simule les cas réels observés lors des replays Sandbox accélérés ou des reconnexions
 */
import { LiveRule } from './live.rule';
import type { PauseCommand } from '@app/match/commands/pause.command';
import { EventTypes } from '@domain/events/event.types';
import { MatchPhase } from '@domain/phase.types';

const MATCH_ID = 'm-burst-test';
const SERVER_ID = 'srv-a';

describe('LiveRule - Burst & Rapid-Fire Replay Stress Tests', () => {
  let rule: LiveRule;

  beforeEach(() => {
    rule = new LiveRule({} as PauseCommand);
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
        swapSides: jest.fn().mockImplementation(async () => {
          const tmp = currentScore.ct;
          currentScore.ct = currentScore.t;
          currentScore.t = tmp;
          return true;
        }),
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

    // 1ère mi-temps : Team 1 (sur CT) mène 8 - 4
    // 2ème mi-temps : Inversion des camps (Team 1 est sur T avec 8 pts, Team 2 est sur CT avec 4 pts)
    // Team 1 marque 5 points sur T pour atteindre 13-7
    const winners: ('CT' | 'T')[] = [
      'CT', 'CT', 'T', 'CT', 'T', 'CT', 'CT', 'CT', 'T', 'CT', 'T', 'CT', // Mi-temps : 8 - 4 (Team 1 sur CT)
      'CT', 'T', 'CT', 'T', 'CT', 'T', 'T', 'T'                          // 2ème mi-temps : Team 2 sur CT marque 3, Team 1 sur T marque 5
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
    expect(finalScore.ct).toBe(7);  // Team 2 sur CT
    expect(finalScore.t).toBe(13);  // Team 1 sur T (13 points gagnants !)
    expect(finalScore.round).toBe(20);

    // Vérifier la détection de mi-temps au round 12 (CS2 inverse lui-même : pas de mp_swapteams)
    expect(ctx.orch.swapSides).toHaveBeenCalledTimes(1);
    expect(ctx.orch.rcon).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'mp_swapteams' }));

    // Vérifier la fin de match au 13ème round gagné (pour T)
    expect(ctx.orch.endMatch).toHaveBeenCalledTimes(1);
    expect(ctx.orch.endMatch).toHaveBeenCalledWith(MATCH_ID, 'T', expect.anything());
  });

  it('prevents premature victory at round 19 when second-half CT makes a comeback towards overtime (12-12)', async () => {
    const ctx = makeBurstContext();
    const handler = (rule as any).events.get(EventTypes.TEAM_ROUND_WIN);

    // 1ère mi-temps : CT mène 7 - 5 (rounds 1 à 12, 7 victoires CT, 5 victoires T)
    const firstHalf: ('CT' | 'T')[] = [
      'CT', 'CT', 'T', 'CT', 'CT', 'CT', 'T', 'CT', 'T', 'T', 'T', 'CT'
    ];
    for (let r = 1; r <= 12; r++) {
      await handler({
        matchId: MATCH_ID,
        round: r,
        type: EventTypes.TEAM_ROUND_WIN,
        payload: { winner: firstHalf[r - 1], reason: 'elim' },
      }, ctx as any);
    }

    expect(ctx.orch.swapSides).toHaveBeenCalledTimes(1);
    // Après mi-temps : CT=5 (Team B), T=7 (Team A)
    expect(ctx.getScore()).toEqual({ ct: 5, t: 7, round: 12 });

    // 2ème mi-temps : Team B (maintenant CT) fait une remontée en gagnant 6 rounds (rounds 13 à 18)
    for (let r = 13; r <= 18; r++) {
      await handler({
        matchId: MATCH_ID,
        round: r,
        type: EventTypes.TEAM_ROUND_WIN,
        payload: { winner: 'CT', reason: 'elim' },
      }, ctx as any);
    }

    // Au round 18, le score CT est 5 + 6 = 11 (et NON 13 ! Le match ne doit pas être terminé !)
    expect(ctx.getScore().ct).toBe(11);
    expect(ctx.orch.endMatch).not.toHaveBeenCalled();

    // Au round 19 : Team A (sur T) marque un point -> CT 11 - 8 T
    await handler({
      matchId: MATCH_ID,
      round: 19,
      type: EventTypes.TEAM_ROUND_WIN,
      payload: { winner: 'T', reason: 'elim' },
    }, ctx as any);

    expect(ctx.getScore()).toEqual({ ct: 11, t: 8, round: 19 });
    // Ce test vérifie précisément l'absence de régression du bug "victoire 13 - 6 au round 19" !
    expect(ctx.orch.endMatch).not.toHaveBeenCalled();

    // Reste des rounds jusqu'à égalité 12 - 12 (CT marque 1, T marque 4)
    const endReg: ('CT' | 'T')[] = ['CT', 'T', 'T', 'T', 'T'];
    for (let i = 0; i < endReg.length; i++) {
      await handler({
        matchId: MATCH_ID,
        round: 20 + i,
        type: EventTypes.TEAM_ROUND_WIN,
        payload: { winner: endReg[i], reason: 'elim' },
      }, ctx as any);
    }

    expect(ctx.getScore()).toEqual({ ct: 12, t: 12, round: 24 });
    expect(ctx.orch.setPhase).toHaveBeenCalledWith(MATCH_ID, MatchPhase.OVERTIME);
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
