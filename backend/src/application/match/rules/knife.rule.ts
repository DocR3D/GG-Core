// src/domain/rules/knife.rule.ts
import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import { EventTypes, type EventType } from '@domain/events/event.types';
import type { KillEvent, TeamRoundWinEvent } from '@domain/events/match.event';
import type { Logical } from '@app/match/state/sides-score.service';
import { MatchPhase } from '@domain/phase.types';
import { Logger } from '@nestjs/common';

type TeamSide = 'CT' | 'T';
type SteamId = string;

type KnifeState = {
  playersHome: Set<SteamId>;
  playersAway: Set<SteamId>;
  deathsHome:  Set<SteamId>;
  deathsAway:  Set<SteamId>;
  finished?: boolean; // 🚦 évite double-traitement
};

export class KnifeRule extends BaseRule implements PhaseRule {
  name = 'knife_live' as const;

  publicTypes = new Set<EventType>([
    EventTypes.KILL,
    EventTypes.TEAM_ROUND_WIN,
    'match:state' as EventType,
    'pause:update' as EventType,
  ]);

  private state = new Map<string, KnifeState>();

  constructor() {
    super();
    this.events.set(EventTypes.KILL, this.onKill.bind(this));
    this.events.set(EventTypes.TEAM_ROUND_WIN, this.onTeamRoundWin.bind(this));
  }

  // === Lifecycle ============================================================
  async onEnter(ctx: RuleContext) {
    const rosters = await ctx.state.getPlayers(ctx.matchId);
    this.state.set(ctx.matchId, {
      playersHome: new Set((rosters.home ?? []).map(p => p.steamId).filter(Boolean)),
      playersAway: new Set((rosters.away ?? []).map(p => p.steamId).filter(Boolean)),
      deathsHome:  new Set(),
      deathsAway:  new Set(),
    });

    const serverId = ctx.serverId ?? (await ctx.state.getServerIdFromMatchId(ctx.matchId));
    if (!serverId) throw new Error(`Aucun serveur lié au match ${ctx.matchId}`);

    await ctx.orch.execCfg({ serverId, matchId: ctx.matchId}, 'ggbot/knife.cfg');
    await ctx.say('[knife] Knife round begins!');
    await ctx.orch.push(ctx.matchId, 'match:state', await ctx.state.getSnapshot(ctx.matchId));
  }

  async onExit(_: RuleContext) {
    // no-op
  }

  // === Events ===============================================================
  private async onKill(ev: KillEvent, ctx: RuleContext) {
    const st = this.state.get(ev.matchId);
    if (!st || st.finished) return;

    const killed = this.extractVictim(ev);
    if (!killed) return;
    const side = this.toTeamSide(killed.team as any);
    if (!side) {
      await ctx.say(`[knife][warn] team inconnu pour ${killed.name}: ${side}`);
      return;
    }
    const logical = await ctx.orch.sideToLogical(ev.matchId, side);
    const key = this.normalizeId(killed.steamId, killed.name);
    

    if (logical === 'home') st.deathsHome.add(key);
    else if (logical === 'away') st.deathsAway.add(key);
  }
private async onTeamRoundWin(ev: TeamRoundWinEvent, ctx: RuleContext) {
  // Trace utile pour diagnostiquer
  await ctx.say(`[knife] onTeamRoundWin payload=${JSON.stringify(ev.payload)}`);

  const st = this.state.get(ev.matchId);
  const serverId = ctx.serverId ?? (await ctx.state.getServerIdFromMatchId(ev.matchId));
  if (!serverId) {
    await ctx.say(`[knife][error] aucun serveur lié au match ${ev.matchId}`);
    return;
  }

  // Si pas d'état en mémoire (rare), fallback sur l’event brut
  if (!st) {
    const winnerFromEvent = this.toTeamSide((ev.payload as any)?.winner);
    if (!winnerFromEvent) {
      await ctx.say('[knife][error] winner introuvable dans payload et aucun état en mémoire');
      return;
    }
    try {
      await ctx.orch.applyKnifeResult(ev.matchId, winnerFromEvent);
      await ctx.orch.execCfg({ serverId, matchId: ev.matchId}, 'ggbot/knife_undo.cfg' );
      await ctx.orch.startPhaseCountdown(ev.matchId, MatchPhase.KNIFE_CHOICE, 0, serverId);
    } catch (e) {
      await ctx.say(`[knife][error] fallback persist/transition: ${(e as Error)?.message ?? e}`);
    }
    return;
  }

  // Tie-break: moins de morts => gagnant logique
  let winnerLogical: Logical =
    st.deathsAway.size > st.deathsHome.size ? 'home' : 'away';

  // Égalité parfaite → fallback sur l’event brut
  if (st.deathsAway.size === st.deathsHome.size) {
    const sideFromEvent = this.toTeamSide((ev.payload as any)?.winner);
    if (sideFromEvent) {
      const logicalFromEvent = await ctx.orch.sideToLogical(ev.matchId, sideFromEvent);
      if (logicalFromEvent) winnerLogical = logicalFromEvent;
    }
  }

  // Convertit le gagnant logique en côté physique 'CT' | 'T'
  let winnerSide = await ctx.orch.logicalToSide(ev.matchId, winnerLogical);
  if(winnerSide == undefined) return;
  await ctx.say(
    `[knife] Gagnant knife: ${winnerSide} (homeDeaths=${st.deathsHome.size}, awayDeaths=${st.deathsAway.size})`,
  );
  let winSide = this.toTeamSide(winnerSide)
  if(winSide == undefined) return;

  try {
    // Persiste le résultat avec le gagnant calculé/normalisé
    await ctx.orch.applyKnifeResult(ev.matchId, winSide);

    // Notifie (optionnel)
    await ctx.orch.push(ev.matchId, 'knife:result', {
      matchId: ev.matchId,
      side: winnerSide,
      logical: winnerLogical,
      counts: { home: st.deathsHome.size, away: st.deathsAway.size },
      ts: Date.now(),
    });
  } catch (e) {
    await ctx.say(`[knife][warn] persistance du résultat KO: ${(e as Error)?.message ?? e}`);
  }

  // Retire le cfg knife, puis transition vers KNIFE_CHOICE
  try {
    await ctx.orch.execCfg({ serverId, matchId: ev.matchId}, 'ggbot/knife_undo.cfg');
  } catch (e) {
    await ctx.say(`[knife][warn] knife_undo.cfg KO: ${(e as Error)?.message ?? e}`);
  }

  // Verrouille et nettoie l’état pour éviter des doubles traitements
  (st as any).finished = true;
  this.state.delete(ev.matchId);
  if(!ctx.serverId) ctx.serverId = await ctx.state.getServerIdFromMatchId(ev.matchId)
  if(ctx.serverId) ctx.orch.startWarmup(ctx.serverId);
  try {
    await ctx.orch.startPhaseCountdown(ev.matchId, MatchPhase.KNIFE_CHOICE, 0, serverId);
  } catch (e) {
    await ctx.say(`[knife][error] transition KNIFE_CHOICE KO: ${(e as Error)?.message ?? e}`);
  }
}

  // === Helpers ==============================================================
  private extractVictim(ev: KillEvent) {
    switch (ev.payload.kind) {
      case 'player': return ev.payload.victim;
      case 'world':  return ev.payload.victim;
      case 'suicide': return ev.payload.player;
      default: return undefined;
    }
  }



  private normalizeId(steamId?: string, name?: string) {
    if (!steamId) return name ?? 'unknown';
    const id = steamId.toLowerCase();
    return id.startsWith('bot') ? (name ?? id) : steamId;
  }

  private toTeamSide(team: string | undefined): 'CT' | 'T' | undefined {
  if (!team) return undefined;
  if (team === 'CT') return 'CT';
  if (team === 'T' || team === 'TERRORIST') return 'T';
  return undefined;
}

}

