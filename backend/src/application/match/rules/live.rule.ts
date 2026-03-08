// src/domain/rules/live.rule.ts

import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import { EventTypes, type EventType } from '@domain/events/event.types';
import type { KillEvent, RoundStartEvent, TeamRoundWinEvent } from '@domain/events/match.event';
import type { CommandEvent } from '@domain/events/command.event';
import { PauseCommand } from '@app/match/commands/pause.command';

export class LiveRule extends BaseRule implements PhaseRule {
  name = 'live_main' as const;

  publicTypes = new Set<EventType>([
    EventTypes.ROUND_START,
    EventTypes.TEAM_ROUND_WIN,
    EventTypes.KILL,
    'match:state' as EventType,
    'score:update' as EventType,
    'pause:update' as EventType,
    'sides:swapped' as EventType,
    'chat:public' as EventType,
    'grenade_throw' as EventType,
    'player_blinded' as EventType,
  ]);

  constructor(
    private readonly pauseCmd: PauseCommand
  ) {
    super();
    this.events.set(EventTypes.ROUND_START, this.onRoundStart.bind(this));
    this.events.set(EventTypes.TEAM_ROUND_WIN, this.onTeamRoundWin.bind(this));
    this.events.set(EventTypes.KILL, this.onKill.bind(this));

    // Délégation des commandes à la nouvelle classe
    this.commands.set('pause', this.onCommand.bind(this));
    this.commands.set('unpause', this.onCommand.bind(this));
    this.commands.set('tac', this.onCommand.bind(this));
    this.commands.set('tech', this.onCommand.bind(this));
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================
  async onEnter(ctx: RuleContext) {
    const serverId = ctx.serverId ?? (await ctx.state.getServerIdFromMatchId(ctx.matchId));
    if (!serverId) throw new Error(`Aucun serveur lié au match ${ctx.matchId}`);

    await ctx.orch.rcon({
      serverId,
      matchId: ctx.matchId,
      command: 'exec gamemode_competitive.cfg; exec gamemode_competitive_tmm; mp_warmup_end 1',
    });
    await ctx.orch.restartGame({ serverId, matchId: ctx.matchId, delay: 3 });

    await ctx.say('[live] Passage en phase LIVE.');
    await ctx.orch.push(ctx.matchId, 'match:state', await ctx.state.getSnapshot(ctx.matchId));
    ctx.orch.setPhase(ctx.matchId, "live_main")
  }

  async onExit(_: RuleContext) {
    // no-op pour l'instant
  }

  // =========================================================================
  // Events
  // =========================================================================
  private async onRoundStart(ev: RoundStartEvent, ctx: RuleContext) {
    await ctx.orch.push(ev.matchId, 'round:start', {
      round: ev.round,
      ...(ev as any).payload ?? {},
    });
  }

  private async onTeamRoundWin(ev: TeamRoundWinEvent, ctx: RuleContext) {
    const winner = (ev.payload as any)?.winner as string | undefined;
    if (!winner) return;

    await ctx.orch.roundEnd(ev.matchId, winner as any);

    const snapshot = await ctx.state.getSnapshot(ev.matchId);
    await ctx.orch.push(ev.matchId, 'score:update', {
      score: snapshot.score,
      sides: snapshot.sides,
      teams: snapshot.teams,
    });
  }

  private async onKill(ev: KillEvent, ctx: RuleContext) {
    await ctx.orch.push(ev.matchId, 'kill', {
      ...(ev as KillEvent).payload,
      round: ev.round,
      tick: ev.tick,
    });
  }

  // =========================================================================
  // Commands
  // =========================================================================
  private async onCommand(cmd: CommandEvent, ctx: RuleContext) {
    const handled = await this.pauseCmd.handle(cmd, ctx);
    if (!handled) {
      // Gérer le cas où la commande n'est pas gérée par le service de commande
    }
  }
}