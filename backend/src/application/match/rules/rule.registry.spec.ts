// src/application/match/rules/rule.registry.spec.ts
import { RuleRegistry } from './rule.registry';
import { MatchPhase } from '@domain/phase.types';
import { PostgameRule } from './postgame.rule';
import { WarmupRule } from './warmup.rule';
import { KnifeRule } from './knife.rule';
import { KnifeChoiceRule } from './knife-choice.rule';
import { LiveRule } from './live.rule';

describe('RuleRegistry — Phase Rule Mapping & Lifecycle Safety', () => {
  let registry: RuleRegistry;
  let mockReadyCmd: any;
  let mockKnifeCmd: any;
  let mockPauseCmd: any;

  beforeEach(() => {
    mockReadyCmd = { handle: jest.fn() };
    mockKnifeCmd = { handle: jest.fn() };
    mockPauseCmd = { handle: jest.fn() };

    registry = new RuleRegistry(mockReadyCmd, mockKnifeCmd, mockPauseCmd);
  });

  it('doit mapper chaque phase de jeu vers sa règle dédiée', () => {
    expect(registry.getRule(MatchPhase.WARMUP_MAIN)).toBeInstanceOf(WarmupRule);
    expect(registry.getRule(MatchPhase.KNIFE_WARMUP)).toBeInstanceOf(WarmupRule);
    expect(registry.getRule(MatchPhase.KNIFE_LIVE)).toBeInstanceOf(KnifeRule);
    expect(registry.getRule(MatchPhase.KNIFE_CHOICE)).toBeInstanceOf(KnifeChoiceRule);
    expect(registry.getRule(MatchPhase.LIVE_MAIN)).toBeInstanceOf(LiveRule);
    expect(registry.getRule(MatchPhase.HALFTIME)).toBeInstanceOf(WarmupRule);
    expect(registry.getRule(MatchPhase.OVERTIME)).toBeInstanceOf(LiveRule);
  });

  it('POSTGAME doit avoir sa propre règle PostgameRule et NE PAS retomber sur WarmupRule', () => {
    // Évite qu'en fin de match, le bot dise "Tapez !ready" et redémarre le warmup
    const postgameRule = registry.getRule(MatchPhase.POSTGAME);
    expect(postgameRule).toBeInstanceOf(PostgameRule);
    expect(postgameRule).not.toBeInstanceOf(WarmupRule);
  });

  it('PostgameRule doit annoncer la fin du match sans demander de !ready', async () => {
    const postgameRule = registry.getRule(MatchPhase.POSTGAME) as PostgameRule;
    const mockCtx = {
      matchId: 'm-1',
      say: jest.fn().mockResolvedValue(undefined),
      orch: { push: jest.fn().mockResolvedValue(undefined) },
      state: {
        getSnapshot: jest.fn().mockResolvedValue({
          score: { ct: 13, t: 11 },
        }),
      },
    };

    await postgameRule.onEnter(mockCtx as any);

    expect(mockCtx.say).toHaveBeenCalledWith(expect.stringContaining('Match terminé'));
    expect(mockCtx.say).not.toHaveBeenCalledWith(expect.stringContaining('!ready'));

    const saySpec = await postgameRule.say(mockCtx as any);
    expect(saySpec).toEqual([]);
  });
});
