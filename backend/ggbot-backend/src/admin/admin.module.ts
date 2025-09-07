import { Module } from '@nestjs/common';
import { AdminController } from './admin/admin.service';
import { MatchStateModule } from '../match-state/match-state.module';

@Module({
  imports: [MatchStateModule], // <- rendez le service visible ici
  controllers: [AdminController],
})
export class AdminModule {}
