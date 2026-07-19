// src/adapters/http/matches/sides.controller.ts
import { Controller, Param, Patch } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiOkResponse } from '@nestjs/swagger';
import { MatchStateService } from '@app/match/state/match-state.service';

@ApiTags('matches')
@Controller('matches/:id/sides')
export class SidesController {
  constructor(private readonly matchState: MatchStateService) {}

  @Patch('swap')
  @ApiOperation({
    summary: 'Swapper les sides CT/T',
    description: 'Échange les sides CT/T entre home et away. À appeler à la mi-temps ou après le choix de side (knife choice). Met à jour `homeIsct` dans le snapshot.',
  })
  @ApiParam({ name: 'id', description: 'ID Redis du match', example: 'm-cs2-001' })
  @ApiOkResponse({ schema: { example: { ok: true } } })
  async swap(@Param('id') matchId: string) {
    const ok = await this.matchState.swapSides(matchId);
    return { ok };
  }
}
