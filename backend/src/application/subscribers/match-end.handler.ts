// src/application/subscribers/match-end.handler.ts
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { EventTypes } from '@domain/events/event.types';
import type { AnyEvent } from '@domain/events/match.event';
import { MatchOrchestrator } from '@app/match/match-orchestrator.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { MatchPhase } from '@domain/phase.types';

/**
 * Gère les events de cycle de vie de fin de match émis par l'agent :
 *
 *  CS_WIN_PANEL_MATCH  → match terminé définitivement → POSTGAME
 *  CS_INTERMISSION     → halftime ou fin d'OT ; on délègue au contexte de phase courant
 *  BEGIN_NEW_MATCH     → restart du serveur → reset score + WARMUP_MAIN
 */
@Injectable()
export class MatchEndHandler {
  private readonly logger = new Logger(MatchEndHandler.name);

  constructor(
    @Inject(forwardRef(() => MatchOrchestrator))
    private readonly orch: MatchOrchestrator,
    private readonly state: MatchStateService,
  ) {}

  async handle(ev: AnyEvent & { matchId: string }): Promise<void> {
    switch (ev.type) {
      case EventTypes.CS_WIN_PANEL_MATCH:
        await this.onWinPanel(ev.matchId);
        break;
      case EventTypes.CS_INTERMISSION:
        await this.onIntermission(ev.matchId);
        break;
      case EventTypes.BEGIN_NEW_MATCH:
        await this.onBeginNewMatch(ev.matchId);
        break;
    }
  }

  // ---------------------------------------------------------------------------

  /**
   * cs_win_panel_match → vainqueur définitif, transition vers POSTGAME.
   * Appelé après cs_intermission dans la séquence CS2.
   */
  private async onWinPanel(matchId: string): Promise<void> {
    const phase = await this.orch.getPhase(matchId);
    if (phase === MatchPhase.POSTGAME) return; // idempotent

    this.logger.log(`[${matchId}] cs_win_panel_match → POSTGAME`);
    await this.orch.triggerMatchEnd(matchId, 'cs_win_panel_match');
  }

  /**
   * cs_intermission → signale une pause CS2.
   * En régulation : c'est la mi-temps → délègue à runHalftime (déjà géré par
   * RegulationService, mais on sert de filet de sécurité).
   * En overtime terminé : c'est la fin → POSTGAME.
   */
  private async onIntermission(matchId: string): Promise<void> {
    const phase = await this.orch.getPhase(matchId);

    if (phase === MatchPhase.OVERTIME) {
      // Fin d'OT → match définitivement terminé
      this.logger.log(`[${matchId}] cs_intermission en OVERTIME → fin de match`);
      await this.orch.triggerMatchEnd(matchId, 'overtime_end');
      return;
    }

    if (phase === MatchPhase.LIVE_MAIN) {
      // Filet de sécurité : halftime si RegulationService ne l'a pas déjà déclenché
      const score  = await this.state.getScore(matchId);
      const config = await this.state.getMatchConfig(matchId);
      const round  = await this.state.getRound(matchId);

      if (config.maxRounds > 0 && round <= config.maxRounds / 2) {
        this.logger.log(`[${matchId}] cs_intermission en LIVE_MAIN → halftime (fallback)`);
        await this.orch.runHalftime(matchId);
      } else {
        this.logger.debug(
          `[${matchId}] cs_intermission ignoré (phase=${phase} round=${round} score=${JSON.stringify(score)})`,
        );
      }
    }
  }

  /**
   * begin_new_match → le serveur a redémarré un nouveau match.
   * Reset du score et transition vers WARMUP_MAIN.
   */
  private async onBeginNewMatch(matchId: string): Promise<void> {
    this.logger.log(`[${matchId}] begin_new_match → reset score + WARMUP_MAIN`);
    await this.state.initScore(matchId);
    await this.orch.setPhase(matchId, MatchPhase.WARMUP_MAIN);
    const snapshot = await this.state.getSnapshot(matchId);
    await this.orch.push(matchId, 'match:state', snapshot);
  }
}
