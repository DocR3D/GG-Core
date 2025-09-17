import { Injectable } from '@nestjs/common';
import {
  SidesScoreService,
  type GameSide,
  type Logical,
  type Phase,
  type CoreSide,
} from './sides-score.service';
import { TimeoutsService } from './timeouts.service';
import { TeamsRosterService, type PlayerInfo } from './teams-roster.service';
import { EconomyService, type TeamEconomyMeta } from './economy.service';
import { SnapshotQuery } from './snapshot.query';
@Injectable()
export class MatchStateService {
  constructor(
    private readonly sidesScore: SidesScoreService,
    private readonly timeouts: TimeoutsService,
    private readonly teamsRoster: TeamsRosterService,
    private readonly economy: EconomyService,
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
    if(side == 'TERRORIST') side = "T";
    return this.sidesScore.sideToLogical(matchId, side);
  }

  logicalToSide(matchId: string, logical: Logical) {
    return this.sidesScore.logicalToSide(matchId, logical);
  }
  applyKnifeResult(matchId: string, winnerSide: 'CT' | 'T'){
    return this.sidesScore.applyKnifeResult(matchId, winnerSide);
  }
  getKnifeResult(matchId: string) :Promise<{
      side: GameSide | null;
      logical: Logical | null;
      team: { id: string | null; name: string | null } | null;
    }>{
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
    if(winner == 'TERRORIST') winner = "T";
    return this.sidesScore.addPoint(matchId, winner);
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

  upsertPlayer(matchId: string, p: PlayerInfo) {
    return this.teamsRoster.upsertPlayer(matchId, p);
  }
  movePlayerLogical(matchId: string, steamId: string, logical: Logical) {
    return this.teamsRoster.movePlayerLogical(matchId, steamId, logical);
  }
  removePlayer(matchId: string, steamId: string) {
    return this.teamsRoster.removePlayer(matchId, steamId);
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
  // Économie équipes + roundEnd
  // ───────────────────────────────────────────────────────────────────────────
  initEconomy(matchId: string) {
    return this.economy.initEconomy(matchId);
  }
  getTeamEconomyMeta(matchId: string): Promise<TeamEconomyMeta> {
    return this.economy.getTeamEconomyMeta(matchId);
  }
  setTeamLossStreak(matchId: string, logical: Logical, streak: number) {
    return this.economy.setTeamLossStreak(matchId, logical, streak);
  }
  updateEconomyOnRoundEnd(matchId: string, winnerSide: GameSide) {
    if(winnerSide == 'TERRORIST') winnerSide = "T";
    return this.economy.updateEconomyOnRoundEnd(matchId, winnerSide);
  }
  roundEnd(
    matchId: string,
    winnerSide: GameSide,
    playerEconomy?: { steamId: string; money: number; equip: number }[],
  ) {
    if(winnerSide == 'TERRORIST') winnerSide = "T";
    this.economy.updateEconomyOnRoundEnd(matchId,winnerSide);
    return this.economy.roundEnd(matchId, winnerSide, playerEconomy);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Snapshot (read-only)
  // ───────────────────────────────────────────────────────────────────────────
  getSnapshot(matchId: string) {
    return this.snapshotQ.getSnapshot(matchId);
  }
}

// Re-export des types pour compatibilité avec l’ancien import depuis ce fichier
export type { GameSide, Logical, Phase, CoreSide } from './sides-score.service';
export type { PlayerInfo } from './teams-roster.service';
export type { TeamEconomyMeta } from './economy.service';
