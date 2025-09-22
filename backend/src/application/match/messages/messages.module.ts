// src/application/match/messages/messages.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MessageService } from './message.service';
import { CommandsModule } from '@app/commands.module';

@Module({
  imports: [
    // Boucle: CommandsModule -> PhaseModule -> MessageServiceModule -> CommandsModule
    forwardRef(() => CommandsModule),
  ],
  providers: [MessageService],
  exports: [MessageService],
})
export class MessageServiceModule {}
