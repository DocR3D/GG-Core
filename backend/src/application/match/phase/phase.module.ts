import { Module, forwardRef } from '@nestjs/common';
import { MatchPhaseService } from './match-phase.service';
import { MatchStateModule } from '@app/match-state.module';
import { RulesModule } from '@app/match/rules/rules.module';
import { CommandsModule } from '@app/commands.module';
import { MessageServiceModule } from '../messages/messages.module';  // 👈 ajout

/**
 * PhaseModule
 * - Fournit MatchPhaseService (gestion des phases)
 * - Dépend du state/rules/commands/messages
 * - Référence circulaire avec CommandsModule => forwardRef
 */
@Module({
  imports: [
    MatchStateModule,
    RulesModule,
    forwardRef(() => CommandsModule),
    MessageServiceModule,  // 👈 ajouté pour MessageService
  ],
  providers: [MatchPhaseService],
  exports: [MatchPhaseService],
})
export class PhaseModule {}
