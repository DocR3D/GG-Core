// src/application/match/rules/postgame.rule.ts
import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import { SaySpec } from '../messages/messages.types';

export class PostgameRule extends BaseRule implements PhaseRule {
  name = 'postgame' as const;

  async onEnter(ctx: RuleContext) {
    const snapshot = await ctx.state.getSnapshot(ctx.matchId);
    await ctx.say(`[postgame] Match terminé ! Score final: ${snapshot.score.ct} - ${snapshot.score.t}.`);
    await ctx.orch.push(ctx.matchId, 'match:state', snapshot);
  }

  async onExit(_: RuleContext) {}

  async say(_rct: RuleContext): Promise<SaySpec> {
    return [];
  }
}
