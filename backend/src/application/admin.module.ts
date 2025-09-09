import { Module } from '@nestjs/common';
import { AdminController } from './use-cases/admin.uc';
import { MatchStateModule } from './match.state.module';

@Module({
  imports: [MatchStateModule], // <- rendez le service visible ici
  controllers: [AdminController],
})
export class AdminModule {}
