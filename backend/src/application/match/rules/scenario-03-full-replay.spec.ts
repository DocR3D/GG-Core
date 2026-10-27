import * as fs from 'fs';
import * as path from 'path';
import { LiveRule } from './live.rule';
import { EventTypes } from '@domain/events/event.types';
import { MatchPhase } from '@domain/phase.types';

describe('Scenario 03 Full Replay — 53-Round 5-Overtime Inferno Match through LiveRule', () => {
  it('replays all 53 rounds of scenario-03 without premature termination and concludes at 25-28 in OT5', async () => {
    const fixturePath = path.resolve(
      __dirname,
      '../../../../../test/fixtures/scenarios/scenario-03-overtime5-match156-inferno.json',
    );
    expect(fs.existsSync(fixturePath)).toBe(true);

    const scenarioData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const rule = new LiveRule();
    const handler = (rule as any).events.get(EventTypes.TEAM_ROUND_WIN);

    let currentScore = { ct: 0, t: 0, round: 0 };
    let currentSides: { home: 'CT' | 'T'; away: 'CT' | 'T' } = { home: 'CT', away: 'T' };
    let halftimePlayed = false;
    let otCount = 0;
    let matchEnded = false;
    let matchWinner: string | null = null;
    let currentPhase = MatchPhase.LIVE_MAIN;

    const ctx = {
      matchId: 'm-sandbox-1',
      serverId: 'srv-a',
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
          currentSides = {
            home: currentSides.home === 'CT' ? 'T' : 'CT',
            away: currentSides.away === 'CT' ? 'T' : 'CT',
          };
          return true;
        }),
        endMatch: jest.fn().mockImplementation(async (_mid: string, winner: 'CT' | 'T' | null) => {
          matchEnded = true;
          matchWinner = winner;
          currentPhase = MatchPhase.POSTGAME;
        }),
      },
      state: {
        getServerIdFromMatchId: jest.fn().mockResolvedValue('srv-a'),
        getSnapshot: jest.fn().mockImplementation(async () => ({
          score: { ...currentScore },
          sides: { ...currentSides },
          teams: { home_name: 'Team Alpha', away_name: 'Team Bravo' },
        })),
        getLastScoredRound: jest.fn().mockResolvedValue(0),
        setLastScoredRound: jest.fn().mockResolvedValue(undefined),
        isHalftimePlayed: jest.fn().mockImplementation(async () => halftimePlayed),
        setHalftimePlayed: jest.fn().mockImplementation(async (_mid: string, v: boolean) => {
          halftimePlayed = v;
        }),
        getOvertimeCount: jest.fn().mockImplementation(async () => otCount),
        setOvertimeCount: jest.fn().mockImplementation(async (_mid: string, v: number) => {
          otCount = v;
        }),
        reconcileScore: jest.fn().mockImplementation(async (_mid: string, ct: number, t: number) => {
          currentScore.ct = ct;
          currentScore.t = t;
          currentScore.round = ct + t;
        }),
        getSettings: jest.fn().mockResolvedValue({
          mrFormat: 12,
          overtimeEnabled: true,
          overtimeMrFormat: 3,
          warmupAtHalftime: false,
          warmupAtOvertime: false,
        }),
      },
    };

    // Rejouer uniquement les événements de victoire de manche (team_round_win)
    const winEvents = scenarioData.events.filter((e: any) => e.type === 'team_round_win');
    expect(winEvents.length).toBeGreaterThanOrEqual(53);

    for (let i = 0; i < winEvents.length; i++) {
      const ev = winEvents[i];
      await handler(ev, ctx as any);

      // Vérification clé : au round 19 (où l'ancien bug terminait à 13-6), le match DOIT être actif !
      if (currentScore.round === 19) {
        expect(matchEnded).toBe(false);
      }
    }

    // Le match doit avoir atteint les prolongations (5 Overtimes)
    expect(otCount).toBe(5);
    // Le match doit se terminer en victoire
    expect(matchEnded).toBe(true);
    // Le score final doit être 25 - 28
    expect(currentScore.ct).toBe(25);
    expect(currentScore.t).toBe(28);
    expect(currentScore.round).toBe(53);
    // L'équipe gagnante est Terrorist (Team Bravo = away), tandis que Team Alpha (home) finit en CT
    expect(matchWinner).toBe('T');
    expect(currentSides).toEqual({ home: 'CT', away: 'T' });
  });
});
