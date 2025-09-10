// src/adapters/http/matches/init.controller.ts
import { Controller, Param, Post, Body,Get, Patch } from '@nestjs/common';
import { MatchStateService} from '@app/state/match-state.service';


@Controller('matches/:id/economy')
export class EconomyController {
  constructor(private readonly matchState: MatchStateService) {}

  @Post('init') async init(@Param('id') matchId: string) {
    await this.matchState.initEconomy(matchId); return {ok:true};
  }

  @Get() async get(@Param('id') matchId: string) {
    return {
      team: await this.matchState.getTeamEconomyMeta(matchId),
      players: await this.matchState.getPlayersEconomy(matchId),
    };
  }

  @Patch('round-end') async end(@Param('id') matchId: string,@Body() dto:{winner:'CT'|'T'}) {
    return { ok: await this.matchState.updateEconomyOnRoundEnd(matchId,dto.winner)};
  }

  @Patch('player/money') async money(@Param('id') matchId: string,@Body() dto:{steamId:string;money:number}) {
    await this.matchState.setPlayerMoney(matchId,dto.steamId,dto.money); return {ok:true};
  }

  @Patch('player/equip') async equip(@Param('id') matchId: string,@Body() dto:{steamId:string;equip:number}) {
    await this.matchState.setPlayerEquipValue(matchId,dto.steamId,dto.equip); return {ok:true};
  }
}