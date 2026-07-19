// src/adapters/http/matches/economy.controller.ts
import { Controller, Param, Post, Body, Get, Patch } from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiParam, ApiBody, ApiProperty,
  ApiOkResponse, ApiCreatedResponse,
} from '@nestjs/swagger';
import { MatchStateService, type Logical } from '@app/match/state/match-state.service';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class RoundEndDto {
  @ApiProperty({
    enum: ['home', 'away'],
    example: 'home',
    description: 'Équipe logique gagnante du round (`home` ou `away`, indépendant du side CT/T actif)',
  })
  winner: Logical;
}

class PlayerMoneyDto {
  @ApiProperty({ example: '76561198000000001', description: 'Steam ID 64 du joueur' })
  steamId: string;
  @ApiProperty({ example: 4750, description: 'Montant en dollars CS2 (0–16000)' })
  money: number;
}

class PlayerEquipDto {
  @ApiProperty({ example: '76561198000000001', description: 'Steam ID 64 du joueur' })
  steamId: string;
  @ApiProperty({ example: 3200, description: 'Valeur totale de l\'équipement en dollars CS2' })
  equip: number;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags('matches')
@Controller('matches/:id/economy')
export class EconomyController {
  constructor(private readonly matchState: MatchStateService) {}

  @Post('init')
  @ApiOperation({
    summary: 'Initialiser l\'économie du match',
    description: 'Réinitialise les banques d\'argent et les loss streaks de toutes les équipes. À appeler au démarrage ou après un restart.',
  })
  @ApiParam({ name: 'id', description: 'ID Redis du match', example: 'm-cs2-001' })
  @ApiCreatedResponse({ schema: { example: { ok: true } } })
  async init(@Param('id') matchId: string) {
    await this.matchState.initEconomy(matchId);
    return { ok: true };
  }

  @Get()
  @ApiOperation({
    summary: 'Économie équipes + joueurs',
    description: 'Retourne l\'état économique courant : banques home/away, loss streaks, et argent individuel de chaque joueur.',
  })
  @ApiParam({ name: 'id', description: 'ID Redis du match', example: 'm-cs2-001' })
  @ApiOkResponse({ description: '{ team: TeamEconomyMeta, players: PlayerEconomy[] }' })
  async get(@Param('id') matchId: string) {
    return {
      team:    await this.matchState.getTeamEconomyMeta(matchId),
      players: await this.matchState.getPlayersEconomy(matchId),
    };
  }

  @Patch('round-end')
  @ApiOperation({
    summary: 'Mettre à jour l\'économie après fin de round',
    description: `Met à jour les loss streaks et calcule les bonus de consolation.
- L\'équipe **gagnante** reçoit un bonus win standard et réinitialise son loss streak.
- L\'équipe **perdante** incrémente son loss streak et reçoit le bonus correspondant (1500–3400 $).`,
  })
  @ApiParam({ name: 'id', description: 'ID Redis du match', example: 'm-cs2-001' })
  @ApiBody({ type: RoundEndDto })
  @ApiOkResponse({ schema: { example: { ok: true } } })
  async end(@Param('id') matchId: string, @Body() dto: RoundEndDto) {
    const gameSide = await this.matchState.logicalToSide(matchId, dto.winner);
    if (!gameSide) return { ok: false };
    return { ok: await this.matchState.updateEconomyOnRoundEnd(matchId, gameSide) };
  }

  @Patch('player/money')
  @ApiOperation({
    summary: 'Définir l\'argent d\'un joueur',
    description: 'Force le montant d\'argent d\'un joueur spécifique (utile pour correction manuelle ou tests).',
  })
  @ApiParam({ name: 'id', description: 'ID Redis du match', example: 'm-cs2-001' })
  @ApiBody({ type: PlayerMoneyDto })
  @ApiOkResponse({ schema: { example: { ok: true } } })
  async money(@Param('id') matchId: string, @Body() dto: PlayerMoneyDto) {
    await this.matchState.setPlayerMoney(matchId, dto.steamId, dto.money);
    return { ok: true };
  }

  @Patch('player/equip')
  @ApiOperation({
    summary: 'Définir la valeur d\'équipement d\'un joueur',
    description: 'Met à jour la valeur d\'équipement (armes + grenades + armure) pour un joueur. Utilisé pour le calcul des économies en overlay.',
  })
  @ApiParam({ name: 'id', description: 'ID Redis du match', example: 'm-cs2-001' })
  @ApiBody({ type: PlayerEquipDto })
  @ApiOkResponse({ schema: { example: { ok: true } } })
  async equip(@Param('id') matchId: string, @Body() dto: PlayerEquipDto) {
    await this.matchState.setPlayerEquipValue(matchId, dto.steamId, dto.equip);
    return { ok: true };
  }
}
