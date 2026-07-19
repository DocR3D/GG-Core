// src/adapters/http/matches/players.controller.ts
import { Controller, Param, Body, Post, Patch, Delete, Get } from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiParam, ApiBody, ApiProperty,
  ApiPropertyOptional, ApiOkResponse, ApiCreatedResponse, ApiNotFoundResponse,
} from '@nestjs/swagger';
import { MatchStateService } from '@app/match/state/match-state.service';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class UpsertPlayerDto {
  @ApiProperty({ example: '76561198000000001', description: 'Steam ID 64 du joueur (identifiant unique)' })
  steamId: string;
  @ApiPropertyOptional({ example: 's1mple', description: 'Pseudo affiché (optionnel, mis à jour si fourni)' })
  name?: string;
  @ApiProperty({
    enum: ['home', 'away'],
    example: 'home',
    description: 'Équipe logique du joueur (`home` ou `away`)',
  })
  logical: 'home' | 'away';
}

class MovePlayerDto {
  @ApiProperty({
    enum: ['home', 'away'],
    example: 'away',
    description: 'Équipe cible vers laquelle déplacer le joueur',
  })
  logical: 'home' | 'away';
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags('matches')
@Controller('matches/:id/players')
export class PlayersController {
  constructor(private readonly matchState: MatchStateService) {}

  @Post()
  @ApiOperation({
    summary: 'Ajouter ou mettre à jour un joueur',
    description: 'Crée le joueur s\'il n\'existe pas, ou met à jour son nom/équipe s\'il est déjà présent. Idempotent sur le steamId.',
  })
  @ApiParam({ name: 'id', description: 'ID Redis du match', example: 'm-cs2-001' })
  @ApiBody({ type: UpsertPlayerDto })
  @ApiCreatedResponse({ schema: { example: { ok: true } } })
  async upsert(@Param('id') matchId: string, @Body() body: UpsertPlayerDto) {
    await this.matchState.upsertPlayer(matchId, body);
    return { ok: true };
  }

  @Patch(':steamId/move')
  @ApiOperation({
    summary: 'Déplacer un joueur vers l\'autre équipe',
    description: 'Change l\'appartenance logique du joueur (home ↔ away). Utile en cas d\'erreur de saisie ou de réorganisation des équipes avant le match.',
  })
  @ApiParam({ name: 'id',      description: 'ID Redis du match',    example: 'm-cs2-001' })
  @ApiParam({ name: 'steamId', description: 'Steam ID 64 du joueur', example: '76561198000000001' })
  @ApiBody({ type: MovePlayerDto })
  @ApiOkResponse({ schema: { example: { ok: true } } })
  @ApiNotFoundResponse({ description: 'Joueur introuvable dans le match' })
  async move(
    @Param('id') matchId: string,
    @Param('steamId') steamId: string,
    @Body() body: MovePlayerDto,
  ) {
    const ok = await this.matchState.movePlayerLogical(matchId, steamId, body.logical);
    return { ok };
  }

  @Delete(':steamId')
  @ApiOperation({
    summary: 'Retirer un joueur du match',
    description: 'Supprime le joueur de l\'état Redis du match. N\'affecte pas l\'historique PostgreSQL.',
  })
  @ApiParam({ name: 'id',      description: 'ID Redis du match',    example: 'm-cs2-001' })
  @ApiParam({ name: 'steamId', description: 'Steam ID 64 du joueur', example: '76561198000000001' })
  @ApiOkResponse({ schema: { example: { ok: true } } })
  async remove(@Param('id') matchId: string, @Param('steamId') steamId: string) {
    await this.matchState.removePlayer(matchId, steamId);
    return { ok: true };
  }

  @Get()
  @ApiOperation({
    summary: 'Lister les joueurs du match',
    description: 'Retourne tous les joueurs enregistrés dans Redis pour ce match, groupés par équipe logique (home/away).',
  })
  @ApiParam({ name: 'id', description: 'ID Redis du match', example: 'm-cs2-001' })
  @ApiOkResponse({ description: 'Liste des joueurs avec steamId, name, logical' })
  async list(@Param('id') matchId: string) {
    return this.matchState.getPlayers(matchId);
  }
}
