import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '@adapters/redis/redis.module';
import { MatchStateModule } from '@app/match-state.module';
import { CommandsModule } from '@app/commands.module';
import { MatchOrchestratorModule } from '@app/match/match-orchestrator.module';

import { RuleRegistry } from './rule.registry';
import { RuleContextFactory } from '@app/rules/rule-context.factory';
import { ReadyCommand } from '@app/match/commands/ready.command';
import { PauseCommand } from '@app/match/commands/pause.command';
import { KnifeChoiceCommand } from '@app/match/commands/knife-choice.command';

@Module({
  imports: [
    RedisModule,
    MatchStateModule,
    forwardRef(() => CommandsModule),
    forwardRef(() => MatchOrchestratorModule),
  ],
  providers: [
    RuleRegistry,
    RuleContextFactory,
    ReadyCommand,
    PauseCommand,
    KnifeChoiceCommand,
  ],
  exports: [RuleRegistry, RuleContextFactory],
})
export class RulesModule {}
