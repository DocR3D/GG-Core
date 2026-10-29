import { Injectable } from '@nestjs/common';
import {
  SidesScoreService,
  type Logical,
  type CoreSide,
} from './sides-score.service';
import { TimeoutsService } from './timeouts.service';
import { TeamsRosterService, type PlayerInfo } from './rosters.service';
import { EconomyService, type TeamEconomyMeta } from './economy.service';
import { PlayerStatsService, type PlayerCombatStats } from './player-stats.service';
import { SnapshotQuery } from './snapshot.query';
import { Phase } from '@domain/phase.types';
import { MatchSettings } from '@domain/match-settings.types';
import {
  GameSide,
  CS2_SIDE_TERRORIST,
  CS2_SIDE_T,
  CS2_SIDE_CT,
  normalizeSide,
} from '@domain/side.types';

export type { GameSide };
export { CS2_SIDE_TERRORIST, CS2_SIDE_T, CS2_SIDE_CT, normalizeSide };

@Injectable()
export class MatchStateService {
  constructor(
    private readonly sidesScore: SidesScoreService,
    private readonly timeouts: TimeoutsService,
    private readonly teamsRoster: TeamsRosterService,
    private readonly economy: EconomyService,
    private readonly playerStats: PlayerStatsService,
    private readonly snapshotQ: SnapshotQuery,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Server ↔ Match binding
  // ───────────────────────────────────────────────────────────────────────────
  setServerIdToMatchId(serverId: string, matchId: string, ttlSec?: number) {
    return this.sidesScore.setServerMatch(serverId, matchId, ttlSec);
  }
  getMatchIdFromServerId(serverId: string) {
    return this.sidesScore.getMatchIdFromServerId(serverId);
  }
  getServerIdFromMatchId(matchId: string) {
    return this.sidesScore.getServerIdFromMatchId(matchId);
  }

  // Match temps réel ↔ MatchMap PostgreSQL
  setDbMatchMapId(matchId: string, matchMapId: string) {
    return this.sidesScore.setDbMatchMapId(matchId, matchMapId);
  }
  getDbMatchMapId(matchId: string) {
    return this.sidesScore.getDbMatchMapId(matchId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Sides / Score / Phase
  // ───────────────────────────────────────────────────────────────────────────
  setSides(matchId: string, sides: CoreSide) {
    return this.sidesScore.setSides(matchId, sides);
  }
  getSides(matchId: string) {
    return this.sidesScore.getSides(matchId);
  }
  swapSides(matchId: string) {
    return this.sidesScore.swapSides(matchId);
  }
  sideToLogical(matchId: string, side: GameSide) {
    return this.sidesScore.sideToLogical(matchId, normalizeSide(side));
  }

  logicalToSide(matchId: string, logical: Logical) {
    return this.sidesScore.logicalToSide(matchId, logical);
  }
  applyKnifeResult(matchId: string, winnerSide: 'CT' | 'T') {
    return this.sidesScore.applyKnifeResult(matchId, winnerSide);
  }
  getKnifeResult(matchId: string): Promise<{
    side: GameSide | null;
    logical: Logical | null;
    team: { id: string | null; name: string | null } | null;
  }> {
    return this.sidesScore.getKnifeWinner(matchId);
  }

  initScore(matchId: string) {
    return this.sidesScore.initScore(matchId);
  }
  setPhase(matchId: string, phase: Phase) {
    return this.sidesScore.setPhase(matchId, phase);
  }
  incRound(matchId: string) {
    return this.sidesScore.incRound(matchId);
  }
  addPoint(matchId: string, winner: GameSide) {
    return this.sidesScore.addPoint(matchId, normalizeSide(winner));
  }
  reconcileScore(matchId: string, ct: number, t: number) {
    return this.sidesScore.reconcileScore(matchId, ct, t);
  }
  getPhase(matchId: string) {
    return this.sidesScore.getPhase(matchId);
  }
  getRound(matchId: string) {
    return this.sidesScore.getRound(matchId);
  }
  getScore(matchId: string) {
    return this.sidesScore.getScore(matchId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Anti-eBot Bug Guards & Lifecycle State
  // ───────────────────────────────────────────────────────────────────────────
  getLastScoredRound(matchId: string) {
    return this.sidesScore.getLastScoredRound(matchId);
  }
  setLastScoredRound(matchId: string, round: number) {
    return this.sidesScore.setLastScoredRound(matchId, round);
  }
  isHalftimePlayed(matchId: string) {
    return this.sidesScore.isHalftimePlayed(matchId);
  }
  setHalftimePlayed(matchId: string, played: boolean) {
    return this.sidesScore.setHalftimePlayed(matchId, played);
  }
  getOvertimeCount(matchId: string) {
    return this.sidesScore.getOvertimeCount(matchId);
  }
  setOvertimeCount(matchId: string, count: number) {
    return this.sidesScore.setOvertimeCount(matchId, count);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Settings (Warmup toggles, Overtime config, Postgame action)
  // ───────────────────────────────────────────────────────────────────────────
  getSettings(matchId: string) {
    return this.sidesScore.getSettings(matchId);
  }
  setSettings(matchId: string, settings: Partial<MatchSettings>) {
    return this.sidesScore.setSettings(matchId, settings);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Timeouts / Pauses
  // ───────────────────────────────────────────────────────────────────────────
  initTimeouts(
    matchId: string,
    homeTac = 4,
    awayTac = 4,
    homeTech = 0,
    awayTech = 0,
    opts: { force?: boolean } = {},
  ) {
    return this.timeouts.initTimeouts(matchId, homeTac, awayTac, homeTech, awayTech, opts);
  }
  decrTac(matchId: string, logicalTeam: Logical) {
    return this.timeouts.decrTac(matchId, logicalTeam);
  }
  decrTech(matchId: string, logicalTeam: Logical) {
    return this.timeouts.decrTech(matchId, logicalTeam);
  }
  getTimeouts(matchId: string) {
    return this.timeouts.getTimeouts(matchId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Teams / Roster / Économie joueurs
  // ───────────────────────────────────────────────────────────────────────────
  setTeams(
    matchId: string,
    ids: { home_id?: string; away_id?: string; ct_id?: string; t_id?: string; home_name?: string; away_name?: string; ct_name?: string; t_name?: string },
  ) {
    return this.teamsRoster.setTeams(matchId, ids);
  }
  getScoreWithTeams(matchId: string) {
    return this.teamsRoster.getScoreWithTeams(matchId);
  }
  getTeamIds(matchId: string) {
    return this.teamsRoster.getTeamIds(matchId);
  }

  upsertPlayer(matchId: string, p: PlayerInfo, opts?: { preserveLogical?: boolean }) {
    return this.teamsRoster.upsertPlayer(matchId, p, opts);
  }
  movePlayerLogical(matchId: string, steamId: string, logical: Logical) {
    return this.teamsRoster.movePlayerLogical(matchId, steamId, logical);
  }
  removePlayer(matchId: string, steamId: string) {
    return this.teamsRoster.removePlayer(matchId, steamId);
  }
  clearRoster(matchId: string) {
    return this.teamsRoster.clearRoster(matchId);
  }
  getPlayers(matchId: string) {
    return this.teamsRoster.getPlayers(matchId);
  }
  setPlayerMoney(matchId: string, steamId: string, money: number) {
    return this.teamsRoster.setPlayerMoney(matchId, steamId, money);
  }
  setPlayerEquipValue(matchId: string, steamId: string, value: number) {
    return this.teamsRoster.setPlayerEquipValue(matchId, steamId, value);
  }
  getPlayersEconomy(matchId: string) {
    return this.teamsRoster.getPlayersEconomy(matchId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Combat Stats (Scoreboard)
  // ───────────────────────────────────────────────────────────────────────────
  recordKill(
    matchId: string,
    killer: { steamId: string; name?: string },
    victim?: { steamId: string; name?: string },
    headshot = false,
    teamkill = false,
  ) {
    return this.playerStats.recordKill(matchId, killer, victim, headshot, teamkill);
  }
  recordAssist(
    matchId: string,
    assister: { steamId: string; name?: string },
    flashAssist = false,
  ) {
    return this.playerStats.recordAssist(matchId, assister, flashAssist);
  }
  recordBombPlant(
    matchId: string,
    planter: { steamId: string; name?: string },
  ) {
    return this.playerStats.recordBombPlant(matchId, planter);
  }
  recordBombDefuse(
    matchId: string,
    defuser: { steamId: string; name?: string },
  ) {
    return this.playerStats.recordBombDefuse(matchId, defuser);
  }
  getPlayerStats(matchId: string) {
    return this.playerStats.getPlayerStats(matchId);
  }
  setPlayerStats(matchId: string, steamId: string, stats: Partial<PlayerCombatStats>) {
    return this.playerStats.setPlayerStats(matchId, steamId, stats);
  }
  resetPlayerStats(matchId: string) {
    return this.playerStats.resetPlayerStats(matchId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Économie équipes + roundEnd
  // ───────────────────────────────────────────────────────────────────────────
  initEconomy(matchId: string) {
    return this.economy.initEconomy(matchId);
  }
  resetStreaks(matchId: string) {
    return this.economy.resetStreaks(matchId);
  }
  getTeamEconomyMeta(matchId: string): Promise<TeamEconomyMeta> {
    return this.economy.getTeamEconomyMeta(matchId);
  }
  setTeamLossStreak(matchId: string, logical: Logical, streak: number) {
    return this.economy.setTeamLossStreak(matchId, logical, streak);
  }
  updateEconomyOnRoundEnd(matchId: string, winnerSide: GameSide) {
    return this.economy.updateEconomyOnRoundEnd(matchId, normalizeSide(winnerSide));
  }
  async roundEnd(
    matchId: string,
    winnerSide: GameSide,
    playerEconomy?: { steamId: string; money: number; equip: number }[],
  ) {
    const norm = normalizeSide(winnerSide);
    return await this.economy.roundEnd(matchId, norm, playerEconomy);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Snapshot (read-only)
  // ───────────────────────────────────────────────────────────────────────────
  async getSnapshot(matchId: string) {
    return await this.snapshotQ.getSnapshot(matchId);
  }
}

export type { Logical, CoreSide } from './sides-score.service';
export type { PlayerInfo } from './rosters.service';
export type { PlayerCombatStats } from './player-stats.service';
export type { TeamEconomyMeta } from './economy.service';
