import { Module, forwardRef } from '@nestjs/common';
import { CommandsProcessorService } from './commands-processor/commands-processor.service';
import { MatchStateModule } from '../match-state/match-state.module';

@Module({
  imports: [
    // Importez le module qui **exporte** MatchStateService
    forwardRef(() => MatchStateModule), // forwardRef seulement si cycle ; sinon: MatchStateModule
  ],
  providers: [CommandsProcessorService],
  exports: [CommandsProcessorService],
})
export class CommandsModule {}
