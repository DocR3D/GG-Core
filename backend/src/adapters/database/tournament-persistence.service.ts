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
/** Wins needed to take a series, per format. */
const WINS_NEEDED: Record<'BO1' | 'BO3' | 'BO5', number> = { BO1: 1, BO3: 2, BO5: 3 };

/**
 * Elimination (bracket) matches and placement matches need a winner: no draw. Group matches and "fun"
 * bonus matches may end on a draw.
 */
function needsWinner(match: {
  bracketType: string;
  placement: number | null;
  stageId: string | null;
  nextMatchId: string | null;
  loserNextMatchId: string | null;
}): boolean {
  if (match.placement != null) return true;
  // bracketType defaults to UPPER on every match: a bracket match is one of a stage, or one that feeds another
  const inBracket = !!(match.stageId || match.nextMatchId || match.loserNextMatchId);
  return inBracket && ['UPPER', 'LOWER', 'FINAL'].includes(match.bracketType);
}

/** Column of the next match receiving a team: the wired slot, or the first free one (legacy brackets). */
function slotField(slot: 'HOME' | 'AWAY' | null, homeTaken: string | null): 'teamHomeId' | 'teamAwayId' {
  if (slot) return slot === 'HOME' ? 'teamHomeId' : 'teamAwayId';
  return homeTaken ? 'teamAwayId' : 'teamHomeId';
}

/** Refusal of a manual result entry, mapped to an HTTP status by the controller. */
export class ManualResultError extends Error {
  constructor(readonly code: 'not_found' | 'finished' | 'teams_missing' | 'invalid', message: string) {
    super(message);
  }
}

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
      select: {
        id: true,
        matchId: true,
        match: { select: { format: true, bracketType: true, placement: true, stageId: true, nextMatchId: true, loserNextMatchId: true } },
      },
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
    // A match that needs a winner cannot end on a draw: an automatic draw (e.g. overtime disabled on the server)
    // is recorded DISPUTED - it does not advance the bracket and the admin sees it - instead of blocking silently.
    const disputedDraw = !isUuid(input.winnerTeamId) && needsWinner(matchMap.match);
    if (disputedDraw) {
      this.logger.warn(`[recordGameResult] draw ${input.scoreHome}-${input.scoreAway} on game ${matchMap.id} of a match that needs a winner: DISPUTED`);
    }
    return this.prisma.matchMap.update({
      where: { id: matchMap.id },
      data: {
        scoreHome: input.scoreHome,
        scoreAway: input.scoreAway,
        winnerId: isUuid(input.winnerTeamId) ? input.winnerTeamId : null,
        status: 'FINISHED',
        endedAt: new Date(),
        resultSource: input.source,
        resultStatus: disputedDraw ? 'DISPUTED' : input.status,
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
      const slot = slotField(match.nextMatchSlot, match.nextMatch.teamHomeId);
      await this.prisma.match.update({
        where: { id: match.nextMatchId },
        data: {
          [slot]: winnerTeamId,
        },
      });
    }

    // 3. Advance loser to lower bracket match if double elimination
    if (match.loserNextMatchId && match.loserNextMatch && loserTeamId) {
      const slot = slotField(match.loserNextMatchSlot, match.loserNextMatch.teamHomeId);
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
   * Recompute a series (Match) from its CONFIRMED games (+ starting advantage): series score, a draw when every
   * game was played without a winner (where draws are allowed), then - once a team reached the wins
   * needed by the format (BO1: 1, BO3: 2, BO5: 3) - finish it and advance the bracket. Same path for every
   * game, automatic (CS2) or manual (admin). A finished series is never re-advanced.
   */
  async updateSeries(matchId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId }, include: { maps: true } });
    if (!match) return null;

    const confirmed = match.maps.filter((m) => m.resultStatus === 'CONFIRMED' && m.winnerId);
    // Starting advantage counts as games already won (grand final: one map up for the upper-bracket finalist)
    const scoreHome = match.advantageHome + confirmed.filter((m) => m.winnerId === match.teamHomeId).length;
    const scoreAway = match.advantageAway + confirmed.filter((m) => m.winnerId === match.teamAwayId).length;
    const needed = WINS_NEEDED[match.format];
    const winnerId =
      scoreHome >= needed ? match.teamHomeId : scoreAway >= needed ? match.teamAwayId : null;

    // Every game of the series played without a winner (e.g. a BO1 group match ending 12-12): the series is a
    // draw - only where a draw is allowed; a bracket / placement match never ends on a draw.
    const gamesPlayed = match.maps.filter((m) => m.resultStatus === 'CONFIRMED').length;
    const isDraw = !winnerId && gamesPlayed >= needed * 2 - 1 && !needsWinner(match);

    await this.prisma.match.update({
      where: { id: matchId },
      data: {
        scoreHome,
        scoreAway,
        ...(isDraw && match.status !== 'FINISHED'
          ? { status: 'FINISHED' as const, winnerId: null }
          : match.status === 'PENDING'
            ? { status: 'LIVE' as const }
            : {}),
      },
    });
    // Series decided before its last games (BO3 won 2-0): the games planned by the veto will not be played
    if (winnerId || isDraw) {
      await this.prisma.matchMap.updateMany({ where: { matchId, status: 'PENDING', resultStatus: null }, data: { status: 'CANCELLED' } });
    }
    if (winnerId && match.status !== 'FINISHED') {
      await this.advanceBracketMatch(matchId, winnerId);
    }
    return { scoreHome, scoreAway, winnerId };
  }

  /**
   * Admin entry of a game result (games that are not automated, or to override a missing one):
   * creates / updates game n° mapOrder of the series, MANUAL / CONFIRMED, then updates the series.
   * Refused once the series is finished (correcting a finished series would need a bracket rollback).
   */
  async recordManualGameResult(input: {
    matchId: string;
    mapOrder: number;
    scoreHome: number;
    scoreAway: number;
    mapName?: string;
    reportedBy: string;
  }) {
    if (!isUuid(input.matchId)) throw new ManualResultError('not_found', `match ${input.matchId} not found`);
    const match = await this.prisma.match.findUnique({ where: { id: input.matchId } });
    if (!match) throw new ManualResultError('not_found', `match ${input.matchId} not found`);
    if (match.status === 'FINISHED') throw new ManualResultError('finished', 'series already finished');
    if (!match.teamHomeId || !match.teamAwayId) throw new ManualResultError('teams_missing', 'both teams must be known');
    const maxGames = WINS_NEEDED[match.format] * 2 - 1;
    if (!Number.isInteger(input.mapOrder) || input.mapOrder < 1 || input.mapOrder > maxGames) {
      throw new ManualResultError('invalid', `game number must be between 1 and ${maxGames} for a ${match.format}`);
    }
    if (![input.scoreHome, input.scoreAway].every((s) => Number.isInteger(s) && s >= 0)) {
      throw new ManualResultError('invalid', 'scores must be non-negative integers');
    }

    const winnerId =
      input.scoreHome > input.scoreAway ? match.teamHomeId : input.scoreAway > input.scoreHome ? match.teamAwayId : null;
    if (!winnerId && needsWinner(match)) {
      throw new ManualResultError('invalid', 'a bracket or placement match must have a winner: no draw');
    }
    const result = {
      scoreHome: input.scoreHome,
      scoreAway: input.scoreAway,
      winnerId,
      status: 'FINISHED' as const,
      endedAt: new Date(),
      resultSource: 'MANUAL' as const,
      resultStatus: 'CONFIRMED' as const,
      reportedBy: input.reportedBy,
      reportedAt: new Date(),
    };
    const game = await this.prisma.matchMap.upsert({
      where: { matchId_mapOrder: { matchId: match.id, mapOrder: input.mapOrder } },
      create: { matchId: match.id, mapOrder: input.mapOrder, mapName: input.mapName ?? '-', ...result },
      update: { ...(input.mapName ? { mapName: input.mapName } : {}), ...result },
    });
    const series = await this.updateSeries(match.id);
    return { game, series };
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
