/**
 * Tests unitaires - PauseCommand
 * TC-03 : Pause tactique en phase live_main
 *   - round actif (phase='live' | 'bomb_planted' | 'end') → pause armée
 *   - freeze time (phase='freeze') → pause immédiate
 *   - hors round (phase=null) → refus, « terminé » seulement en postgame
 */
import { PauseCommand } from './pause.command';

const MATCH_ID = 'm-test';
const SERVER_ID = 'srv-a';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makePauseEvent(command = 'pause', team: 'CT' | 'T' = 'CT') {
  return {
    type: 'command',
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    round: 5,
    tick: 0,
    payload: {
      command,
      parameters: [],
      sender: { name: 'Garitos', steamId: 'STEAM_1', team },
    },
  } as any;
}

function makeCtx(matchPhase = 'live_main') {
  return {
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    say: jest.fn().mockResolvedValue(undefined),
    pubEvent: jest.fn().mockResolvedValue(undefined),
    orch: {
      sideToLogical: jest.fn().mockResolvedValue('home'),
    },
    state: {
      getSnapshot: jest.fn().mockResolvedValue({ phase: matchPhase }),
    },
  } as any;
}

function makePauseService(overrides?: {
  isPaused?: boolean;
  isAllowed?: boolean;
  why?: string;
  phase?: 'live' | 'bomb_planted' | 'freeze' | 'end' | null;
}) {
  return {
    isPaused: jest.fn().mockResolvedValue(overrides?.isPaused ?? false),
    isPauseAllowed: jest.fn().mockResolvedValue({ allowed: overrides?.isAllowed ?? true, why: overrides?.why }),
    getPhase: jest.fn().mockResolvedValue(overrides && 'phase' in overrides ? overrides.phase : 'live'),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    getPauseState: jest.fn().mockResolvedValue({ reason: 'none' }),
    voteUnpause: jest.fn().mockResolvedValue({ bothReady: false }),
  };
}

function makeRconService() {
  return {
    pause: jest.fn().mockResolvedValue(undefined),
    unpause: jest.fn().mockResolvedValue(undefined),
  };
}

function makeCmd(pauseService: ReturnType<typeof makePauseService>, rconService = makeRconService()) {
  return new PauseCommand(pauseService as any, rconService as any);
}

// Refus d'une pause : le message dit la vraie raison (avant, tout refus annonçait « plus de pauses tactiques »)
describe('PauseCommand : pause refusée', () => {
  it.each([
    ['already_paused', 'déjà en pause'],
    ['no_bank', "plus de pauses tactiques"],
    ['unknown_reason', 'Pause refusée'],
  ])("raison '%s' → message « %s », rien n'est armé ni lancé", async (why, expected) => {
    const pauseService = makePauseService({ isAllowed: false, why });
    const rconService = makeRconService();
    const ctx = makeCtx();

    const result = await makeCmd(pauseService, rconService).handle(makePauseEvent('pause'), ctx);

    expect(result).toBe(false);
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining(expected));
    expect(pauseService.pause).not.toHaveBeenCalled();
    expect(rconService.pause).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-03.A - Phase 'live' → pause armée (pas de RCON)
// ---------------------------------------------------------------------------
describe('TC-03 - PauseCommand : phase live_main', () => {
  it("arme la pause si roundPhase='live'", async () => {
    const pauseService = makePauseService({ phase: 'live' });
    const rconService = makeRconService();
    const cmd = makeCmd(pauseService, rconService);
    const ctx = makeCtx();

    const result = await cmd.handle(makePauseEvent('pause'), ctx);

    expect(result).toBe(true);
    expect(pauseService.pause).toHaveBeenCalledWith(
      MATCH_ID,
      SERVER_ID,
      expect.objectContaining({ armOnly: true }),
    );
    expect(rconService.pause).not.toHaveBeenCalled();
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('armée'));
  });

  // Bug vu en jeu réel : après la pose de bombe / en fin de round, la pause était refusée (« match terminé »).
  it.each(['bomb_planted', 'end'] as const)("arme la pause si roundPhase='%s'", async (phase) => {
    const pauseService = makePauseService({ phase });
    const rconService = makeRconService();
    const ctx = makeCtx();

    const result = await makeCmd(pauseService, rconService).handle(makePauseEvent('tech'), ctx);

    expect(result).toBe(true);
    expect(pauseService.pause).toHaveBeenCalledWith(MATCH_ID, SERVER_ID, expect.objectContaining({ armOnly: true }));
    expect(rconService.pause).not.toHaveBeenCalled();
  });

  // TC-03.B - Phase 'freeze' → pause immédiate + RCON
  it("active immédiatement la pause si roundPhase='freeze'", async () => {
    const pauseService = makePauseService({ phase: 'freeze' });
    const rconService = makeRconService();
    const cmd = makeCmd(pauseService, rconService);
    const ctx = makeCtx();

    const result = await cmd.handle(makePauseEvent('pause'), ctx);

    expect(result).toBe(true);
    expect(pauseService.pause).toHaveBeenCalledWith(
      MATCH_ID,
      SERVER_ID,
      expect.objectContaining({ armOnly: false }),
    );
    expect(rconService.pause).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: MATCH_ID, serverId: SERVER_ID }),
    );
  });

  // TC-03.C - Phase null en postgame → refus "match terminé"
  it('refuse la pause si phase=null (match terminé)', async () => {
    const pauseService = makePauseService({ phase: null });
    const rconService = makeRconService();
    const cmd = makeCmd(pauseService, rconService);
    const ctx = makeCtx('postgame');
    const result = await cmd.handle(makePauseEvent('pause'), ctx);
    expect(result).toBe(false);
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('terminé'));
    expect(rconService.pause).not.toHaveBeenCalled();
  });

  it('refuse la pause hors round sans parler de fin de match (warmup)', async () => {
    const ctx = makeCtx('warmup_main');
    const result = await makeCmd(makePauseService({ phase: null })).handle(makePauseEvent('pause'), ctx);
    expect(result).toBe(false);
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining("aucun round n'est en cours"));
  });

  // TC-03.D - canHandle : refuse si match déjà en pause
  it('canHandle retourne false si déjà en pause', async () => {
    const pauseService = makePauseService({ isPaused: true });
    const cmd = makeCmd(pauseService);
    const ctx = makeCtx();

    const can = await cmd.canHandle(makePauseEvent('pause'), ctx);
    expect(can).toBe(false);
    expect(ctx.say).toHaveBeenCalledWith('Le match est déjà en pause.');
  });

  // TC-03.E - canHandle : refuse si sender = SPECTATOR
  it('handle retourne false si sender=SPECTATOR', async () => {
    const pauseService = makePauseService({ phase: 'live' });
    const cmd = makeCmd(pauseService);
    const ctx = makeCtx();

    // On override le payload directement
    const spectatorEvent = {
      ...makePauseEvent('pause'),
      payload: { command: 'pause', parameters: [], sender: { name: 'obs', steamId: '', team: 'SPECTATOR' } },
    };
    const res = await cmd.handle(spectatorEvent, ctx);
    expect(res).toBe(false);
  });

  // TC-03.F - !tech → raison = 'technical', durée 60s
  it('!tech crée une pause technique de 60s', async () => {
    const pauseService = makePauseService({ phase: 'live' });
    const cmd = makeCmd(pauseService);
    const ctx = makeCtx();

    await cmd.handle(makePauseEvent('tech'), ctx);

    expect(pauseService.pause).toHaveBeenCalledWith(
      MATCH_ID,
      SERVER_ID,
      expect.objectContaining({ reason: 'technical', durationSec: 60 }),
    );
  });

  // TC-03.G - !pause → raison = 'tactical', durée 30s
  it('!pause crée une pause tactique de 30s', async () => {
    const pauseService = makePauseService({ phase: 'live' });
    const cmd = makeCmd(pauseService);
    const ctx = makeCtx();

    await cmd.handle(makePauseEvent('pause'), ctx);

    expect(pauseService.pause).toHaveBeenCalledWith(
      MATCH_ID,
      SERVER_ID,
      expect.objectContaining({ reason: 'tactical', durationSec: 30 }),
    );
  });

  it('interrompt le timer de reprise de restauration si une pause est demandée', async () => {
    const pauseService = makePauseService({ phase: 'live' });
    const mockRestoreService: any = {
      hasPendingUnpause: jest.fn().mockReturnValue(true),
      clearUnpauseTimer: jest.fn().mockReturnValue(true),
    };
    const cmd = new PauseCommand(pauseService as any, makeRconService() as any, mockRestoreService);
    const ctx = makeCtx();

    await cmd.handle(makePauseEvent('tech'), ctx);

    expect(mockRestoreService.clearUnpauseTimer).toHaveBeenCalledWith(MATCH_ID);
    expect(ctx.say).toHaveBeenCalledWith('[GG-Core] Reprise interrompue : pause prise en compte.');
  });
  it('!tech accepte une raison custom et la diffuse dans le chat', async () => {
    const pauseService = makePauseService({ phase: 'live' });
    const cmd = makeCmd(pauseService);
    const ctx = makeCtx();

    const ev = {
      ...makePauseEvent('tech'),
      payload: {
        command: 'tech',
        parameters: ['crash', 'pc', '12'],
        sender: { name: 'PlayerX', steamId: '1', team: 'CT' },
      },
    };

    await cmd.handle(ev, ctx);

    expect(pauseService.pause).toHaveBeenCalledWith(
      MATCH_ID,
      SERVER_ID,
      expect.objectContaining({ reason: 'technical', customReason: 'crash pc 12' }),
    );
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('crash pc 12'));
  });

  it('!unpause en pause technique applique la validation mutuelle', async () => {
    const pauseService = makePauseService({ isPaused: true });
    pauseService.getPauseState.mockResolvedValue({ reason: 'technical' });
    // Equipe 1 vote : pas encore bothReady
    pauseService.voteUnpause.mockResolvedValueOnce({ bothReady: false });

    const rconService = makeRconService();
    const cmd = makeCmd(pauseService, rconService);
    const ctx = makeCtx();

    await cmd.handle(makePauseEvent('unpause'), ctx);

    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('En attente de l\'équipe adverse'));
    expect(rconService.unpause).not.toHaveBeenCalled();

    // Equipe 2 vote : bothReady devient true
    pauseService.voteUnpause.mockResolvedValueOnce({ bothReady: true });
    await cmd.handle(makePauseEvent('unpause'), ctx);

    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('Accord des deux équipes reçu'));
    expect(rconService.unpause).toHaveBeenCalled();
  });

  it("annonce le NOM de l'équipe (pas HOME / AWAY), en français, sans durée de fin inventée", async () => {
    const pauseService = makePauseService({ phase: 'freeze' });
    const ctx = makeCtx();
    ctx.state.getSnapshot.mockResolvedValue({ phase: 'live_main', teams: { home_name: 'Démo Rouge', away_name: 'Démo Noir' } });

    await makeCmd(pauseService).handle(makePauseEvent('tech'), ctx);

    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('Pause technique de Démo Rouge.'));
    expect(ctx.say).not.toHaveBeenCalledWith(expect.stringMatching(/60s|HOME|AWAY|technical/));
  });

  it('!unpause sans pause en cours le dit, et ne relance rien', async () => {
    const pauseService = makePauseService({ isPaused: false });
    const rconService = makeRconService();
    const ctx = makeCtx();

    expect(await makeCmd(pauseService, rconService).handle(makePauseEvent('unpause'), ctx)).toBe(false);

    expect(ctx.say).toHaveBeenCalledWith("Le match n'est pas en pause.");
    expect(rconService.unpause).not.toHaveBeenCalled();
  });

  it('!ready pendant une pause technique vaut !unpause (les deux équipes doivent le taper)', async () => {
    const pauseService = makePauseService({ isPaused: true });
    pauseService.getPauseState.mockResolvedValue({ reason: 'technical' });
    pauseService.voteUnpause.mockResolvedValueOnce({ bothReady: false }).mockResolvedValueOnce({ bothReady: true });
    const rconService = makeRconService();
    const cmd = makeCmd(pauseService, rconService);
    const ctx = makeCtx();

    await cmd.handleReadyToResume(makePauseEvent('ready'), ctx);
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('!unpause ou !ready pour valider'));
    expect(rconService.unpause).not.toHaveBeenCalled();

    await cmd.handleReadyToResume(makePauseEvent('ready'), ctx);
    expect(rconService.unpause).toHaveBeenCalled();
  });

  it('!ready hors pause ne fait rien (l\'échauffement garde !ready)', async () => {
    const pauseService = makePauseService({ isPaused: false });
    const ctx = makeCtx();

    expect(await makeCmd(pauseService).handleReadyToResume(makePauseEvent('ready'), ctx)).toBe(false);
    expect(ctx.say).not.toHaveBeenCalled();
  });
});