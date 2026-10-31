// src/application/tournament/tournament-admin.service.ts
import { Injectable } from '@nestjs/common';
import { MatchFormat } from '@prisma/client';
import { PrismaService } from '@adapters/database/prisma.service';
import { isUuid, TournamentPersistenceService, WINS_NEEDED } from '@adapters/database/tournament-persistence.service';
import { TournamentError } from './tournament-stages.service';
import { VetoService } from './veto.service';

const FORMATS: MatchFormat[] = ['BO1', 'BO3', 'BO5'];
/** Score of a map won by forfeit (decided with the user: 13-0, a CS2 MR12 win; counts in the group score difference). */
export const FORFEIT_ROUNDS = 13;


/**
 * Admin operations of the LAN day, for when reality does not follow the plan: a team does not show up (forfeit),
 * the tournament runs late (shorter formats on the fly), a team is replaced, extra matches are added (bonus: for
 * fun, or to settle a place such as 7th / 8th). A change that makes a match's veto obsolete erases it.
 */
@Injectable()
export class TournamentAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly persistence: TournamentPersistenceService,
    private readonly veto: VetoService,
  ) {}

  /**
   * Forfeit: `absentTeamId` does not play. The other team gets each map it still needs as a 13-0 win (games already
   * played keep their result; a map planned by the veto keeps its name), then the series ends and the bracket moves
   * on through the usual result path. Refused while a game is being played on a server (release the server first).
   * The forfeit games are reported by "forfait (<admin who declared it>)".
   */
  async forfeit(matchId: string, absentTeamId: string, declaredBy = 'admin') {
    const match = await this.load(matchId);
    if (match.status === 'FINISHED') throw new TournamentError('conflict', 'match already finished');
    if (!match.teamHomeId || !match.teamAwayId) throw new TournamentError('conflict', 'both teams must be known');
    if (absentTeamId !== match.teamHomeId && absentTeamId !== match.teamAwayId) {
      throw new TournamentError('invalid', 'absentTeamId: one of the two teams of the match');
    }
    if (match.maps.some((g) => g.status === 'LIVE' || g.status === 'WARMUP' || g.status === 'PAUSED')) {
      throw new TournamentError('conflict', 'a game of this match is being played: stop it first (release its server)');
    }
    const winnerId = absentTeamId === match.teamHomeId ? match.teamAwayId : match.teamHomeId;
    const homeWins = winnerId === match.teamHomeId;
    const won =
      (homeWins ? match.advantageHome : match.advantageAway) +
      match.maps.filter((g) => g.resultStatus === 'CONFIRMED' && g.winnerId === winnerId).length;
    const missing = Math.max(0, WINS_NEEDED[match.format] - won);

    // The maps it still needs: the planned ones first (veto order), then new games after the last one
    const planned = match.maps.filter((g) => g.status === 'PENDING' && !g.resultStatus).sort((a, b) => a.mapOrder - b.mapOrder);
    let nextOrder = Math.max(0, ...match.maps.map((g) => g.mapOrder)) + 1;
    const now = new Date();
    const writes = Array.from({ length: missing }, (_, i) => {
      const result = {
        scoreHome: homeWins ? FORFEIT_ROUNDS : 0,
        scoreAway: homeWins ? 0 : FORFEIT_ROUNDS,
        status: 'FINISHED' as const,
        winnerId,
        resultSource: 'MANUAL' as const,
        resultStatus: 'CONFIRMED' as const,
        reportedBy: `forfait (${declaredBy})`.slice(0, 64),
        reportedAt: now,
        endedAt: now,
      };
      const game = planned[i];
      return game
        ? this.prisma.matchMap.update({ where: { id: game.id }, data: result })
        : this.prisma.matchMap.create({ data: { matchId: match.id, mapOrder: nextOrder++, mapName: '-', ...result } });
    });
    await this.prisma.$transaction([...writes, this.prisma.match.update({ where: { id: match.id }, data: { isForfeit: true } })]);
    // usual result path: series score, FINISHED + winner, unplayed games cancelled, bracket
    await this.persistence.updateSeries(match.id);
    return this.summary(match.id);
  }

  /**
   * Format on the fly (the tournament runs late: the lower bracket in BO1...): the matches given by id, or every
   * match of a stage (optionally one bracket of it). Only matches not started change; a veto already begun is
   * erased (its maps no longer fit). A match with a map advantage (grand final) cannot become a BO1.
   */
  async setFormat(input: { matchIds?: string[]; stageId?: string; bracket?: 'UPPER' | 'LOWER' | 'FINAL'; format: MatchFormat }) {
    if (!FORMATS.includes(input.format)) throw new TournamentError('invalid', 'format: BO1 | BO3 | BO5');
    let matches;
    if (input.matchIds?.length) {
      const ids = input.matchIds.filter((id) => isUuid(id));
      matches = await this.prisma.match.findMany({ where: { id: { in: ids } }, include: { maps: true } });
      if (matches.length !== input.matchIds.length) throw new TournamentError('not_found', 'some matches were not found');
    } else if (input.stageId && isUuid(input.stageId)) {
      matches = await this.prisma.match.findMany({
        where: { stageId: input.stageId, ...(input.bracket ? { bracketType: input.bracket } : {}) },
        include: { maps: true },
        orderBy: [{ roundNumber: 'asc' }, { bracketPosition: 'asc' }],
      });
      if (!matches.length) throw new TournamentError('not_found', 'no match in this stage / bracket');
    } else {
      throw new TournamentError('invalid', 'matchIds: [...], or stageId (+ bracket: UPPER | LOWER | FINAL)');
    }

    const changed: string[] = [];
    const vetoReset: string[] = [];
    const skipped: { matchId: string; reason: string }[] = [];
    for (const m of matches) {
      const reason = this.notStartedReason(m);
      if (reason) skipped.push({ matchId: m.id, reason });
      else if (input.format === 'BO1' && (m.advantageHome > 0 || m.advantageAway > 0)) {
        skipped.push({ matchId: m.id, reason: 'map advantage (grand final): BO3 or BO5 only' });
      } else if (m.format === input.format) {
        skipped.push({ matchId: m.id, reason: `already ${input.format}` });
      } else {
        if (await this.veto.clear(m.id)) vetoReset.push(m.id);
        await this.prisma.match.update({ where: { id: m.id }, data: { format: input.format } });
        changed.push(m.id);
      }
    }
    return { format: input.format, changed, vetoReset, skipped };
  }

  /** Replaces a team in a match not started (e.g. by a substitute team); the veto begun with the old one is erased. */
  async replaceTeam(matchId: string, teamId: string, newTeamId: string) {
    const match = await this.load(matchId);
    const reason = this.notStartedReason(match);
    if (reason) throw new TournamentError('conflict', reason);
    if (teamId !== match.teamHomeId && teamId !== match.teamAwayId) throw new TournamentError('invalid', 'teamId: a team of this match');
    if (newTeamId === match.teamHomeId || newTeamId === match.teamAwayId) throw new TournamentError('invalid', 'newTeamId already plays this match');
    if (!isUuid(newTeamId) || !(await this.prisma.team.findUnique({ where: { id: newTeamId } }))) {
      throw new TournamentError('not_found', 'new team not found');
    }
    const vetoReset = await this.veto.clear(match.id);
    await this.prisma.match.update({
      where: { id: match.id },
      data: teamId === match.teamHomeId ? { teamHomeId: newTeamId } : { teamAwayId: newTeamId },
    });
    return { ...(await this.summary(match.id)), vetoReset };
  }

  /**
   * Bonus match between two teams of the tournament, outside the bracket: for fun (a draw allowed, out of the
   * official stats by default) or to settle a place (`placement`: 7 = for 7th / 8th; a winner is required, it
   * counts in the stats by default, and its result settles the final ranking of the teams sharing that place).
   */
  async createBonusMatch(
    tournamentId: string,
    input: { homeTeamId: string; awayTeamId: string; format?: MatchFormat; placement?: number; countsInStats?: boolean },
  ) {
    if (!isUuid(tournamentId) || !(await this.prisma.tournament.findUnique({ where: { id: tournamentId } }))) {
      throw new TournamentError('not_found', 'tournament not found');
    }
    const format = input.format ?? 'BO1';
    if (!FORMATS.includes(format)) throw new TournamentError('invalid', 'format: BO1 | BO3 | BO5');
    if (!input.homeTeamId || input.homeTeamId === input.awayTeamId) throw new TournamentError('invalid', 'two different teams: homeTeamId, awayTeamId');
    if (input.placement != null && (!Number.isInteger(input.placement) || input.placement < 1)) {
      throw new TournamentError('invalid', 'placement: the place played for (e.g. 7 for 7th / 8th)');
    }
    for (const teamId of [input.homeTeamId, input.awayTeamId]) {
      if (!(await this.inTournament(tournamentId, teamId))) throw new TournamentError('invalid', `team ${teamId} does not play this tournament`);
    }
    const placement = input.placement ?? null;
    return this.prisma.match.create({
      data: {
        tournamentId,
        teamHomeId: input.homeTeamId,
        teamAwayId: input.awayTeamId,
        format,
        stage: 'SHOWMATCH',
        placement,
        countsInStats: input.countsInStats ?? placement != null,
      },
    });
  }

  /** Removes a bonus match not started (a bracket / group match is never removed this way). */
  async deleteBonusMatch(matchId: string) {
    const match = await this.load(matchId);
    if (match.stageId) throw new TournamentError('conflict', 'not a bonus match: bracket and group matches stay');
    const reason = this.notStartedReason(match);
    if (reason) throw new TournamentError('conflict', reason);
    await this.prisma.match.delete({ where: { id: match.id } });
    return { deleted: match.id };
  }

  // --- Internals ------------------------------------------------------------------------------------------

  /** null when nothing of the match has been played yet (a veto may have happened). */
  private notStartedReason(m: { status: string; maps: { status: string; resultStatus: string | null; serverId: string | null }[] }): string | null {
    if (m.status === 'FINISHED') return 'match already finished';
    if (m.maps.some((g) => g.status !== 'PENDING' || g.resultStatus || g.serverId)) return 'a game of this match has already started';
    return null;
  }

  private async inTournament(tournamentId: string, teamId: string): Promise<boolean> {
    if (!isUuid(teamId)) return false;
    const [entry, roster, played] = await Promise.all([
      this.prisma.stageTeam.findFirst({ where: { teamId, stage: { tournamentId } } }),
      this.prisma.teamRoster.findFirst({ where: { teamId, tournamentId } }),
      this.prisma.match.findFirst({ where: { tournamentId, OR: [{ teamHomeId: teamId }, { teamAwayId: teamId }] } }),
    ]);
    return !!(entry || roster || played);
  }

  private async load(matchId: string) {
    const match = isUuid(matchId) ? await this.prisma.match.findUnique({ where: { id: matchId }, include: { maps: true } }) : null;
    if (!match) throw new TournamentError('not_found', 'match not found');
    return match;
  }

  private async summary(matchId: string) {
    const m = await this.prisma.match.findUniqueOrThrow({ where: { id: matchId }, include: { maps: { orderBy: { mapOrder: 'asc' } } } });
    return {
      matchId: m.id,
      status: m.status,
      format: m.format,
      teamHomeId: m.teamHomeId,
      teamAwayId: m.teamAwayId,
      scoreHome: m.scoreHome,
      scoreAway: m.scoreAway,
      winnerId: m.winnerId,
      isForfeit: m.isForfeit,
      games: m.maps.map((g) => ({ order: g.mapOrder, map: g.mapName, status: g.status })),
    };
  }
}
