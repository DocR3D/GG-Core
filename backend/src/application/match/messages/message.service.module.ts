// message-service.module.ts
import { forwardRef, Global, Module } from '@nestjs/common';
import { MessageService } from './message.service';
import { CommandsModule } from '@app/commands.module';

@Global() // 👈 très important 
@Module({
  imports:[forwardRef(() => CommandsModule)],
  providers: [MessageService],
  exports: [MessageService], // 👈 pour que d’autres modules puissent l’injecter
})
export class MessageServiceModule {}
