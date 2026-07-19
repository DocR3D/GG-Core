// src/adapters/http/matches/admin-actions.controller.ts
import { Controller, Param, Post, Body, Logger, NotFoundException, BadRequestException, HttpCode } from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiParam, ApiBody, ApiProperty,
  ApiPropertyOptional, ApiOkResponse,
} from '@nestjs/swagger';
import { MatchStateService } from '@app/match/state/match-state.service';
import { MatchRepository } from '@adapters/postgres/match.repository';
import { MatchHistoryRepository } from '@adapters/postgres/match-history.repository';
import { AgentClientService } from '@app/servers/agent-client.service';

// ─── DTOs ────────────────────────────────────────────────────────────────────

const VALID_ACTIONS = ['pause_match', 'unpause_match', 'set_game_phase'] as const;
const VALID_PHASES  = ['warmup', 'knife', 'match_start', 'overtime', 'next_map'] as const;

type AdminActionType = typeof VALID_ACTIONS[number];
type AdminPhaseType  = typeof VALID_PHASES[number];

class ScoreSideDto {
  @ApiProperty({ example: 'team-uuid-ct', description: 'ID de l\'équipe' })
  team_id!: string;
  @ApiProperty({ example: 12, description: 'Score (entier >= 0)' })
  score!: number;
}

class ScoreDto {
  @ApiProperty({ type: ScoreSideDto })
  ct!: ScoreSideDto;
  @ApiProperty({ type: ScoreSideDto })
  t!: ScoreSideDto;
}

class AdminActionDto {
  @ApiProperty({ enum: VALID_ACTIONS, example: 'pause_match' })
  action!: AdminActionType;

  @ApiPropertyOptional({ enum: VALID_PHASES, example: 'knife', description: 'Requis pour set_game_phase' })
  phase?: AdminPhaseType;

  @ApiPropertyOptional({ example: 'de_inferno', description: 'Requis si phase=next_map' })
  map?: string;

  @ApiPropertyOptional({ type: ScoreDto, description: 'Requis si phase=overtime' })
  score?: ScoreDto;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags('matches')
@Controller('matches/:matchId/admin-actions')
export class MatchAdminActionsController {
  private readonly logger = new Logger(MatchAdminActionsController.name);

  constructor(
    private readonly matchState: MatchStateService,
    private readonly matchRepo: MatchRepository,
    private readonly historyRepo: MatchHistoryRepository,
    private readonly agentClient: AgentClientService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exécuter une action admin sur un match',
    description: `Pilote un match CS2 en cours depuis l'interface admin.
Le backend valide la requête, enregistre en historique, puis appelle l'agent Go.

**Actions disponibles :**
- \`pause_match\` — pause tactique
- \`unpause_match\` — reprendre
- \`set_game_phase\` — changer de phase (warmup, knife, match_start, overtime, next_map)`,
  })
  @ApiParam({ name: 'matchId', description: 'ID Redis du match', example: 'm-cs2-001' })
  @ApiBody({ type: AdminActionDto })
  @ApiOkResponse({ schema: { example: { success: true } } })
  async execute(
    @Param('matchId') matchId: string,
    @Body() dto: AdminActionDto,
  ) {
    const { action, phase, map, score } = dto;

    // ── Validation ──────────────────────────────────────────────────────────
    if (!VALID_ACTIONS.includes(action as AdminActionType)) {
      throw new BadRequestException(`action invalide: "${action}". Valeurs: ${VALID_ACTIONS.join(', ')}`);
    }

    if (action === 'set_game_phase') {
      if (!phase) {
        throw new BadRequestException('phase est requis pour set_game_phase');
      }
      if (!VALID_PHASES.includes(phase as AdminPhaseType)) {
        throw new BadRequestException(`phase invalide: "${phase}". Valeurs: ${VALID_PHASES.join(', ')}`);
      }
      if (phase === 'next_map' && !map) {
        throw new BadRequestException('map est requis pour phase=next_map');
      }
      if (phase === 'overtime' && !score) {
        throw new BadRequestException('score est requis pour phase=overtime');
      }
    }

    if (score) {
      if (!score.ct?.team_id || !score.t?.team_id) {
        throw new BadRequestException('score.ct.team_id et score.t.team_id sont requis');
      }
      if (!Number.isInteger(score.ct.score) || score.ct.score < 0) {
        throw new BadRequestException('score.ct.score doit être un entier >= 0');
      }
      if (!Number.isInteger(score.t.score) || score.t.score < 0) {
        throw new BadRequestException('score.t.score doit être un entier >= 0');
      }
      if (score.ct.team_id === score.t.team_id) {
        throw new BadRequestException('score.ct.team_id et score.t.team_id doivent être différents');
      }
    }

    // ── Résolution match + serveur ───────────────────────────────────────────
    const [dbId, serverId] = await Promise.all([
      this.matchRepo.findDbIdByRedisId(matchId),
      this.matchState.getServerIdFromMatchId(matchId),
    ]);

    if (!dbId) {
      throw new NotFoundException(`Match introuvable: "${matchId}"`);
    }
    if (!serverId) {
      throw new NotFoundException(`Match sans serveur: "${matchId}"`);
    }

    // ── Historique (avant l'appel agent) ────────────────────────────────────
    await this.historyRepo.insert({
      id_match: dbId,
      event_type: 'admin:action',
      data: { action, phase, map, score, serverId, requestedAt: new Date().toISOString() },
    });

    // ── Appel agent ─────────────────────────────────────────────────────────
    try {
      await this.agentClient.adminAction(serverId, { action, phase, map, score });
      return { success: true };
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        this.logger.warn(`[${matchId}] admin-action timeout: ${error.message}`);
        return { success: false, error: { code: 'AGENT_TIMEOUT', message: error.message } };
      }
      this.logger.warn(`[${matchId}] admin-action error: ${error.message}`);
      return { success: false, error: { code: 'AGENT_ERROR', message: error.message } };
    }
  }
}
