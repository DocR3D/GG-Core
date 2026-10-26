// src/domain/rules/live.rule.ts

import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import { EventTypes, type EventType } from '@domain/events/event.types';
import type { KillEvent, RoundStartEvent, TeamRoundWinEvent } from '@domain/events/match.event';
import type { CommandEvent } from '@domain/events/command.event';
import { PauseCommand } from '@app/match/commands/pause.command';
import { MatchPhase } from '@domain/phase.types';
import { Logger } from '@nestjs/common';
import { GameSide } from '@app/match/state';
import { CS2_RULES, CS2_CFG } from '@domain/rules/rules.constants';

export class LiveRule extends BaseRule implements PhaseRule {
  name = 'live_main' as const;
  private readonly logger = new Logger(LiveRule.name);

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

  constructor(private readonly pauseCmd: PauseCommand) {
    super();
    this.events.set(EventTypes.ROUND_START, this.onRoundStart.bind(this));
    this.events.set(EventTypes.TEAM_ROUND_WIN, this.onTeamRoundWin.bind(this));
    this.events.set(EventTypes.KILL, this.onKill.bind(this));

    // Délégation des commandes
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
      command: `exec ${CS2_CFG.COMPETITIVE}; exec ${CS2_CFG.COMPETITIVE_TMM}; mp_warmup_end 1`,
    });
    await ctx.orch.restartGame({ serverId, matchId: ctx.matchId, delay: CS2_RULES.FAST_RESTART_DELAY_SEC });

    await ctx.say('[live] Passage en phase LIVE.');
    await ctx.orch.push(ctx.matchId, 'match:state', await ctx.state.getSnapshot(ctx.matchId));
    ctx.orch.setPhase(ctx.matchId, MatchPhase.LIVE_MAIN);
  }

  async onExit(_: RuleContext) {}

  // =========================================================================
  // Events
  // =========================================================================
  private async onRoundStart(_ev: RoundStartEvent, ctx: RuleContext) {
    await ctx.orch.push(ctx.matchId, 'match:state', await ctx.state.getSnapshot(ctx.matchId));
  }

  private async onKill(ev: KillEvent, ctx: RuleContext) {
    await ctx.orch.push(ev.matchId, 'kill' as any, {
      ...(ev as KillEvent).payload,
      round: ev.round,
      tick: ev.tick,
    });
  }

  private async onTeamRoundWin(ev: TeamRoundWinEvent, ctx: RuleContext) {
    const winner = ((ev.payload as any)?.winner || (ev.payload as any)?.team) as string | undefined;
    if (!winner) return;

    // 1) Anti-eBot Duplicate Round Guard
    // Prevents counting the same round twice if duplicate logs are emitted
    const lastScored = await ctx.state.getLastScoredRound(ev.matchId);
    if (ev.round != null && ev.round > 0 && ev.round <= lastScored) {
      this.logger.warn(
        `[LiveRule] Dropping duplicate round win event for round ${ev.round} (already scored up to ${lastScored})`,
      );
      return;
    }
    if (ev.round != null && ev.round > 0) {
      await ctx.state.setLastScoredRound(ev.matchId, ev.round);
    }

    // 2) Increment Score & Economy
    await ctx.orch.roundEnd(ev.matchId, winner as any);

    const snapshot = await ctx.state.getSnapshot(ev.matchId);
    const scoreCT = snapshot.score.ct;
    const scoreT = snapshot.score.t;
    const totalRounds = scoreCT + scoreT;
    const settings = await ctx.state.getSettings(ev.matchId);
    const mr = settings.mrFormat ?? CS2_RULES.DEFAULT_MR_HALF;

    await ctx.orch.push(ev.matchId, 'score:update', {
      score: snapshot.score,
      sides: snapshot.sides,
      teams: snapshot.teams,
    });

    const serverId = ctx.serverId ?? (await ctx.state.getServerIdFromMatchId(ev.matchId));

    // 3) Halftime Check (Regulation MR12 at round 12)
    const halftimePlayed = await ctx.state.isHalftimePlayed(ev.matchId);
    if (!halftimePlayed && totalRounds === mr) {
      await ctx.state.setHalftimePlayed(ev.matchId, true);
      await ctx.say(`[GG-Core] MI-TEMPS ! Score: CT ${scoreCT} - ${scoreT} T. Inversion des côtés...`);

      if (serverId) {
        await ctx.orch.rcon({ serverId, matchId: ev.matchId, command: 'mp_swapteams' });
      }
      await ctx.orch.swapSides(ev.matchId);

      if (settings.warmupAtHalftime) {
        await ctx.orch.setPhase(ev.matchId, MatchPhase.HALFTIME);
        await ctx.say('[GG-Core] Mi-temps tactique : Tapez !ready quand vous êtes prêts.');
      } else {
        // Fast LAN mode: automatic quick restart
        if (serverId) {
          await ctx.orch.restartGame({ serverId, matchId: ev.matchId, delay: CS2_RULES.FAST_RESTART_DELAY_SEC });
        }
      }
      return;
    }

    // 4) Victory or Overtime Check
    const otCount = await ctx.state.getOvertimeCount(ev.matchId);

    if (otCount === 0) {
      // --- REGULATION MR12 ---
      const targetWin = mr + 1; // 13 rounds in MR12
      if (scoreCT >= targetWin || scoreT >= targetWin) {
        const winningSide: GameSide = scoreCT >= targetWin ? 'CT' : 'T';
        await ctx.orch.endMatch(ev.matchId, winningSide, ctx);
        return;
      }

      // Tie at 12-12 -> Overtime check
      if (scoreCT === mr && scoreT === mr) {
        if (settings.overtimeEnabled) {
          await ctx.say('[GG-Core] ÉGALITÉ 12-12 ! Début des prolongations (MR3)...');
          if (serverId) {
            await ctx.orch.rcon({ serverId, matchId: ev.matchId, command: `exec ${CS2_CFG.OVERTIME}` });
          }
          await ctx.state.setOvertimeCount(ev.matchId, 1);
          await ctx.orch.setPhase(ev.matchId, MatchPhase.OVERTIME);

          if (settings.warmupAtOvertime) {
            await ctx.say('[GG-Core] Prolongations : Tapez !ready quand vous êtes prêts.');
          }
          return;
        } else {
          // Tie game accepted
          await ctx.orch.endMatch(ev.matchId, null, ctx);
          return;
        }
      }
    } else {
      // --- OVERTIME MR3 ---
      const otMr = settings.overtimeMrFormat ?? CS2_RULES.DEFAULT_OT_HALF;
      const targetOtWin = mr + (otCount * otMr) + 1; // e.g. 16 for OT1, 19 for OT2
      const lead = Math.abs(scoreCT - scoreT);

      if ((scoreCT >= targetOtWin || scoreT >= targetOtWin) && lead >= CS2_RULES.DEFAULT_OT_WIN_MARGIN) {
        const winningSide: GameSide = scoreCT > scoreT ? 'CT' : 'T';
        await ctx.orch.endMatch(ev.matchId, winningSide, ctx);
        return;
      }

      // Mid-overtime swap (every otMr rounds, e.g. 3 rounds)
      const roundsInThisOt = (scoreCT + scoreT) - mr - ((otCount - 1) * otMr * 2);
      if (roundsInThisOt === otMr) {
        await ctx.say(`[GG-Core] Prolongations : Mi-temps (round ${otMr}/${otMr * 2}). Inversion des côtés...`);
        if (serverId) {
          await ctx.orch.rcon({ serverId, matchId: ev.matchId, command: 'mp_swapteams' });
        }
        await ctx.orch.swapSides(ev.matchId);
        if (serverId) {
          await ctx.orch.restartGame({ serverId, matchId: ev.matchId, delay: CS2_RULES.FAST_RESTART_DELAY_SEC });
        }
        return;
      }

      // End of this overtime tied (e.g. 15-15 in OT1 -> advance to OT2)
      if (roundsInThisOt === otMr * 2 && scoreCT === scoreT) {
        const nextOt = otCount + 1;
        await ctx.state.setOvertimeCount(ev.matchId, nextOt);
        await ctx.say(`[GG-Core] Égalité en prolongations (${scoreCT}-${scoreT}) ! Début OT${nextOt}...`);
        if (serverId) {
          await ctx.orch.restartGame({ serverId, matchId: ev.matchId, delay: CS2_RULES.FAST_RESTART_DELAY_SEC });
        }
        return;
      }
    }
  }

  // =========================================================================
  // Commands
  // =========================================================================
  private async onCommand(cmd: CommandEvent, ctx: RuleContext) {
    await this.pauseCmd.handle(cmd, ctx);
  }
}
