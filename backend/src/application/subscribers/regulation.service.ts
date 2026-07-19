// src/application/subscribers/regulation.service.ts
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { MatchStateService } from '@app/match/state/match-state.service';
import { MatchOrchestrator } from '@app/match/match-orchestrator.service';
import { MatchPhase } from '@domain/phase.types';

/**
 * Détecte la fin de régulation après chaque mise à jour de score (TEAM_SCORE).
 * Déclenche les transitions : halftime → overtime → fin de match.
 *
 * Règles (selon plan refacto) :
 *  - score(t|ct) >= winRounds AND rounds <= maxRounds  → vainqueur en régulation
 *  - round === maxRounds / 2                           → halftime (sides swap)
 *  - round === maxRounds AND t === ct                  → OT si activé, sinon fin
 */
@Injectable()
export class RegulationService {
  private readonly logger = new Logger(RegulationService.name);

  constructor(
    private readonly state: MatchStateService,
    @Inject(forwardRef(() => MatchOrchestrator))
    private readonly orch: MatchOrchestrator,
  ) {}

  async checkAfterScore(matchId: string): Promise<void> {
    try {
      await this._check(matchId);
    } catch (e) {
      this.logger.error(`[${matchId}] checkAfterScore erreur: ${e}`);
    }
  }

  private async _check(matchId: string): Promise<void> {
    // Ne s'applique qu'en phase live_main ou overtime
    const phase = await this.orch.getPhase(matchId);
    if (phase !== MatchPhase.LIVE_MAIN && phase !== MatchPhase.OVERTIME) return;

    const score  = await this.state.getScore(matchId);
    const config = await this.state.getMatchConfig(matchId);
    const round  = await this.state.getRound(matchId);

    const { maxRounds, winRounds, overtimeEnabled } = config;
    const { t, ct } = score;

    this.logger.debug(
      `[${matchId}] check regulation — round=${round} t=${t} ct=${ct} ` +
      `winRounds=${winRounds} maxRounds=${maxRounds} ot=${overtimeEnabled}`,
    );

    // 1. Vainqueur en régulation
    if (t >= winRounds || ct >= winRounds) {
      this.logger.log(`[${matchId}] Vainqueur régulation (t=${t} ct=${ct})`);
      await this.orch.triggerMatchEnd(matchId, 'regulation_winner');
      return;
    }

    // 2. Halftime (mi-temps)
    if (maxRounds > 0 && round === maxRounds / 2) {
      this.logger.log(`[${matchId}] Halftime détecté (round=${round})`);
      await this.orch.runHalftime(matchId);
      return;
    }

    // 3. Fin de régulation sur égalité
    if (maxRounds > 0 && round >= maxRounds && t === ct) {
      if (overtimeEnabled) {
        this.logger.log(`[${matchId}] Égalité à la fin de régulation → Overtime`);
        await this.orch.runOvertime(matchId);
      } else {
        this.logger.log(`[${matchId}] Égalité mais overtime désactivé → fin de match`);
        await this.orch.triggerMatchEnd(matchId, 'tie_no_overtime');
      }
    }
  }
}
