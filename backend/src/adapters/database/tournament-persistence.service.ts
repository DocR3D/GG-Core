import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { VetoAction, TeamSide, ResultSource, ResultStatus } from '@prisma/client';

export interface ResolvePlayerInput {
  steamId?: string | null;
  username: string;
  seatNumber?: string | null;
}

export interface RecordKillInput {
  matchMapId: string;
  playerId: string;
  teamId: string;
  isHeadshot: boolean;
  damageDealt?: number;
}

export interface VetoStepInput {
  matchId: string;
  stepOrder: number;
  teamId?: string | null;
  action: VetoAction;
  mapName: string;
  sidePick?: TeamSide | null;
}

export interface EventRef {
  /** Identifiant de match côté moteur temps réel (clé Redis) */
  matchId?: string | null;
  serverId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Les colonnes relationnelles (MatchMap, Match, Team…) sont des UUID PostgreSQL. */
export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

@Injectable()
export class TournamentPersistenceService {
  private readonly logger = new Logger(TournamentPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a player identity:
   * - If steamId is present, finds by steamId or creates new player.
   * - If steamId is null/empty (LAN offline mode without Steam), falls back to username/seat.
   */
  async resolvePlayer(input: ResolvePlayerInput) {
    const cleanSteamId = input.steamId?.trim() || null;

    if (cleanSteamId) {
      return this.prisma.player.upsert({
        where: { steamId: cleanSteamId },
        update: {
          username: input.username,
          ...(input.seatNumber !== undefined ? { seatNumber: input.seatNumber } : {}),
        },
        create: {
          steamId: cleanSteamId,
          username: input.username,
          seatNumber: input.seatNumber ?? null,
        },
      });
    }

    // Offline LAN fallback: Find player with null steamId and matching username
    const existing = await this.prisma.player.findFirst({
      where: {
        steamId: null,
        username: input.username,
      },
    });

    if (existing) {
      if (input.seatNumber && existing.seatNumber !== input.seatNumber) {
        return this.prisma.player.update({
          where: { id: existing.id },
          data: { seatNumber: input.seatNumber },
        });
      }
      return existing;
    }

    return this.prisma.player.create({
      data: {
        steamId: null,
        username: input.username,
        seatNumber: input.seatNumber ?? null,
      },
    });
  }

  /**
   * Records a kill in map statistics (increments kills, headshots, damage).
   */
  async recordPlayerKill(input: RecordKillInput) {
    const damage = input.damageDealt ?? 100;

    return this.prisma.playerMapStats.upsert({
      where: {
        matchMapId_playerId: {
          matchMapId: input.matchMapId,
          playerId: input.playerId,
        },
      },
      update: {
        kills: { increment: 1 },
        ...(input.isHeadshot ? { headshots: { increment: 1 } } : {}),
        damageDealt: { increment: damage },
      },
      create: {
        matchMapId: input.matchMapId,
        playerId: input.playerId,
        teamId: input.teamId,
        kills: 1,
        headshots: input.isHeadshot ? 1 : 0,
        damageDealt: damage,
      },
    });
  }

  /**
   * Appends an event to the Event Sourcing table (EventPrimary).
   */
  async recordEventLog(
    matchMapId: string | null,
    type: string,
    payload: any,
    timestamp: number = Date.now(),
    ref: EventRef = {},
  ) {
    return this.prisma.eventPrimary.create({
      data: {
        matchMapId: isUuid(matchMapId) ? matchMapId : null,
        matchId: ref.matchId ?? null,
        serverId: ref.serverId ?? null,
        timestamp: BigInt(timestamp),
        type,
        payload: payload ?? {},
      },
    });
  }

  /**
   * Retourne le MatchMap correspondant à un UUID, ou null (identifiant non-UUID ou inconnu en base).
   */
  async findMatchMap(matchMapId: string | null | undefined) {
    if (!isUuid(matchMapId)) return null;
    return this.prisma.matchMap.findUnique({
      where: { id: matchMapId },
      select: { id: true, matchId: true, match: { select: { format: true } } },
    });
  }

  /**
   * Enregistre le résultat générique d'un game (MatchMap) : score home/away, vainqueur (null = nul), source,
   * statut et auteur. Sans effet si le game n'existe pas en base (match non rattaché au modèle relationnel).
   */
  async recordGameResult(input: {
    matchMapId: string | null | undefined;
    scoreHome: number;
    scoreAway: number;
    winnerTeamId: string | null;
    source: ResultSource;
    status: ResultStatus;
    reportedBy: string;
  }) {
    const matchMap = await this.findMatchMap(input.matchMapId);
    if (!matchMap) return null;
    return this.prisma.matchMap.update({
      where: { id: matchMap.id },
      data: {
        scoreHome: input.scoreHome,
        scoreAway: input.scoreAway,
        winnerId: isUuid(input.winnerTeamId) ? input.winnerTeamId : null,
        status: 'FINISHED',
        endedAt: new Date(),
        resultSource: input.source,
        resultStatus: input.status,
        reportedBy: input.reportedBy,
        reportedAt: new Date(),
      },
    });
  }

  /**
   * Résout le Match relationnel dont il faut faire avancer le bracket en fin de map :
   * - map rattachée (MatchMap) d'un match BO1 → ce match ;
   * - map d'une série BO3/BO5 → null (le vainqueur de la série n'est pas connu à la fin d'une map) ;
   * - sinon, identifiant temps réel qui est directement l'UUID d'un Match existant.
   */
  async resolveBracketMatchId(matchId: string, linkedMatchMapId?: string | null): Promise<string | null> {
    const matchMap = await this.findMatchMap(linkedMatchMapId ?? matchId);
    if (matchMap) {
      if (matchMap.match.format === 'BO1') return matchMap.matchId;
      this.logger.log(
        `[resolveBracketMatchId] map ${matchMap.id} belongs to a ${matchMap.match.format} series: bracket progression skipped`,
      );
      return null;
    }
    if (!isUuid(matchId)) return null;
    const match = await this.prisma.match.findUnique({ where: { id: matchId }, select: { id: true } });
    return match?.id ?? null;
  }

  /**
   * Calculates the total headshots scored in an entire LAN / tournament.
   */
  async getTournamentHeadshots(tournamentId: string): Promise<number> {
    const aggregate = await this.prisma.playerMapStats.aggregate({
      where: {
        matchMap: {
          match: {
            tournamentId,
          },
        },
      },
      _sum: {
        headshots: true,
      },
    });

    return aggregate._sum.headshots ?? 0;
  }

  /**
   * Computes the tournament player leaderboard ranked by kills.
   */
  async getTournamentLeaderboard(tournamentId: string) {
    const stats = await this.prisma.playerMapStats.findMany({
      where: {
        matchMap: {
          match: {
            tournamentId,
          },
        },
      },
      include: {
        player: true,
      },
    });

    const playerAggregates = new Map<
      string,
      {
        playerId: string;
        username: string;
        steamId: string | null;
        kills: number;
        deaths: number;
        headshots: number;
        damageDealt: number;
      }
    >();

    for (const s of stats) {
      const current = playerAggregates.get(s.playerId) ?? {
        playerId: s.playerId,
        username: s.player.username,
        steamId: s.player.steamId,
        kills: 0,
        deaths: 0,
        headshots: 0,
        damageDealt: 0,
      };

      current.kills += s.kills;
      current.deaths += s.deaths;
      current.headshots += s.headshots;
      current.damageDealt += s.damageDealt;

      playerAggregates.set(s.playerId, current);
    }

    return Array.from(playerAggregates.values())
      .map((p) => ({
        ...p,
        kdRatio: p.deaths > 0 ? parseFloat((p.kills / p.deaths).toFixed(2)) : p.kills,
        headshotPercent:
          p.kills > 0 ? parseFloat(((p.headshots / p.kills) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.kills - a.kills);
  }

  /**
   * Advances bracket progression when a match concludes:
   * - Marks match as FINISHED with winnerId.
   * - Slots winner into nextMatch (Upper bracket / Grand Final).
   * - Slots loser into loserNextMatch (Lower bracket for double elimination).
   */
  async advanceBracketMatch(matchId: string, winnerTeamId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        nextMatch: true,
        loserNextMatch: true,
      },
    });

    if (!match) {
      throw new Error(`Match ${matchId} not found`);
    }

    const loserTeamId =
      match.teamHomeId === winnerTeamId ? match.teamAwayId : match.teamHomeId;

    // 1. Conclude current match
    const updatedMatch = await this.prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'FINISHED',
        winnerId: winnerTeamId,
      },
    });

    // 2. Advance winner to next match if configured
    if (match.nextMatchId && match.nextMatch) {
      const slot = match.nextMatch.teamHomeId ? 'teamAwayId' : 'teamHomeId';
      await this.prisma.match.update({
        where: { id: match.nextMatchId },
        data: {
          [slot]: winnerTeamId,
        },
      });
    }

    // 3. Advance loser to lower bracket match if double elimination
    if (match.loserNextMatchId && match.loserNextMatch && loserTeamId) {
      const slot = match.loserNextMatch.teamHomeId ? 'teamAwayId' : 'teamHomeId';
      await this.prisma.match.update({
        where: { id: match.loserNextMatchId },
        data: {
          [slot]: loserTeamId,
        },
      });
    }

    return {
      match: updatedMatch,
      nextMatchId: match.nextMatchId,
      loserNextMatchId: match.loserNextMatchId,
    };
  }

  /**
   * Records a veto step for a match.
   */
  async recordVetoStep(input: VetoStepInput) {
    return this.prisma.matchVeto.upsert({
      where: {
        matchId_stepOrder: {
          matchId: input.matchId,
          stepOrder: input.stepOrder,
        },
      },
      update: {
        teamId: input.teamId ?? null,
        action: input.action,
        mapName: input.mapName,
        sidePick: input.sidePick ?? null,
        status: 'COMPLETED',
      },
      create: {
        matchId: input.matchId,
        stepOrder: input.stepOrder,
        teamId: input.teamId ?? null,
        action: input.action,
        mapName: input.mapName,
        sidePick: input.sidePick ?? null,
        status: 'COMPLETED',
      },
    });
  }
}
