import { Module, forwardRef } from '@nestjs/common';
import { CommandsModule } from '@app/commands.module';   // ✅ bon chemin
import { PeriodicMessenger } from './periodic-messenger.service';
import { PeriodicScheduler } from './periodic-scheduler.service';

@Module({
  imports: [forwardRef(() => CommandsModule)],  // ✅ évite la boucle
  providers: [PeriodicMessenger, PeriodicScheduler],
  exports: [PeriodicMessenger, PeriodicScheduler],
})
export class PeriodicModule {}