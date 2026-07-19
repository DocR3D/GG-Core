// src/adapters/http/maps/maps.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MapsService } from './maps.service';

@ApiTags('maps')
@Controller('maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Get()
  @ApiOperation({ summary: 'Liste des maps disponibles dans le mappool' })
  async findAll() {
    return this.maps.findAll();
  }
}
