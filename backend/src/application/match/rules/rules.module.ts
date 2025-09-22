import { Module, forwardRef } from '@nestjs/common';

import { MatchStateModule } from '@app/match-state.module';
import { MatchOrchestratorModule } from '@app/match/match-orchestrator.module';
import { CommandsModule } from '@app/commands.module';
import { RedisModule } from '@adapters/redis/redis.module';

import { RuleRegistry } from './rule.registry';
import { WarmupRule } from './warmup.rule';
import { KnifeRule } from './knife.rule';
import { KnifeChoiceRule } from './knife-choice.rule';
import { LiveRule } from './live.rule';

// On garde l'import que tu souhaites :
import { RuleContextFactory } from '@app/rules/rule-context.factory';

@Module({
  imports: [
    RedisModule,                        // REDIS_PUB
    MatchStateModule,                   // MatchStateService
    forwardRef(() => MatchOrchestratorModule), // MatchOrchestrator
    forwardRef(() => CommandsModule),          // MatchCommandsService
  ],
  providers: [
    WarmupRule,
    KnifeRule,
    KnifeChoiceRule,
    LiveRule,
    RuleRegistry,
    RuleContextFactory,
  ],
  exports: [
    RuleRegistry,
    RuleContextFactory,
    WarmupRule, KnifeRule, KnifeChoiceRule, LiveRule,
  ],
})
export class RulesModule {}
