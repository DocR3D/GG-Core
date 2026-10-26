/**
 * Tests unitaires — KnifeChoiceCommand
 * TC-02 (suite) : !stay → passage live_main avec countdown 5s
 *                 !switch → swap des sides + passage live_main
 * TC-08 : seul le vainqueur du knife peut choisir (canHandle)
 */
import { KnifeChoiceCommand } from './knife-choice.command';
import { MatchPhase } from '@domain/phase.types';

const MATCH_ID = 'm-test';
const SERVER_ID = 'srv-a';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeCmd() {
  return new KnifeChoiceCommand();
}

function makeCommandEvent(command: 'stay' | 'switch' | 'swap', senderTeam: 'CT' | 'T' = 'CT') {
  return {
    type: 'command',
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    round: 1,
    tick: 0,
    payload: {
      command,
      parameters: [],
      sender: { name: 'Garitos', steamId: 'STEAM_1', team: senderTeam },
    },
  } as any;
}

function makeCtx(knifeWinnerSide: 'CT' | 'T' = 'CT', swapResult = true) {
  return {
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    say: jest.fn().mockResolvedValue(undefined),
    pubEvent: jest.fn().mockResolvedValue(undefined),
    orch: {
      getKnifeResult: jest.fn().mockResolvedValue({ side: knifeWinnerSide, team: { name: 'TeamA' } }),
      startPhaseCountdown: jest.fn().mockResolvedValue(undefined),
      swapSides: jest.fn().mockResolvedValue(swapResult),
      push: jest.fn().mockResolvedValue(undefined),
    },
    state: {
      getServerIdFromMatchId: jest.fn().mockResolvedValue(SERVER_ID),
      getSnapshot: jest.fn().mockResolvedValue({}),
    },
  } as any;
}

// ---------------------------------------------------------------------------
// TC-08 — canHandle : seul le vainqueur peut choisir
// ---------------------------------------------------------------------------
describe('TC-08 — KnifeChoiceCommand.canHandle', () => {
  it('retourne true si le sender est bien le vainqueur du knife (CT)', async () => {
    const cmd = makeCmd();
    const ctx = makeCtx('CT');
    const result = await cmd.canHandle(makeCommandEvent('stay', 'CT'), ctx);
    expect(result).toBe(true);
  });

  it('retourne false si le sender est du mauvais côté (T alors que CT a gagné)', async () => {
    const cmd = makeCmd();
    const ctx = makeCtx('CT');
    const result = await cmd.canHandle(makeCommandEvent('stay', 'T'), ctx);
    expect(result).toBe(false);
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('vainqueur'));
  });

  it('retourne false si aucun résultat knife en base', async () => {
    const cmd = makeCmd();
    const ctx = makeCtx('CT');
    ctx.orch.getKnifeResult = jest.fn().mockResolvedValue(null);
    const result = await cmd.canHandle(makeCommandEvent('stay', 'CT'), ctx);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC-02 (suite) — handle !stay
// ---------------------------------------------------------------------------
describe('TC-02 — KnifeChoiceCommand.handle : !stay', () => {
  it('publie knife_choice:stay et déclenche countdown LIVE_MAIN 5s', async () => {
    const cmd = makeCmd();
    const ctx = makeCtx();

    const result = await cmd.handle(makeCommandEvent('stay'), ctx);

    expect(result).toBe(true);
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('STAY'));
    expect(ctx.orch.startPhaseCountdown).toHaveBeenCalledWith(
      MATCH_ID,
      MatchPhase.LIVE_MAIN,
      5,
      SERVER_ID,
    );
    expect(ctx.pubEvent).toHaveBeenCalledWith('knife_choice', expect.objectContaining({ choice: 'stay' }));
    expect(ctx.orch.swapSides).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-02 (suite) — handle !switch
// ---------------------------------------------------------------------------
describe('TC-02 — KnifeChoiceCommand.handle : !switch', () => {
  it('swap les sides, publie sides:swapped et déclenche countdown LIVE_MAIN 5s', async () => {
    const cmd = makeCmd();
    const ctx = makeCtx();

    const result = await cmd.handle(makeCommandEvent('switch'), ctx);

    expect(result).toBe(true);
    expect(ctx.orch.swapSides).toHaveBeenCalledWith(MATCH_ID);
    expect(ctx.orch.push).toHaveBeenCalledWith(MATCH_ID, 'sides:swapped', {});
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('SWITCH'));
    expect(ctx.orch.startPhaseCountdown).toHaveBeenCalledWith(
      MATCH_ID,
      MatchPhase.LIVE_MAIN,
      5,
      SERVER_ID,
    );
    expect(ctx.pubEvent).toHaveBeenCalledWith('knife_choice', expect.objectContaining({ choice: 'switch' }));
  });

  it("ne publie pas sides:swapped si swapSides retourne false", async () => {
    const cmd = makeCmd();
    const ctx = makeCtx('CT', false);

    await cmd.handle(makeCommandEvent('switch'), ctx);

    const swappedCalls = ctx.orch.push.mock.calls.filter((c: string[]) => c[1] === 'sides:swapped');
    expect(swappedCalls.length).toBe(0);
  });
});
