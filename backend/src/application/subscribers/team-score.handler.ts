// src/application/subscribers/team-score.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { EventTypes } from '@domain/events/event.types';
import type { AnyEvent } from '@domain/events/match.event';
import { MatchStateService } from '@app/match/state/match-state.service';
import { MatchOrchestrator } from '@app/match/match-orchestrator.service';
import { RegulationService } from './regulation.service';

/**
 * Gère les events autoritaires de score/état match émis par l'agent Go :
 *   - TEAM_SCORE           → écrit le score absolu en Redis (source de vérité CS2)
 *   - MATCH_END_CONDITIONS → stocke maxRounds / winRounds / overtimeEnabled
 *
 * La détection de fin de régulation / halftime / overtime est déléguée à
 * RegulationService (Phase C — à implémenter).
 */
@Injectable()
export class TeamScoreHandler {
  private readonly logger = new Logger(TeamScoreHandler.name);

  constructor(
    private readonly state: MatchStateService,
    private readonly orch: MatchOrchestrator,
    private readonly regulation: RegulationService,
  ) {}

  async handle(ev: AnyEvent & { matchId: string }): Promise<void> {
    switch (ev.type) {
      case EventTypes.TEAM_SCORE:
        await this.onTeamScore(ev);
        break;
      case EventTypes.MATCH_END_CONDITIONS:
        await this.onMatchEndConditions(ev);
        break;
    }
  }

  // ---------------------------------------------------------------------------

  private async onTeamScore(ev: AnyEvent & { matchId: string }): Promise<void> {
    const payload = ev.payload as { teamId: number; score: number; teamName?: string };
    if (typeof payload?.teamId !== 'number' || typeof payload?.score !== 'number') {
      this.logger.warn(`[${ev.matchId}] TEAM_SCORE payload invalide: ${JSON.stringify(payload)}`);
      return;
    }

    await this.state.setScoreFromTeamEvent(ev.matchId, payload.teamId, payload.score);

    this.logger.log(
      `[${ev.matchId}] TEAM_SCORE teamId=${payload.teamId} score=${payload.score}` +
      (payload.teamName ? ` (${payload.teamName})` : ''),
    );

    // Pousser la mise à jour WS
    const snapshot = await this.state.getSnapshot(ev.matchId);
    await this.orch.push(ev.matchId, 'score:update', {
      score:    snapshot.score,
      homeIsct: snapshot.homeIsct,
      teams:    snapshot.teams,
    });

    // Vérifier fin de régulation / halftime / overtime
    await this.regulation.checkAfterScore(ev.matchId);
  }

  private async onMatchEndConditions(ev: AnyEvent & { matchId: string }): Promise<void> {
    const payload = ev.payload as { maxRounds?: number; winRounds?: number; overtimeEnabled?: boolean };
    if (!payload) return;

    await this.state.setMatchConfig(ev.matchId, {
      maxRounds:       payload.maxRounds,
      winRounds:       payload.winRounds,
      overtimeEnabled: payload.overtimeEnabled,
    });

    this.logger.log(
      `[${ev.matchId}] MATCH_END_CONDITIONS maxRounds=${payload.maxRounds} ` +
      `winRounds=${payload.winRounds} overtime=${payload.overtimeEnabled}`,
    );
  }
}
