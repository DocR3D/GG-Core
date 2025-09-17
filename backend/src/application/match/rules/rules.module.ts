import { Module, forwardRef } from '@nestjs/common';
import { RuleRegistry } from './rule.registry';
import { WarmupRule } from './warmup.rule';
import { KnifeRule } from './knife.rule';
import { LiveRule } from './live_rule';
import { KnifeChoiceRule } from './knife_choice.rule';

import { MatchStateModule } from '@app/match-state.module';
import { CommandsModule } from '@app/commands.module';
import { PhaseModule } from '@app/match/phase/phase.module';
import { MatchOrchestratorModule } from '@app/match/match-orchestrator.module'; // 👈 new

import { RuleContextFactory } from '@domain/rules/rule-context-factory';

@Module({
  imports: [
    forwardRef(() => MatchStateModule),
    forwardRef(() => CommandsModule),
    forwardRef(() => PhaseModule),
    forwardRef(() => MatchOrchestratorModule), // 👈 new
  ],
  providers: [RuleRegistry, WarmupRule, KnifeRule, KnifeChoiceRule, LiveRule, RuleContextFactory],
  exports:   [RuleRegistry, KnifeRule, KnifeChoiceRule, LiveRule, RuleContextFactory],
})
export class RulesModule {}
