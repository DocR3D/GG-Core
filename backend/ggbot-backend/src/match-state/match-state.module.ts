
import { Module, Global, forwardRef } from '@nestjs/common';
import { MatchStateService } from './match-state/match-state.service';
import { CommandsModule } from '../commands/commands.module'; // seulement si vous avez un cycle
import { MatchStateHandler } from './match-state/match-state-handler.service';

@Module({
    imports: [
    // si MatchState a besoin de Commands quelque part -> cycle -> forwardRef
    // sinon, retirez cette ligne
    forwardRef(() => CommandsModule),
  ],
  providers: [MatchStateService, MatchStateHandler],
  exports: [MatchStateService, MatchStateHandler], // <- indispensable pour le rendre visible aux autres modules
})
export class MatchStateModule {}
