// src/domain/rules/live.rule.ts
import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import { EventTypes, type EventType } from '@domain/types/event.types';
import type { KillEvent, RoundStartEvent, TeamRoundWinEvent } from '@domain/types/match.event';
import type { CommandEvent } from '@domain/types/command.event';

export class LiveRule extends BaseRule implements PhaseRule {
  name = 'live_main' as const;

  /** Types “visibles” côté front pendant le live */
  publicTypes = new Set<EventType>([
    EventTypes.ROUND_START,
    EventTypes.TEAM_ROUND_WIN,
    EventTypes.KILL,
    'match:state' as EventType,
    'score:update' as EventType,
    'pause:update' as EventType,
    'sides:swapped' as EventType,
    'chat:public' as EventType,
    // ajoute ici tes télémétries si besoin:
    'grenade_throw' as EventType,
    'player_blinded' as EventType,
  ]);

  constructor() {
    super();
    // — table de dispatch des events Live
    this.events.set(EventTypes.ROUND_START, this.onRoundStart.bind(this));
    this.events.set(EventTypes.TEAM_ROUND_WIN, this.onTeamRoundWin.bind(this));
    this.events.set(EventTypes.KILL, this.onKill.bind(this));

    // — (optionnel) commandes live courantes (adaptable à tes services)
    this.commands.set('pause', this.onPause.bind(this));
    this.commands.set('unpause', this.onUnpause.bind(this));
    this.commands.set('tac', this.onTacTimeout.bind(this));        // ex: !tac 30
    this.commands.set('tech', this.onTechTimeout.bind(this));      // ex: !tech 60
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================
  async onEnter(ctx: RuleContext) {
    const serverId = ctx.serverId ?? (await ctx.matchStateService.getServerIdFromMatchId(ctx.matchId));
    if (!serverId) throw new Error(`Aucun serveur lié au match ${ctx.matchId}`);

    // Applique le mode compétitif, termine warmup, restart la game
    await ctx.commands.rcon({
      serverId,
      matchId: ctx.matchId,
      command: 'exec gamemode_competitive.cfg; exec gamemode_competitive_tmm; mp_warmup_end 1',
    });
    await ctx.commands.restartGame({ serverId, matchId: ctx.matchId, delay: 3 });

    await ctx.say('[live] Passage en phase LIVE.');
    await ctx.ws.push(ctx.matchId, 'match:state', await ctx.matchStateService.getSnapshot(ctx.matchId));
  }

  async onExit(_: RuleContext) {
    // no-op pour l’instant
  }

  // =========================================================================
  // Events
  // =========================================================================
  private async onRoundStart(ev: RoundStartEvent, ctx: RuleContext) {
    // Broadcast round:start tel quel (ou mappe en DTO si besoin)
    await ctx.ws.push(ev.matchId, 'round:start', {
      round: ev.round,
      // ajoute ce que tu as dans ev.payload si utile au front
      ...(ev as any).payload ?? {},
    });
  }

  private async onTeamRoundWin(ev: TeamRoundWinEvent, ctx: RuleContext) {
    // Mets à jour ton state/score côté service si tu as une méthode dédiée
    // Exemple minimal : délègue au MatchStateService si existant.
    // await ctx.mss.onTeamRoundWin(ctx.matchId, ev.payload.winner, /* economy? */);

    // Envoie l'event de fin de round + maj score/snapshot
    await ctx.ws.push(ev.matchId, 'round:end', {
      winner: ev.payload.winner,
      reason: ev.payload.reason ?? 'elim',
    });
    ctx.matchStateService.roundEnd(ctx.matchId,ev.payload.winner);
    // Dans tous les cas, renvoie un snapshot pour se resynchroniser
    await ctx.ws.push(ev.matchId, 'match:state', await ctx.matchStateService.getSnapshot(ev.matchId));
  }

  private async onKill(ev: KillEvent, ctx: RuleContext) {
    // Forward au front (tu peux mapper le payload si nécessaire)
    await ctx.ws.push(ev.matchId, 'kill', {
      ...(ev as KillEvent).payload, // killer, victim, weapon, headshot, positions…
      round: ev.round,
      tick: ev.tick,
    });
  }

  // =========================================================================
  // Commands (optionnel)
  // =========================================================================
  private async onPause(cmd: CommandEvent, ctx: RuleContext) {
    // Selon tes services, soit déclencher un vrai “pause” agent/RCON,
    // soit juste marquer en Redis + informer front
    //await ctx.mss.setPaused(cmd.matchId, true);
    await ctx.ws.push(cmd.matchId, 'pause:update', { paused: true, by: cmd.payload.sender?.name });
    await ctx.say('[live] Pause demandée.');
  }

  private async onUnpause(cmd: CommandEvent, ctx: RuleContext) {
   // await ctx.mss.setPaused(cmd.matchId, false);
    await ctx.ws.push(cmd.matchId, 'pause:update', { paused: false, by: cmd.payload.sender?.name });
    await ctx.say('[live] Reprise du match.');
  }

  private async onTacTimeout(cmd: CommandEvent, ctx: RuleContext) {

  }

  private async onTechTimeout(cmd: CommandEvent, ctx: RuleContext) {
    
  }
}
