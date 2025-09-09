import { Module } from '@nestjs/common';
import { Cs2LogsController } from './cs2-logs.controller';
import { Cs2LogsService } from './cs2-logs.service'; 

@Module({
  controllers: [Cs2LogsController],
  providers: [Cs2LogsService],
  exports: [Cs2LogsService],
})
export class Cs2LogsModule {}
