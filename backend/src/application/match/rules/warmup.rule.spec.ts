// src/application/match/rules/warmup.rule.spec.ts
import { WarmupRule } from './warmup.rule';
import { MatchPhase } from '@domain/phase.types';
import { CS2_CFG, CS2_RULES } from '@domain/rules/rules.constants';
import { CommandEvent } from '@domain/events/command.event';

describe('WarmupRule — Ready Checks & Target Phase Selection', () => {
  let rule: WarmupRule;
  let mockReadyCmd: any;
  let mockCtx: any;

  beforeEach(() => {
    mockReadyCmd = {
      handle: jest.fn().mockResolvedValue(true),
    };
    rule = new WarmupRule(mockReadyCmd);

    mockCtx = {
      matchId: 'm-test',
      serverId: 'srv-a',
      say: jest.fn().mockResolvedValue(undefined),
      orch: {
        rcon: jest.fn().mockResolvedValue(undefined),
        resetReady: jest.fn().mockResolvedValue(undefined),
        push: jest.fn().mockResolvedValue(undefined),
        isBothReady: jest.fn().mockResolvedValue(false),
        isCountdownActive: jest.fn().mockResolvedValue(false),
        getPhase: jest.fn().mockResolvedValue(MatchPhase.KNIFE_WARMUP),
        startPhaseCountdown: jest.fn().mockResolvedValue(undefined),
      },
      state: {
        getServerIdFromMatchId: jest.fn().mockResolvedValue('srv-a'),
        getSnapshot: jest.fn().mockResolvedValue({
          teams: { home_name: 'HomeTeam', away_name: 'AwayTeam' },
        }),
        getSettings: jest.fn().mockResolvedValue({
          knifeEnabled: true,
          warmupAfterKnife: true,
        }),
      },
    };
  });

  describe('onEnter', () => {
    it('doit exécuter warmup.cfg sur CS2 et réinitialiser les flags ready', async () => {
      await rule.onEnter(mockCtx);

      expect(mockCtx.orch.rcon).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'srv-a',
          command: expect.stringContaining(CS2_CFG.WARMUP),
        }),
      );
      expect(mockCtx.orch.resetReady).toHaveBeenCalledWith('m-test');
      expect(mockCtx.say).toHaveBeenCalledWith(expect.stringContaining('!ready'));
    });
  });

  describe('onReadyCommand', () => {
    const makeCmd = (team: 'CT' | 'T', command = '!ready'): CommandEvent => ({
      type: 'command',
      matchId: 'm-test',
      serverId: 'srv-a',
      timestamp: Date.now(),
      payload: {
        command,
        parameters: [],
        sender: { name: `Capt_${team}`, steamId: `STEAM_${team}`, team },
      },
    });

    it('ne déclenche PAS le décompte si une seule équipe est prête', async () => {
      mockCtx.orch.isBothReady.mockResolvedValue(false);

      await (rule as any).onReadyCommand(makeCmd('CT'), mockCtx);

      expect(mockReadyCmd.handle).toHaveBeenCalled();
      expect(mockCtx.orch.startPhaseCountdown).not.toHaveBeenCalled();
    });

    it('déclenche le décompte vers KNIFE_LIVE si phase courante = KNIFE_WARMUP', async () => {
      mockCtx.orch.isBothReady.mockResolvedValue(true);
      mockCtx.orch.getPhase.mockResolvedValue(MatchPhase.KNIFE_WARMUP);

      await (rule as any).onReadyCommand(makeCmd('T'), mockCtx);

      expect(mockCtx.orch.startPhaseCountdown).toHaveBeenCalledWith(
        'm-test',
        MatchPhase.KNIFE_LIVE,
        CS2_RULES.COUNTDOWN_DELAY_SEC,
        'srv-a',
      );
    });

    it('déclenche le décompte vers LIVE_MAIN si phase courante = WARMUP_MAIN (évite la boucle knife)', async () => {
      // Scénario critique : après le knife_choice, si warmupAfterKnife=true, on est en WARMUP_MAIN.
      // Taper !ready doit lancer le match LIVE_MAIN, et NE PAS renvoyer vers un nouveau knife round !
      mockCtx.orch.isBothReady.mockResolvedValue(true);
      mockCtx.orch.getPhase.mockResolvedValue(MatchPhase.WARMUP_MAIN);

      await (rule as any).onReadyCommand(makeCmd('T'), mockCtx);

      expect(mockCtx.orch.startPhaseCountdown).toHaveBeenCalledWith(
        'm-test',
        MatchPhase.LIVE_MAIN,
        CS2_RULES.COUNTDOWN_DELAY_SEC,
        'srv-a',
      );
    });

    it('déclenche le décompte vers LIVE_MAIN si phase courante = HALFTIME', async () => {
      mockCtx.orch.isBothReady.mockResolvedValue(true);
      mockCtx.orch.getPhase.mockResolvedValue(MatchPhase.HALFTIME);

      await (rule as any).onReadyCommand(makeCmd('T'), mockCtx);

      expect(mockCtx.orch.startPhaseCountdown).toHaveBeenCalledWith(
        'm-test',
        MatchPhase.LIVE_MAIN,
        CS2_RULES.COUNTDOWN_DELAY_SEC,
        'srv-a',
      );
    });

    it('ne redéclenche PAS le décompte ni l\'annonce si un décompte est déjà en cours', async () => {
      mockCtx.orch.isBothReady.mockResolvedValue(true);
      mockCtx.orch.isCountdownActive.mockResolvedValue(true);

      await (rule as any).onReadyCommand(makeCmd('T'), mockCtx);

      expect(mockCtx.say).not.toHaveBeenCalledWith('Les deux équipes sont prêtes ! Lancement du décompte.');
      expect(mockCtx.orch.startPhaseCountdown).not.toHaveBeenCalled();
    });
  });
});
