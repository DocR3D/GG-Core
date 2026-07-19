// src/adapters/http/maps/maps.module.ts
import { Module } from '@nestjs/common';
import { MapsService } from './maps.service';
import { MapsController } from './maps.controller';

@Module({
  providers: [MapsService],
  controllers: [MapsController],
})
export class MapsModule {}
