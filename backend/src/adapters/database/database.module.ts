import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TournamentPersistenceService } from './tournament-persistence.service';

@Global()
@Module({
  providers: [PrismaService, TournamentPersistenceService],
  exports: [PrismaService, TournamentPersistenceService],
})
export class DatabaseModule {}
