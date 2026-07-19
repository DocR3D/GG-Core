// matches.controller.ts
import {
  Controller, Patch, Get, Param, Body,
  Query, NotFoundException, BadRequestException, ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiQuery, ApiParam, ApiBody,
  ApiPropertyOptional, ApiProperty, ApiOkResponse, ApiNotFoundResponse, ApiBadRequestResponse,
} from '@nestjs/swagger';
import { MatchStateService } from '@app/match/state/match-state.service';
import { MatchRepository, type MatchStatus } from '@adapters/postgres/match.repository';
import { MatchHistoryRepository } from '@adapters/postgres/match-history.repository';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class SetTeamsDto {
  @ApiPropertyOptional({ example: 'team-uuid-1', description: 'ID logique de l\'équipe home' })
  home_id?: string;
  @ApiPropertyOptional({ example: 'team-uuid-2', description: 'ID logique de l\'équipe away' })
  away_id?: string;
  @ApiPropertyOptional({ example: 'Vitality', description: 'Nom affiché de l\'équipe home' })
  home_name?: string;
  @ApiPropertyOptional({ example: 'NAVI', description: 'Nom affiché de l\'équipe away' })
  away_name?: string;
}

// ─── Schémas de réponse ──────────────────────────────────────────────────────

class MatchRowDto {
  @ApiProperty({ example: 1 })                                      id: number;
  @ApiProperty({ example: 'm-a1b2c3d4e5' })                        match_redis_id: string;
  @ApiProperty({ example: 1, nullable: true })                      id_tournoi: number | null;
  @ApiProperty({ example: 'Vitality' })                             equipe1: string;
  @ApiProperty({ example: 'NAVI' })                                 equipe2: string;
  @ApiProperty({ example: 16 })                                     score_equipe1: number;
  @ApiProperty({ example: 5 })                                      score_equipe2: number;
  @ApiProperty({ enum: ['pending', 'live', 'finished'], example: 'live', description: '`pending` = match créé mais pas encore démarré · `live` = en cours · `finished` = terminé' })
  status: MatchStatus;
}

class PaginatedMatchesDto {
  @ApiProperty({ type: [MatchRowDto] })                             data: MatchRowDto[];
  @ApiProperty({ example: 42, description: 'Nombre total de matchs (hors pagination)' })
  total: number;
  @ApiProperty({ example: 1 })                                      page: number;
  @ApiProperty({ example: 10 })                                     limit: number;
  @ApiProperty({ example: 5 })                                      totalPages: number;
}

// ─── Controller ──────────────────────────────────────────────────────────────

const VALID_STATUSES: MatchStatus[] = ['pending', 'live', 'finished'];

@ApiTags('matches')
@Controller('matches')
export class MatchesController {
  constructor(
    private readonly matches: MatchStateService,
    private readonly matchRepo: MatchRepository,
    private readonly matchHistoryRepo: MatchHistoryRepository,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Liste paginée des matchs',
    description: 'Retourne les matchs PostgreSQL avec pagination. Filtre optionnel par statut.',
  })
  @ApiQuery({ name: 'page',   required: false, example: 1,          description: 'Numéro de page (≥ 1)' })
  @ApiQuery({ name: 'limit',  required: false, example: 10,         description: 'Résultats par page (1–100)' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'live', 'finished'], description: 'Filtre par statut' })
  @ApiOkResponse({ type: PaginatedMatchesDto })
  @ApiBadRequestResponse({ description: 'Valeur de status invalide' })
  async findAll(
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('status') status?: string,
  ) {
    const page  = Math.max(1, parseInt(pageRaw  ?? '1',  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw ?? '10', 10) || 10));

    if (status && !VALID_STATUSES.includes(status as MatchStatus)) {
      throw new BadRequestException(`status doit être l'une des valeurs : ${VALID_STATUSES.join(', ')}`);
    }

    return this.matchRepo.findAllPaginated(page, limit, status as MatchStatus | undefined);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Détails d\'un match + historique',
    description: 'Retourne le match PostgreSQL avec l\'ensemble de son historique d\'événements (`match:init`, `round:end`, …).',
  })
  @ApiParam({ name: 'id', description: 'ID PostgreSQL du match', example: 1 })
  @ApiOkResponse({ description: 'Match + tableau history' })
  @ApiNotFoundResponse({ description: 'Match introuvable' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const match = await this.matchRepo.findById(id);
    if (!match) throw new NotFoundException(`Match ${id} not found`);
    const history = await this.matchHistoryRepo.findByMatchId(id);
    return { ...match, history };
  }

  @Get(':id/score-with-teams')
  @ApiOperation({
    summary: 'Score courant + infos équipes',
    description: 'Lit l\'état Redis en temps réel : score `home`/`away`, noms des équipes, sides actifs (`CT`/`T`).',
  })
  @ApiParam({ name: 'id', description: 'ID Redis du match', example: 'm-a1b2c3d4e5' })
  async getScoreWithTeams(@Param('id') matchId: string) {
    return this.matches.getScoreWithTeams(matchId);
  }

  @Patch(':id/teams')
  @ApiOperation({
    summary: 'Définir les IDs/noms des équipes',
    description: 'Met à jour les métadonnées des équipes dans Redis. Peut être appelé avant ou pendant le match. Les champs non fournis ne sont pas modifiés.',
  })
  @ApiParam({ name: 'id', description: 'ID Redis du match', example: 'm-a1b2c3d4e5' })
  @ApiBody({ type: SetTeamsDto })
  @ApiOkResponse({ schema: { example: { ok: true } } })
  async setTeams(@Param('id') matchId: string, @Body() dto: SetTeamsDto) {
    await this.matches.setTeams(matchId, dto);
    return { ok: true };
  }

  @Get(':id/snapshot')
  @ApiOperation({
    summary: 'Snapshot complet de l\'état Redis du match',
    description: 'Retourne l\'ensemble des données Redis du match : score, sides, équipes, timeouts, économie, phase. Utile pour debug ou reconstitution d\'état.',
  })
  @ApiParam({ name: 'id', description: 'ID Redis du match', example: 'm-a1b2c3d4e5' })
  async getSnapshot(@Param('id') matchId: string) {
    return this.matches.getSnapshot(matchId);
  }
}
