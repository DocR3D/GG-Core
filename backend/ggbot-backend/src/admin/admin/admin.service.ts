import { Controller, Post, Body } from '@nestjs/common';
import { MatchStateService } from '../../match-state/match-state/match-state.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly ms: MatchStateService) {}

  @Post('bind')
  async bind(@Body() b: { serverId:string; matchId:string }) {
    await this.ms.setServerMatch(b.serverId, b.matchId);
    return { ok: true };
  }

  @Post('sides')
  async sides(@Body() b: { matchId:string; home:'CT'|'T'; away:'CT'|'T' }) {
    await this.ms.setSides(b.matchId, { home: b.home, away: b.away });
    return { ok: true };
  }

  @Post('timeouts/init')
  async init(@Body() b: { matchId:string; homeTac?:number; awayTac?:number }) {
    await this.ms.initTimeouts(b.matchId, b.homeTac ?? 4, b.awayTac ?? 4);
    return { ok: true };
  }
}
