import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '../../../adapters/redis/redis.module';
import { MatchStateModule } from '../../match-state.module';
import { CommandsModule } from '../../commands.module';
import { MatchOrchestratorModule } from '../match-orchestrator.module';

import { RuleRegistry } from './rule.registry';
import { RuleContextFactory } from '../../rules/rule-context.factory';
import { ReadyCommand } from '@app/match/commands/ready.command';
import { PauseCommand } from '../commands/pause.command';
import { KnifeChoiceCommand } from '../commands/knife-choice.command';

@Module({
  imports: [
    RedisModule,
    MatchStateModule,
    // On garde les forwardRef car le RuleRegistry et le RuleContextFactory
    // peuvent avoir besoin de services provenant de ces modules.
    forwardRef(() => CommandsModule),
    forwardRef(() => MatchOrchestratorModule),
  ],
  providers: [
    // On ne fournit QUE les services. Les règles ne sont plus des providers.
    RuleRegistry,
    RuleContextFactory,
    ReadyCommand, // ReadyCommand est une dépendance, on le garde ici.
    PauseCommand,
    KnifeChoiceCommand, // 👈 2. AJOUTEZ la commande à la liste des providers
  ],
  exports: [RuleRegistry, RuleContextFactory],
})
export class RulesModule {}