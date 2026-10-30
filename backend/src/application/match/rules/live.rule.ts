// src/domain/rules/live.rule.ts

import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import { EventTypes, type EventType } from '@domain/events/event.types';
import type { KillEvent, RoundStartEvent, TeamRoundWinEvent } from '@domain/events/match.event';
import type { CommandEvent } from '@domain/events/command.event';
import { PauseCommand } from '@app/match/commands/pause.command';
import { MatchPhase } from '@domain/phase.types';
import { Logger } from '@nestjs/common';
import { GameSide } from '@app/match/state';
import { CS2_RULES, CS2_CFG, CS2_RCON_COMMANDS } from '@domain/rules/rules.constants';

export class LiveRule extends BaseRule implements PhaseRule {
  name = 'live_main' as const;
  private readonly logger = new Logger(LiveRule.name);

  publicTypes = new Set<EventType>([
    EventTypes.ROUND_START,
    EventTypes.TEAM_ROUND_WIN,
    EventTypes.SFUI_TARGET_BOMBED,
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
    this.events.set(EventTypes.SFUI_TARGET_BOMBED, this.onTeamRoundWin.bind(this));
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

    const phase = typeof (ctx.orch as any)?.getPhase === 'function'
      ? await ctx.orch.getPhase(ctx.matchId)
      : MatchPhase.LIVE_MAIN;

    const snapshot = typeof ctx.state?.getSnapshot === 'function'
      ? await ctx.state.getSnapshot(ctx.matchId)
      : null;
    const totalRounds = (snapshot?.score?.ct ?? 0) + (snapshot?.score?.t ?? 0);
    const otCount = typeof ctx.state?.getOvertimeCount === 'function'
      ? await ctx.state.getOvertimeCount(ctx.matchId)
      : 0;

    if (phase === MatchPhase.OVERTIME || otCount > 0) {
      await ctx.say('[live] Match en prolongation (OVERTIME).');
      if (snapshot) {
        await ctx.orch.push(ctx.matchId, 'match:state', snapshot);
      }
      return;
    }

    if (totalRounds > 0) {
      await ctx.orch.rcon({ serverId, matchId: ctx.matchId, command: CS2_RCON_COMMANDS.UNPAUSE_MATCH }).catch(() => {});
      await ctx.say('[live] Reprise du match LIVE.');
      if (snapshot) {
        await ctx.orch.push(ctx.matchId, 'match:state', snapshot);
      }
      return;
    }

    if (typeof (ctx.state as any)?.resetPlayerStats === 'function') {
      await (ctx.state as any).resetPlayerStats(ctx.matchId);
    }
    if (typeof (ctx.state as any)?.resetStreaks === 'function') {
      await (ctx.state as any).resetStreaks(ctx.matchId);
    }

    await ctx.orch.rcon({
      serverId,
      matchId: ctx.matchId,
      command: CS2_RCON_COMMANDS.COMPETITIVE_START,
    });
    // Overtime must be configured BEFORE the last regulation round: CS2 decides OT vs draw itself at 12-12.
    const startSettings = await ctx.state.getSettings(ctx.matchId);
    if (startSettings.overtimeEnabled) {
      await ctx.orch.execCfg({ serverId, matchId: ctx.matchId }, CS2_CFG.OVERTIME);
    } else {
      await ctx.orch.rcon({ serverId, matchId: ctx.matchId, command: 'mp_overtime_enable 0' });
    }
    // CS2 runs halftime / OT halftime natively from these convars: they must match GG-Core's settings
    // (the cfgs above set the MR12 / MR3 defaults), otherwise both sides swap at different rounds.
    const mr = startSettings.mrFormat ?? CS2_RULES.DEFAULT_MR_HALF;
    const otMr = startSettings.overtimeMrFormat ?? CS2_RULES.DEFAULT_OT_HALF;
    await ctx.orch.rcon({
      serverId,
      matchId: ctx.matchId,
      command: `mp_maxrounds ${mr * 2}; mp_overtime_maxrounds ${otMr * 2}`,
    });
    // The only restart of the match: right before the first live round.
    await ctx.orch.restartGame({ serverId, matchId: ctx.matchId, delay: CS2_RULES.FAST_RESTART_DELAY_SEC });

    await ctx.say('[live] Passage en phase LIVE.');
    await ctx.orch.push(ctx.matchId, 'match:state', await ctx.state.getSnapshot(ctx.matchId));
    await ctx.orch.setPhase(ctx.matchId, MatchPhase.LIVE_MAIN);
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
    if (!winner || winner === 'none' || (ev.payload as any)?.reason === 'draw') {
      // Backup restore : CS2 logge un Round_Draw portant le score restauré (souvent inférieur au courant).
      // On réaligne le score tout de suite au lieu d'attendre le prochain round gagné.
      const restored = (ev.payload as any)?.score;
      if (typeof restored?.ct === 'number' && typeof restored?.t === 'number') {
        const current = await ctx.state.getScore(ev.matchId);
        if (restored.ct + restored.t <= (current?.ct ?? 0) + (current?.t ?? 0)) {
          await ctx.state.reconcileScore(ev.matchId, restored.ct, restored.t);
          // Les rounds annulés vont être rejoués avec les mêmes numéros : la garde anti-doublon doit les accepter
          await ctx.state.setLastScoredRound(ev.matchId, restored.ct + restored.t);
          await ctx.orch.push(ev.matchId, 'score:update', { score: await ctx.state.getScore(ev.matchId) });
        }
      }
      return;
    }

    this.logger.log(`[LiveRule] Team round win event received: winner=${winner} reason=${(ev.payload as any)?.reason} match=${ev.matchId}`);

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

    // Reconcilier immédiatement avec le score authoritative CS2 natif (si fourni dans l'événement)
    const authoritativeScore = (ev.payload as any)?.score;
    if (
      authoritativeScore &&
      typeof authoritativeScore.ct === 'number' &&
      typeof authoritativeScore.t === 'number'
    ) {
      await ctx.state.reconcileScore(ev.matchId, authoritativeScore.ct, authoritativeScore.t);
    }

    const snapshot = await ctx.state.getSnapshot(ev.matchId);
    const scoreCT = snapshot.score.ct;
    const scoreT = snapshot.score.t;
    const totalRounds = scoreCT + scoreT;
    const settings = await ctx.state.getSettings(ev.matchId);
    const mr = settings.mrFormat ?? CS2_RULES.DEFAULT_MR_HALF;

    this.logger.log(`[LiveRule] Score updated: CT ${scoreCT} - ${scoreT} T (round ${totalRounds}) match=${ev.matchId}`);

    await ctx.orch.push(ev.matchId, 'score:update', {
      score: snapshot.score,
      sides: snapshot.sides,
      teams: snapshot.teams,
      economy: snapshot.economy,
      streaks: snapshot.streaks,
    });

    const serverId = ctx.serverId ?? (await ctx.state.getServerIdFromMatchId(ev.matchId));

    // 3) Halftime Check (Regulation MR12 at round 12)
    // CS2 performs the halftime itself (mp_maxrounds = 2 x MR): it swaps the teams and KEEPS the score.
    // GG-Core only follows: no mp_swapteams (it would swap the teams back) and no mp_restartgame
    // (it would reset the server score to 0-0) - both observed on a real server.
    const halftimePlayed = await ctx.state.isHalftimePlayed(ev.matchId);
    if (!halftimePlayed && totalRounds === mr) {
      await ctx.state.setHalftimePlayed(ev.matchId, true);
      await ctx.say(`[GG-Core] MI-TEMPS ! Score: CT ${scoreCT} - ${scoreT} T. Changement de côtés.`);

      await ctx.orch.swapSides(ev.matchId);
      if (typeof (ctx.state as any).resetStreaks === 'function') {
        await (ctx.state as any).resetStreaks(ev.matchId);
      }

      if (settings.warmupAtHalftime) {
        await ctx.orch.setPhase(ev.matchId, MatchPhase.HALFTIME);
        await ctx.say('[GG-Core] Mi-temps tactique : Tapez !ready quand vous êtes prêts.');
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
          // overtime.cfg was applied at live start: CS2 starts the overtime by itself
          await ctx.say(`[GG-Core] ÉGALITÉ ${scoreCT}-${scoreT} ! Début des prolongations (MR${settings.overtimeMrFormat ?? CS2_RULES.DEFAULT_OT_HALF})...`);
          await ctx.state.setOvertimeCount(ev.matchId, 1);
          if (typeof (ctx.state as any).resetStreaks === 'function') {
            await (ctx.state as any).resetStreaks(ev.matchId);
          }
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

      // Mid-overtime swap (every otMr rounds, e.g. 3 rounds): done natively by CS2, GG-Core follows.
      const roundsInThisOt = (scoreCT + scoreT) - (mr * 2) - ((otCount - 1) * otMr * 2);
      if (roundsInThisOt === otMr) {
        await ctx.say(`[GG-Core] Prolongations : Mi-temps (round ${otMr}/${otMr * 2}). Changement de côtés.`);
        await ctx.orch.swapSides(ev.matchId);
        if (typeof (ctx.state as any).resetStreaks === 'function') {
          await (ctx.state as any).resetStreaks(ev.matchId);
        }
        return;
      }

      // End of this overtime tied (e.g. 15-15 in OT1 -> advance to OT2 without swapping sides,
      // as CS2 native overtime keeps teams on their current side at the start of the next OT)
      if (roundsInThisOt === otMr * 2 && scoreCT === scoreT) {
        const nextOt = otCount + 1;
        await ctx.state.setOvertimeCount(ev.matchId, nextOt);
        await ctx.say(`[GG-Core] Égalité en prolongations (${scoreCT}-${scoreT}) ! Début OT${nextOt}...`);
        if (typeof (ctx.state as any).resetStreaks === 'function') {
          await (ctx.state as any).resetStreaks(ev.matchId);
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
