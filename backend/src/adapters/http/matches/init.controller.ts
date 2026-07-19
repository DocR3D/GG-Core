// src/adapters/http/matches/init.controller.ts
import { Controller, Param, Post, Body, Logger } from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiParam, ApiBody, ApiProperty,
  ApiPropertyOptional, ApiCreatedResponse,
} from '@nestjs/swagger';
import { MatchStateService, type GameSide } from '@app/match/state/match-state.service';
import { MatchRepository } from '@adapters/postgres/match.repository';
import { MatchHistoryRepository } from '@adapters/postgres/match-history.repository';
import { MatchCommandsService } from '@app/commands/match-commands.service';

class InitDto {
  @ApiPropertyOptional({
    example: true,
    default: true,
    description: '`true` = équipe home démarre côté CT, `false` = home démarre côté T',
  })
  homeIsct?: boolean;

  @ApiPropertyOptional({
    example: 4,
    default: 4,
    description: 'Nombre de pauses tactiques disponibles par équipe (banque commune home et away)',
  })
  tacTimeouts?: number;

  @ApiPropertyOptional({ example: 'team-uuid-1', description: 'ID logique de l\'équipe home (optionnel, peut être renseigné après)' })
  homeId?: string;

  @ApiPropertyOptional({ example: 'team-uuid-2', description: 'ID logique de l\'équipe away' })
  awayId?: string;

  @ApiPropertyOptional({ example: 'srv-a', description: 'ID du serveur CS2 à lier au match (doit correspondre à un `server_id` en DB)' })
  serverId?: string;

  @ApiPropertyOptional({ example: 'de_dust2', description: 'Nom de la map — si fourni avec serverId, déclenche init.cfg sur le serveur (changelevel + warmup)' })
  map?: string;

  @ApiPropertyOptional({ example: 1, description: 'ID du tournoi PostgreSQL — lie le match à un tournoi pour `GET /tournaments/:id/matches`' })
  tournoiId?: number;
}

class InitResponseDto {
  @ApiProperty({ example: true })
  ok: boolean;
  @ApiProperty({ example: 7, description: 'ID PostgreSQL du match créé' })
  dbId: number;
}

@ApiTags('matches')
@Controller('matches/:id/init')
export class MatchInitController {
  private readonly logger = new Logger('MatchInitController');

  constructor(
    private readonly matchState: MatchStateService,
    private readonly matchRepo: MatchRepository,
    private readonly historyRepo: MatchHistoryRepository,
    private readonly cmds: MatchCommandsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Initialiser un match',
    description: `Crée l\'état Redis du match (sides, score, timeouts), crée une ligne en PostgreSQL et lie optionnellement un serveur CS2.

**Flux typique :**
1. Créer un match ID (chaîne libre, ex: \`m-cs2-001\`)
2. Appeler \`POST /matches/m-cs2-001/init\` avec le corps ci-dessous
3. Le match passe en phase \`warmup_main\` automatiquement`,
  })
  @ApiParam({ name: 'id', description: 'ID Redis du match (chaîne libre choisie par l\'opérateur)', example: 'm-cs2-001' })
  @ApiBody({ type: InitDto })
  @ApiCreatedResponse({ type: InitResponseDto })
  async init(@Param('id') matchId: string, @Body() dto: InitDto = {}) {
    const home: GameSide = (dto.homeIsct ?? true) ? 'CT' : 'T';
    const away: GameSide = home === 'CT' ? 'T' : 'CT';
    const tac = dto.tacTimeouts ?? 4;

    await this.matchState.setSides(matchId, { home, away });
    await this.matchState.initScore(matchId);
    await this.matchState.initTimeouts(matchId, tac, tac, 0, 0);

    if (dto.homeId || dto.awayId) {
      await this.matchState.setTeams(matchId, { home_id: dto.homeId, away_id: dto.awayId });
    }
    if (dto.serverId) {
      await this.matchState.setServerIdToMatchId(dto.serverId, matchId);
      this.logger.debug(`BOUND server "${dto.serverId}" -> match "${matchId}"`);
    }

    const dbId = await this.matchRepo.insert({
      match_redis_id: matchId,
      id_tournoi: dto.tournoiId ?? null,
      equipe1: home === 'CT' ? (dto.homeId ?? 'CT') : (dto.awayId ?? 'CT'),
      equipe2: home === 'T'  ? (dto.homeId ?? 'T')  : (dto.awayId ?? 'T'),
    });

    await this.historyRepo.insert({
      id_match: dbId,
      event_type: 'match:init',
      data: { homeIsct: dto.homeIsct ?? true, homeId: dto.homeId ?? null, awayId: dto.awayId ?? null, serverId: dto.serverId ?? null },
    });

    if (dto.serverId && dto.map) {
      try {
        await this.cmds.initMatch({ serverId: dto.serverId, matchId, map: dto.map });
      } catch (err) {
        this.logger.warn(`initMatch ${dto.map} -> ${dto.serverId} échoué (agent indisponible ?) : ${(err as Error).message}`);
      }
    }

    return { ok: true, dbId };
  }
}
