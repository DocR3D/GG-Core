import { Injectable, Logger } from '@nestjs/common';
import { EventTypes } from '@domain/events/event.types';
import type { AnyEvent } from '@domain/events/match.event';
import { MatchPhase } from '@domain/phase.types';
import { isNonPlayingSide } from '@domain/side.types';
import { MatchOrchestrator } from '@app/match/match-orchestrator.service';
import { MatchStateService, normalizeSide } from '@app/match/state/match-state.service';

@Injectable()
export class KillAndBombEventsHandler {
  private readonly logger = new Logger(KillAndBombEventsHandler.name);
  private readonly pendingDefuser = new Map<string, { steamId: string; name?: string; team?: string }>();

  constructor(
    private readonly orchestrator: MatchOrchestrator,
    private readonly matchState: MatchStateService,
  ) {}

  private isBot(steamId?: string): boolean {
    if (!steamId) return true;
    const s = steamId.trim().toUpperCase();
    return s === 'BOT' || s === 'CONSOLE' || s === 'WORLD';
  }

  private async autoRoster(
    matchId: string,
    player?: { steamId?: string; name?: string; team?: string },
    opts?: { preserveLogical?: boolean },
  ): Promise<void> {
    if (!player?.steamId || this.isBot(player.steamId) || !player?.team || isNonPlayingSide(player.team)) return;
    try {
      const side = normalizeSide(player.team as any);
      const logical = await this.matchState.sideToLogical(matchId, side);
      if (logical) {
        let shouldPreserve = opts?.preserveLogical ?? false;
        if (!shouldPreserve && typeof (this.matchState as any).getScore === 'function') {
          const sc = await this.matchState.getScore(matchId);
          if (sc && (sc.ct + sc.t) >= 12) {
            shouldPreserve = true;
          }
        }
        await this.matchState.upsertPlayer(
          matchId,
          {
            steamId: player.steamId,
            name: player.name || player.steamId,
            logical,
          },
          { preserveLogical: shouldPreserve },
        );
      }
    } catch (err) {
      this.logger.debug(`[KillAndBombEventsHandler] Auto-roster error: ${err}`);
    }
  }

  async handle(ev: AnyEvent & { matchId: string }): Promise<boolean> {
    if (typeof (this.matchState as any).getPhase === 'function') {
      const currentPhase = await this.matchState.getPhase(ev.matchId);
      if (currentPhase === MatchPhase.POSTGAME) {
        this.pendingDefuser.delete(ev.matchId);
        return false;
      }
    }

    const isWarmupEvent = (ev as any).round === 0;

    switch (ev.type) {
      case EventTypes.MATCH_START: {
        this.pendingDefuser.delete(ev.matchId);
        let totalRounds = 0;
        if (typeof (this.matchState as any).getScore === 'function') {
          const sc = await this.matchState.getScore(ev.matchId);
          totalRounds = (sc?.ct ?? 0) + (sc?.t ?? 0);
        }
        if (totalRounds <= 1) {
          if (typeof (this.matchState as any).initScore === 'function') {
            await this.matchState.initScore(ev.matchId);
          }
          if (typeof (this.matchState as any).setLastScoredRound === 'function') {
            await this.matchState.setLastScoredRound(ev.matchId, 0);
          }
          if (typeof (this.matchState as any).setHalftimePlayed === 'function') {
            await this.matchState.setHalftimePlayed(ev.matchId, false);
          }
          if (typeof (this.matchState as any).setOvertimeCount === 'function') {
            await this.matchState.setOvertimeCount(ev.matchId, 0);
          }
          if (typeof (this.matchState as any).resetPlayerStats === 'function') {
            await this.matchState.resetPlayerStats(ev.matchId);
          }
          if (typeof (this.matchState as any).resetStreaks === 'function') {
            await this.matchState.resetStreaks(ev.matchId);
          }
        }
        return false;
      }

      case EventTypes.ROUND_START: {
        this.pendingDefuser.delete(ev.matchId);
        // Photo des stats et séries au début du round (= instant du backup de round CS2) pour un éventuel rollback
        if (!isWarmupEvent) {
          const sc = await this.matchState.getScore(ev.matchId);
          await this.matchState.snapshotRound(ev.matchId, (sc?.ct ?? 0) + (sc?.t ?? 0));
        }
        return false;
      }

      case EventTypes.KILL: {
        const p = ev.payload as any;
        if (p) {
          if (p.kind === 'player' && p.killer) {
            const killer = !this.isBot(p.killer.steamId) ? {
              steamId: p.killer.steamId,
              name: p.killer.name,
            } : undefined;
            const victim = (p.victim && !this.isBot(p.victim.steamId)) ? {
              steamId: p.victim.steamId,
              name: p.victim.name,
            } : undefined;

            const isSameTeam = Boolean(
              p.killer.team &&
                p.victim?.team &&
                !isNonPlayingSide(p.killer.team) &&
                !isNonPlayingSide(p.victim.team) &&
                normalizeSide(p.killer.team as any) === normalizeSide(p.victim.team as any),
            );
            const isTeamkill = Boolean(p.teamkill) || isSameTeam;

            if (!isWarmupEvent && (killer || victim)) {
              await this.matchState.recordKill(
                ev.matchId,
                killer as any,
                victim,
                Boolean(p.headshot),
                isTeamkill,
              );
            }

            await this.autoRoster(ev.matchId, p.killer);
            await this.autoRoster(ev.matchId, p.victim);
          } else if (p.kind === 'suicide' && (p.player || p.victim)) {
            const vic = p.player || p.victim;
            // Ignorer les suicides techniques émis par CS2 lors d'une déconnexion ou d'un changement d'équipe (<Unassigned> / <Spectator>) ou d'un BOT
            if (this.isBot(vic.steamId) || (vic.team && isNonPlayingSide(vic.team))) {
              return false;
            }
            if (!isWarmupEvent) {
              await this.matchState.recordKill(
                ev.matchId,
                undefined as any,
                { steamId: vic.steamId, name: vic.name },
                false,
              );
            }
            await this.autoRoster(ev.matchId, vic);
          }
        }
        return false;
      }

      case EventTypes.ASSIST: {
        const p = ev.payload as any;
        if (p?.player?.steamId && !this.isBot(p.player.steamId)) {
          const isFriendlyAssist = Boolean(
            p.player.team &&
              p.victim?.team &&
              !isNonPlayingSide(p.player.team) &&
              !isNonPlayingSide(p.victim.team) &&
              normalizeSide(p.player.team as any) === normalizeSide(p.victim.team as any),
          );
          if (!isWarmupEvent && !isFriendlyAssist) {
            await this.matchState.recordAssist(
              ev.matchId,
              {
                steamId: p.player.steamId,
                name: p.player.name,
              },
              Boolean(p.flashAssist),
            );
          }
          await this.autoRoster(ev.matchId, p.player);
        }
        return false;
      }

      case EventTypes.BOMB_PLANTED: {
        await this.orchestrator.onBombPlanted(ev);
        const p = ev.payload as any;
        const planter = p?.planter || p?.player;
        if (planter?.steamId) {
          if (!isWarmupEvent) {
            await this.matchState.recordBombPlant(ev.matchId, {
              steamId: planter.steamId,
              name: planter.name,
            });
          }
          await this.autoRoster(ev.matchId, planter);
        }
        return false;
      }

      case EventTypes.BOMB_DEFUSED: {
        const p = ev.payload as any;
        const defuser = p?.defuser || p?.player;
        this.pendingDefuser.delete(ev.matchId);
        if (defuser?.steamId) {
          if (!isWarmupEvent) {
            await this.matchState.recordBombDefuse(ev.matchId, {
              steamId: defuser.steamId,
              name: defuser.name,
            });
          }
          await this.autoRoster(ev.matchId, defuser);
        }
        return false;
      }

      case EventTypes.DEFUSE_BEGIN: {
        const p = ev.payload as any;
        if (p?.player?.steamId) {
          this.pendingDefuser.set(ev.matchId, p.player);
          await this.autoRoster(ev.matchId, p.player);
        }
        return false;
      }

      case EventTypes.DEFUSE_ABORT: {
        this.pendingDefuser.delete(ev.matchId);
        return false;
      }

      case EventTypes.TEAM_ROUND_WIN: {
        const p = ev.payload as any;
        // Backup restore (mp_backup_restore_load_file) : CS2 logge un `Round_Draw` portant le score restauré,
        // égal ou inférieur au score courant. CS2 remet alors stats joueurs et séries à cet instant : on fait pareil
        // (kills du round annulé et morts techniques du respawn effacés).
        if (p?.reason === 'draw' && typeof p?.score?.ct === 'number' && typeof p?.score?.t === 'number') {
          this.pendingDefuser.delete(ev.matchId);
          const restored = p.score.ct + p.score.t;
          const sc = await this.matchState.getScore(ev.matchId);
          const current = (sc?.ct ?? 0) + (sc?.t ?? 0);
          if (restored > 0 && restored <= current && (await this.matchState.restoreRound(ev.matchId, restored))) {
            this.logger.log(`[KillAndBombEventsHandler] backup restore detected match=${ev.matchId}: stats and team streaks rolled back to ${restored} rounds played`);
          }
          return false;
        }
        if (p?.reason === 'defused') {
          const defuser = this.pendingDefuser.get(ev.matchId);
          if (defuser?.steamId) {
            this.pendingDefuser.delete(ev.matchId);
            await this.matchState.recordBombDefuse(ev.matchId, {
              steamId: defuser.steamId,
              name: defuser.name,
            });
          }
        } else {
          this.pendingDefuser.delete(ev.matchId);
        }
        return false;
      }

      case EventTypes.BEGIN_BOMB_PLANT:
      case EventTypes.GRENADE_THROW:
      case EventTypes.PLAYER_BLINDED:
        this.logger.debug(`[KillAndBombEventsHandler] event=${ev.type} match=${ev.matchId}`);
        return false;

      default:
        return false;
    }
  }
}
