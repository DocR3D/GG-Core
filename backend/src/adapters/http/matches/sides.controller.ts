// src/adapters/http/matches/sides.controller.ts
import { Controller, Param, Patch, Get, Body } from '@nestjs/common';
import { MatchStateService, type GameSide, CoreSide, type Logical } from '@app/match/state/match-state.service';

type SetSidesDto = Partial<CoreSide>; // {home?: 'CT'|'T', away?: 'CT'|'T'}

@Controller('matches/:id/sides')
export class SidesController {
  constructor(private readonly matchState: MatchStateService) {}

  // GET /matches/:id/sides  -> {home:'CT'|'T', away:'CT'|'T'}
  @Get()
  async get(@Param('id') matchId: string) {
    return await this.matchState.getSides(matchId); // null si non init
  }

  // PATCH /matches/:id/sides  body: {home?, away?}
  @Patch()
  async set(@Param('id') matchId: string, @Body() dto: SetSidesDto) {
    const current = (await this.matchState.getSides(matchId)) ?? { home: 'CT', away: 'T' as GameSide };
    await this.matchState.setSides(matchId, { ...current, ...dto });
    return { ok: true };
  }

  // PATCH /matches/:id/sides/swap
  @Patch('swap')
  async swap(@Param('id') matchId: string) {
    const ok = await this.matchState.swapSides(matchId); // inverse home/away
    return { ok };
  }

  // GET /matches/:id/sides/logical-to-side/:logical  -> 'CT'|'T'|null
  @Get('logical-to-side/:logical')
  async logicalToSide(@Param('id') matchId: string, @Param('logical') logical: Logical) {
    return await this.matchState.logicalToSide(matchId, logical);
  }

  // GET /matches/:id/sides/side-to-logical/:side  -> 'home'|'away'|null
  @Get('side-to-logical/:side')
  async sideToLogical(@Param('id') matchId: string, @Param('side') side: GameSide) {
    return await this.matchState.sideToLogical(matchId, side);
  }
}
