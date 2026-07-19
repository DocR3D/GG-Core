// src/adapters/http/tournaments/series-create.controller.ts
import { randomUUID } from 'crypto';
import {
  Controller,
  Param,
  Post,
  Body,
  NotFoundException,
  BadRequestException,
  Logger,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiProperty,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { MatchStateService } from '@app/match/state/match-state.service';
import { SeriesStateService, type SeriesMapEntry } from '@app/match/state/series-state.service';
import { AgentClientService } from '@app/servers/agent-client.service';
import { TournamentCacheService } from '@app/tournaments/tournament-cache.service';
import { MatchRepository } from '@adapters/postgres/match.repository';
import { MatchHistoryRepository } from '@adapters/postgres/match-history.repository';
import { SeriesRepository } from '@adapters/postgres/series.repository';
import { MatchCommandsService } from '@app/commands/match-commands.service';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class SeriesMapDto {
  @ApiProperty({ example: 'de_mirage', description: 'Identifiant CS2 de la map' })
  map!: string;

  @ApiProperty({
    example: 12,
    description: 'ID de l\'équipe qui démarre côté CT sur cette map (doit être homeId ou awayId)',
  })
  ctTeamId!: number;
}

class CreateSeriesDto {
  @ApiProperty({ example: 12, description: 'ID de l\'équipe home (doit appartenir au tournoi)' })
  homeId!: number;

  @ApiProperty({ example: 34, description: 'ID de l\'équipe away (doit appartenir au tournoi)' })
  awayId!: number;

  @ApiProperty({ example: 'srv-a', description: 'ID du serveur CS2 à lier à la série' })
  serverId!: string;

  @ApiProperty({ example: 3, enum: [1, 3, 5], description: 'Format best-of (1, 3 ou 5)' })
  bo!: 1 | 3 | 5;

  @ApiProperty({
    type: [SeriesMapDto],
    example: [
      { map: 'de_ancient', ctTeamId: 12 },
      { map: 'de_mirage',  ctTeamId: 34 },
      { map: 'de_inferno', ctTeamId: 12 },
    ],
    description: 'Liste des maps (longueur <= bo). ctTeamId détermine le côté de départ par map.',
  })
  maps!: SeriesMapDto[];

  @ApiProperty({ example: true, description: 'Active les prolongations (overtime) sur toutes les maps' })
  overtime!: boolean;
}

class CreateSeriesResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({ example: 's-a1b2c3d4e5f6', description: 'ID Redis de la série' })
  seriesId!: string;

  @ApiProperty({ example: 'm-a1b2c3d4e5f6', description: 'ID Redis du premier match' })
  matchId!: string;

  @ApiProperty({ example: 7, description: 'ID PostgreSQL du match (map 1) créé' })
  dbId!: number;

  @ApiProperty({ example: 3, description: 'ID PostgreSQL de la Series créée' })
  seriesDbId!: number;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags('matches')
@Controller('tournaments/:id/series')
export class TournamentSeriesCreateController {
  private readonly logger = new Logger(TournamentSeriesCreateController.name);

  constructor(
    private readonly matchState: MatchStateService,
    private readonly seriesState: SeriesStateService,
    private readonly agentClient: AgentClientService,
    private readonly tournamentCache: TournamentCacheService,
    private readonly matchRepo: MatchRepository,
    private readonly historyRepo: MatchHistoryRepository,
    private readonly seriesRepo: SeriesRepository,
    private readonly cmds: MatchCommandsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Créer une série (Bo1/Bo3/Bo5) pour un tournoi',
    description: `Initialise une série complète :
- Crée la row \`Series\` en base avec le format BoN
- Génère un ID Redis de série + un ID Redis pour la map 1
- Configure les sides, score, timeouts et les métadonnées de série en Redis
- Lance la map 1 sur le serveur CS2 via l'agent
- **Map décisive** (dernière possible du BoN) = knife round ; les autres = warmup direct → live`,
  })
  @ApiParam({ name: 'id', description: 'ID PostgreSQL du tournoi', example: 1 })
  @ApiBody({ type: CreateSeriesDto })
  @ApiCreatedResponse({ type: CreateSeriesResponseDto })
  async create(
    @Param('id', ParseIntPipe) tournoiId: number,
    @Body() dto: CreateSeriesDto,
  ) {
    // ── Validation ──────────────────────────────────────────────────────────
    this.logger.debug(`create series — dto reçu : ${JSON.stringify(dto)}`);

    if (!dto.serverId || typeof dto.serverId !== 'string' || dto.serverId.trim() === '') {
      throw new BadRequestException('serverId est requis');
    }
    if (dto.homeId === dto.awayId) {
      throw new BadRequestException('homeId et awayId doivent être différents');
    }
    if (![1, 3, 5].includes(dto.bo)) {
      throw new BadRequestException('bo doit être 1, 3 ou 5');
    }
    if (!Array.isArray(dto.maps) || dto.maps.length === 0) {
      throw new BadRequestException('maps ne doit pas être vide');
    }
    if (dto.maps.length > dto.bo) {
      throw new BadRequestException(
        `maps.length (${dto.maps.length}) ne peut pas dépasser bo (${dto.bo})`,
      );
    }
    for (const m of dto.maps) {
      if (!m.map || typeof m.map !== 'string' || m.map.trim() === '') {
        throw new BadRequestException(
          `map est requis et doit être une chaîne non-vide (ctTeamId=${m.ctTeamId})`,
        );
      }
      if (m.ctTeamId !== dto.homeId && m.ctTeamId !== dto.awayId) {
        throw new BadRequestException(
          `ctTeamId (${m.ctTeamId}) sur la map "${m.map}" doit être homeId ou awayId`,
        );
      }
    }
    this.logger.debug(`validation OK — serverId=${dto.serverId} bo=${dto.bo} maps=[${dto.maps.map(m => m.map).join(',')}]`);

    // ── Tournoi + équipes ────────────────────────────────────────────────────
    const tournament = await this.tournamentCache.getTournament(tournoiId);
    if (!tournament) {
      throw new NotFoundException(`Tournoi ${tournoiId} introuvable dans le cache`);
    }
    if (!tournament.team_ids.includes(dto.homeId)) {
      throw new BadRequestException(`L'équipe home (${dto.homeId}) n'appartient pas au tournoi ${tournoiId}`);
    }
    if (!tournament.team_ids.includes(dto.awayId)) {
      throw new BadRequestException(`L'équipe away (${dto.awayId}) n'appartient pas au tournoi ${tournoiId}`);
    }

    const [homeTeam, awayTeam] = await Promise.all([
      this.tournamentCache.getTeam(dto.homeId),
      this.tournamentCache.getTeam(dto.awayId),
    ]);
    if (!homeTeam) throw new NotFoundException(`Équipe home ${dto.homeId} introuvable dans le cache`);
    if (!awayTeam) throw new NotFoundException(`Équipe away ${dto.awayId} introuvable dans le cache`);

    // ── Génération des IDs ───────────────────────────────────────────────────
    const seriesId = 's-' + randomUUID().replace(/-/g, '').slice(0, 12);
    const matchId  = 'm-' + randomUUID().replace(/-/g, '').slice(0, 12);

    // ── Maps : convertir ctTeamId → ctTeamLogical ────────────────────────────
    const seriesMaps: SeriesMapEntry[] = dto.maps.map((m) => ({
      map:            m.map,
      ctTeamLogical:  m.ctTeamId === dto.homeId ? 'home' : 'away',
    }));

    // ── Créer Series en DB ───────────────────────────────────────────────────
    const seriesDbId = await this.seriesRepo.insert({
      id_tournoi: tournoiId,
      home_id:    String(dto.homeId),
      away_id:    String(dto.awayId),
      bo:         dto.bo,
    });

    // ── Init Redis série ─────────────────────────────────────────────────────
    await this.seriesState.initSeries(seriesId, {
      bo:              dto.bo,
      overtimeEnabled: dto.overtime,
      homeId:          String(dto.homeId),
      awayId:          String(dto.awayId),
      maps:            seriesMaps,
    });
    await this.seriesState.setDbId(seriesId, seriesDbId);
    await this.seriesState.setCurrentMatch(seriesId, 1, matchId);

    // ── Init Redis match (map 1) ─────────────────────────────────────────────
    const firstMap        = seriesMaps[0];
    const firstHomeSide   = firstMap.ctTeamLogical === 'home' ? 'CT' : 'T';
    const isDecidingMap   = dto.bo === 1; // Bo1 = seule map = décisive ; Bo3/Bo5 map1 ne l'est pas

    await this.matchState.setSides(matchId, {
      home: firstHomeSide as 'CT' | 'T',
      away: firstHomeSide === 'CT' ? 'T' : 'CT',
    });
    await this.matchState.initScore(matchId);
    await this.matchState.initTimeouts(matchId, 4, 4, 0, 0);
    await this.matchState.setTeams(matchId, {
      home_id:   String(dto.homeId),
      home_name: homeTeam.name,
      away_id:   String(dto.awayId),
      away_name: awayTeam.name,
    });
    await this.matchState.setMatchConfig(matchId, {
      overtimeEnabled: dto.overtime,
      isDecidingMap,
      seriesId,
      mapNumber: 1,
    });

    // ── Liaison serveur ──────────────────────────────────────────────────────
    await this.matchState.setServerIdToMatchId(dto.serverId, matchId);

    // ── Roster depuis le cache tournoi ───────────────────────────────────────
    await Promise.all([
      ...homeTeam.players.map((p) =>
        this.matchState.upsertPlayer(matchId, { steamId: String(p.id), name: p.name, logical: 'home' }),
      ),
      ...awayTeam.players.map((p) =>
        this.matchState.upsertPlayer(matchId, { steamId: String(p.id), name: p.name, logical: 'away' }),
      ),
    ]);

    // ── Persistance PostgreSQL ────────────────────────────────────────────────
    const dbId = await this.matchRepo.insert({
      match_redis_id: matchId,
      id_tournoi:     tournoiId,
      series_id:      seriesDbId,
      map_number:     1,
      equipe1:        String(dto.homeId),
      equipe2:        String(dto.awayId),
    });

    await this.historyRepo.insert({
      id_match:   dbId,
      event_type: 'series:init',
      data: {
        seriesId,
        seriesDbId,
        bo:           dto.bo,
        overtime:     dto.overtime,
        maps:         dto.maps,
        tournoiId,
        homeId:       dto.homeId,
        homeTeam:     homeTeam.name,
        awayId:       dto.awayId,
        awayTeam:     awayTeam.name,
        serverId:     dto.serverId,
        isDecidingMap,
      },
    });

    // ── Init agent : changelevel + warmup ────────────────────────────────────
    try {
      await this.agentClient.initMatch(dto.serverId, matchId, firstMap.map);
      this.logger.log(
        `Série ${seriesId} (seriesDbId=${seriesDbId}) bo${dto.bo} — match ${matchId} (dbId=${dbId}) map=${firstMap.map} decidingMap=${isDecidingMap}`,
      );
    } catch (err) {
      this.logger.warn(
        `initMatch ${firstMap.map} -> ${dto.serverId} échoué (agent indisponible ?) : ${(err as Error).message}`,
      );
    }

    return { ok: true, seriesId, matchId, dbId, seriesDbId };
  }
}
