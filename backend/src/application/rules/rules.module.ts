// src/application/rules/rules.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { RuleRegistry } from './rule.registry';
import { DefaultRule } from './default.rule';
import { KnifeRule } from './knife.rule';

import { MatchStateModule } from '@app/match-state.module';
import { CommandsModule } from '@app/commands.module';
import { PhaseModule } from '@app/phase/phase.module';
import { LiveRule } from './live_rule';
import { KnifeChoiceRule } from './knife_choice.rule';

@Module({
  imports: [
    MatchStateModule,              // MatchStateService pour les règles
    CommandsModule,                // ActionsPort + MatchCommandsService
    forwardRef(() => PhaseModule), // KnifeRule -> MatchPhaseService (évite cycle)
  ],
  providers: [RuleRegistry, DefaultRule, KnifeRule,KnifeChoiceRule,LiveRule],
  exports: [RuleRegistry, KnifeRule,LiveRule,KnifeChoiceRule],
})
export class RulesModule {}
