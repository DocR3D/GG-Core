// src/adapters/http/tournaments/tournaments.controller.ts
import {
  Controller, Get, Post, Param, ParseIntPipe,
  NotFoundException, HttpCode,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiParam,
  ApiOkResponse, ApiNotFoundResponse, ApiProperty,
} from '@nestjs/swagger';
import { TournamentCacheService } from '@app/tournaments/tournament-cache.service';
import { TournamentSyncService } from '@app/tournaments/tournament-sync.service';
import { MatchRepository } from '@adapters/postgres/match.repository';

// ─── Schémas de réponse Swagger ──────────────────────────────────────────────

class PlayerDto {
  @ApiProperty({ example: 2, description: 'ID unique du joueur' })
  id: number;
  @ApiProperty({ example: 'Mr. Alvis Shields', description: 'Pseudo du joueur' })
  name: string;
  @ApiProperty({ example: true, description: 'true si le joueur est capitaine de l\'équipe' })
  isCaptain: boolean;
}

class TeamDto {
  @ApiProperty({ example: 1, description: 'ID unique de l\'équipe' })
  id: number;
  @ApiProperty({ example: 'Jacinto Reynolds', description: 'Nom de l\'équipe' })
  name: string;
  @ApiProperty({ type: [PlayerDto], description: 'Liste des joueurs de l\'équipe' })
  players: PlayerDto[];
}

class TournamentDto {
  @ApiProperty({ example: 1 })
  id: number;
  @ApiProperty({ example: 'GG-LAN #18 CS2', description: 'Nom du tournoi' })
  name: string;
  @ApiProperty({ example: 5, description: 'ID du jeu associé (game_id depuis l\'API externe)' })
  game: number;
  @ApiProperty({ enum: ['open', 'finished', 'cancelled'], example: 'open', description: 'Statut du tournoi' })
  status: string;
  @ApiProperty({ example: '2026-12-10', description: 'Date de début (YYYY-MM-DD)' })
  start_date: string;
  @ApiProperty({ example: '2026-12-11', description: 'Date de fin (YYYY-MM-DD)' })
  end_date: string;
  @ApiProperty({ type: [Number], example: [1, 2, 3], description: 'IDs des équipes inscrites' })
  team_ids: number[];
}

class MatchDto {
  @ApiProperty({ example: 1, description: 'ID PostgreSQL du match' })
  id: number;
  @ApiProperty({ example: 'm-a1b2c3d4e5', description: 'ID Redis du match' })
  match_redis_id: string;
  @ApiProperty({ example: 1, nullable: true, description: 'ID du tournoi PostgreSQL' })
  id_tournoi: number | null;
  @ApiProperty({ example: 'Jacinto Reynolds', description: 'Équipe home (CT au départ par défaut)' })
  equipe1: string;
  @ApiProperty({ example: 'Dr. Melvin Tromp DDS', description: 'Équipe away (T au départ par défaut)' })
  equipe2: string;
  @ApiProperty({ example: 16 })
  score_equipe1: number;
  @ApiProperty({ example: 5 })
  score_equipe2: number;
  @ApiProperty({ enum: ['pending', 'live', 'finished'], example: 'live', description: 'Statut courant du match' })
  status: string;
}

class SyncResultDto {
  @ApiProperty({ example: true })
  ok: boolean;
  @ApiProperty({ example: 4 })
  tournaments: number;
  @ApiProperty({ example: 12 })
  teams: number;
  @ApiProperty({ example: null, nullable: true, description: 'Message d\'erreur si ok=false' })
  error?: string;
}

class CacheStatusDto {
  @ApiProperty({ example: '2026-04-13T12:00:00.000Z', nullable: true, description: 'ISO 8601 du dernier sync réussi, null si jamais synchronisé' })
  lastSyncAt: string | null;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags('tournaments')
@Controller()
export class TournamentsController {
  constructor(
    private readonly cache: TournamentCacheService,
    private readonly sync: TournamentSyncService,
    private readonly matchRepo: MatchRepository,
  ) {}

  // ── GET /tournaments ──────────────────────────────────────────────────────

  @Get('tournaments')
  @ApiOperation({
    summary: 'Liste tous les tournois',
    description: 'Retourne les tournois de type `team` uniquement, tels que mis en cache depuis l\'API externe. Appeler `POST /tournaments/sync` pour rafraîchir.',
  })
  @ApiOkResponse({ type: [TournamentDto] })
  async findAllTournaments() {
    const data = await this.cache.getAllTournaments();
    if (!data) return { ok: false, message: 'Cache vide — lancez POST /tournaments/sync', data: [] };
    return { ok: true, data };
  }

  // ── GET /tournaments/status ───────────────────────────────────────────────

  @Get('tournaments/status')
  @ApiOperation({
    summary: 'Statut du cache',
    description: 'Retourne la date ISO du dernier sync réussi, ou `null` si le cache n\'a jamais été initialisé.',
  })
  @ApiOkResponse({ type: CacheStatusDto })
  async cacheStatus() {
    const lastSyncAt = await this.cache.getLastSyncAt();
    return { lastSyncAt: lastSyncAt ?? null };
  }

  // ── GET /tournaments/:id ──────────────────────────────────────────────────

  @Get('tournaments/:id')
  @ApiOperation({ summary: 'Détails d\'un tournoi par ID' })
  @ApiParam({ name: 'id', description: 'ID du tournoi (issu de l\'API externe)', example: 1 })
  @ApiOkResponse({ type: TournamentDto })
  @ApiNotFoundResponse({ description: 'Tournoi introuvable dans le cache' })
  async findOneTournament(@Param('id', ParseIntPipe) id: number) {
    const data = await this.cache.getTournament(id);
    if (!data) throw new NotFoundException(`Tournoi ${id} introuvable dans le cache`);
    return { ok: true, data };
  }

  // ── GET /tournaments/:id/teams ────────────────────────────────────────────

  @Get('tournaments/:id/teams')
  @ApiOperation({
    summary: 'Équipes d\'un tournoi',
    description: 'Retourne toutes les équipes inscrites au tournoi, avec la liste complète des joueurs et l\'indication du capitaine.',
  })
  @ApiParam({ name: 'id', description: 'ID du tournoi', example: 1 })
  @ApiOkResponse({ type: [TeamDto] })
  @ApiNotFoundResponse({ description: 'Tournoi introuvable dans le cache' })
  async findTeamsByTournament(@Param('id', ParseIntPipe) id: number) {
    const tournament = await this.cache.getTournament(id);
    if (!tournament) throw new NotFoundException(`Tournoi ${id} introuvable dans le cache`);

    const teams = await Promise.all(
      tournament.team_ids.map(teamId => this.cache.getTeam(teamId)),
    );

    return { ok: true, data: teams.filter(t => t !== null) };
  }

  // ── GET /tournaments/:id/matches ──────────────────────────────────────────

  @Get('tournaments/:id/matches')
  @ApiOperation({
    summary: 'Matchs d\'un tournoi',
    description: 'Retourne tous les matchs PostgreSQL liés à ce tournoi (via `id_tournoi`). Un match est créé lors de l\'appel `POST /matches/:id/init` avec un `tournoiId`.',
  })
  @ApiParam({ name: 'id', description: 'ID du tournoi', example: 1 })
  @ApiOkResponse({ type: [MatchDto] })
  @ApiNotFoundResponse({ description: 'Tournoi introuvable dans le cache' })
  async findMatchesByTournament(@Param('id', ParseIntPipe) id: number) {
    const tournament = await this.cache.getTournament(id);
    if (!tournament) throw new NotFoundException(`Tournoi ${id} introuvable dans le cache`);

    const data = await this.matchRepo.findByTournoiId(id);
    return { ok: true, data };
  }

  // ── GET /teams/:id ────────────────────────────────────────────────────────

  @Get('teams/:id')
  @ApiOperation({
    summary: 'Détails d\'une équipe',
    description: 'Retourne une équipe avec ses joueurs et l\'indication du capitaine (`isCaptain`).',
  })
  @ApiParam({ name: 'id', description: 'ID de l\'équipe', example: 1 })
  @ApiOkResponse({ type: TeamDto })
  @ApiNotFoundResponse({ description: 'Équipe introuvable dans le cache' })
  async findOneTeam(@Param('id', ParseIntPipe) id: number) {
    const data = await this.cache.getTeam(id);
    if (!data) throw new NotFoundException(`Équipe ${id} introuvable dans le cache`);
    return { ok: true, data };
  }

  // ── POST /tournaments/sync ────────────────────────────────────────────────

  @Post('tournaments/sync')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Refresh manuel du cache',
    description: 'Appelle l\'API externe, transforme les données et écrase le cache Redis. Utile après une modification de tournoi côté API externe. Automatiquement appelé au démarrage du backend.',
  })
  @ApiOkResponse({ type: SyncResultDto })
  async syncNow() {
    return this.sync.sync();
  }
}
