// src/application/tournament/tournament-stages.service.ts
import { Injectable } from '@nestjs/common';
import { MatchFormat, StageType } from '@prisma/client';
import { PrismaService } from '@adapters/database/prisma.service';
import { computeStandings, FinishedSeries, roundRobinPairings, snakeDistribute, StandingRow } from '@domain/tournament/round-robin';
import { buildDoubleElimination, doubleElimPlacements, SlotSource } from '@domain/tournament/double-elimination';
import { randomUUID } from 'crypto';
import type { MatchDetailView, TournamentView, ViewMatch, ViewStage } from './tournament-view';

export interface DoubleElimFormats {
  upper?: MatchFormat;
  lower?: MatchFormat;
  /** must be BO3 or BO5: the upper-bracket finalist starts one map up */
  grandFinal?: MatchFormat;
}

/** Refusal mapped to an HTTP status by the controller. */
export class TournamentError extends Error {
  constructor(readonly code: 'not_found' | 'conflict' | 'invalid', message: string) {
    super(message);
  }
}

export interface QualificationRule {
  /** Group ranks sent to the target stage, e.g. [1, 2] */
  ranks: number[];
  targetStageId: string;
}

const GROUP_NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FORMATS: MatchFormat[] = ['BO1', 'BO3', 'BO5'];

/**
 * Tournament structure: tournaments, teams, stages, group stage (generation, standings, qualification).
 * Game-agnostic (docs/architecture-multi-jeux.md): only teams, series and generic game scores.
 */
@Injectable()
export class TournamentStagesService {
  constructor(private readonly prisma: PrismaService) {}

  createTournament(input: { name: string; slug?: string; game?: string }) {
    const name = input.name?.trim();
    if (!name) throw new TournamentError('invalid', 'name is required');
    const slug = (input.slug?.trim() || name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64);
    return this.prisma.tournament.create({ data: { name, slug, game: input.game?.trim() || 'cs2' } });
  }

  /** Creates teams by name (before the import from the registration site exists). */
  async createTeams(names: string[]) {
    const clean = (names ?? []).map((n) => n?.trim()).filter(Boolean) as string[];
    if (!clean.length) throw new TournamentError('invalid', 'at least one team name is required');
    return this.prisma.$transaction(clean.map((name) => this.prisma.team.create({ data: { name } })));
  }

  async createStage(tournamentId: string, input: { name: string; type: StageType; order: number; settings?: object }) {
    await this.mustFind('tournament', () => this.prisma.tournament.findUnique({ where: { id: tournamentId } }));
    if (!input.name?.trim()) throw new TournamentError('invalid', 'name is required');
    if (!['ROUND_ROBIN', 'DOUBLE_ELIM'].includes(input.type)) throw new TournamentError('invalid', 'type: ROUND_ROBIN | DOUBLE_ELIM');
    if (!Number.isInteger(input.order)) throw new TournamentError('invalid', 'order must be an integer');
    const taken = await this.prisma.stage.findFirst({ where: { tournamentId, order: input.order } });
    if (taken) throw new TournamentError('conflict', `a stage already has order ${input.order}`);
    return this.prisma.stage.create({
      data: { tournamentId, name: input.name.trim(), type: input.type, order: input.order, settings: input.settings ?? {} },
    });
  }

  /**
   * Group stage generation: seeded teams (body, or the stage participants set by a qualification) are spread in
   * `groupCount` groups (snake), then every group gets its round-robin matches. Regenerating is allowed as long as
   * no match of the stage is finished.
   */
  async generateGroups(stageId: string, input: { teamIds?: string[]; groupCount: number; format?: MatchFormat }) {
    const stage = await this.mustFind('stage', () =>
      this.prisma.stage.findUnique({ where: { id: stageId }, include: { teams: { orderBy: { seed: 'asc' } } } }),
    );
    if (stage.type !== 'ROUND_ROBIN') throw new TournamentError('invalid', 'not a ROUND_ROBIN stage');
    const format = input.format ?? 'BO1';
    if (!FORMATS.includes(format)) throw new TournamentError('invalid', 'format: BO1 | BO3 | BO5');
    const teamIds = input.teamIds?.length ? input.teamIds : stage.teams.map((t) => t.teamId);
    if (new Set(teamIds).size !== teamIds.length) throw new TournamentError('invalid', 'duplicate team');
    const groupCount = Number(input.groupCount);
    if (!Number.isInteger(groupCount) || groupCount < 1 || teamIds.length < groupCount * 2) {
      throw new TournamentError('invalid', 'groupCount must leave at least 2 teams per group');
    }
    if (groupCount > GROUP_NAMES.length) throw new TournamentError('invalid', `at most ${GROUP_NAMES.length} groups`);
    const known = await this.prisma.team.count({ where: { id: { in: teamIds } } });
    if (known !== teamIds.length) throw new TournamentError('not_found', 'unknown team id');
    const played = await this.prisma.match.count({ where: { stageId, status: 'FINISHED' } });
    if (played) throw new TournamentError('conflict', 'stage already has finished matches: groups cannot be regenerated');

    const groups = snakeDistribute(teamIds, groupCount);
    await this.prisma.$transaction(async (tx) => {
      await tx.match.deleteMany({ where: { stageId } });
      await tx.stageTeam.deleteMany({ where: { stageId } });
      await tx.stageGroup.deleteMany({ where: { stageId } });
      for (const [g, groupTeams] of groups.entries()) {
        const group = await tx.stageGroup.create({ data: { stageId, name: GROUP_NAMES[g] } });
        await tx.stageTeam.createMany({
          data: groupTeams.map((teamId) => ({ stageId, teamId, groupId: group.id, seed: teamIds.indexOf(teamId) + 1 })),
        });
        await tx.match.createMany({
          data: roundRobinPairings(groupTeams).map((p, i) => ({
            tournamentId: stage.tournamentId,
            stageId,
            groupId: group.id,
            stage: 'GROUP' as const,
            bracketType: 'ROUND_ROBIN' as const,
            roundNumber: p.round,
            bracketPosition: i + 1,
            format,
            teamHomeId: p.home,
            teamAwayId: p.away,
          })),
        });
      }
      await tx.stage.update({ where: { id: stageId }, data: { settings: { ...(stage.settings as object), groupCount, format } } });
    });
    return this.getStandings(stageId);
  }

  /** Standings of every group (finished series only; ties left unresolved are flagged `tied`). */
  async getStandings(stageId: string) {
    const stage = await this.mustFind('stage', () =>
      this.prisma.stage.findUnique({
        where: { id: stageId },
        include: {
          groups: {
            orderBy: { name: 'asc' },
            include: {
              teams: { orderBy: { seed: 'asc' }, include: { team: { select: { id: true, name: true } } } },
              matches: { include: { maps: true } },
            },
          },
        },
      }),
    );
    return {
      stageId: stage.id,
      name: stage.name,
      groups: stage.groups.map((g) => {
        const finished = g.matches.filter((m) => m.status === 'FINISHED' && m.teamHomeId && m.teamAwayId);
        const results: FinishedSeries<string>[] = finished.map((m) => ({
          home: m.teamHomeId!,
          away: m.teamAwayId!,
          winner: m.winnerId,
          games: m.maps
            .filter((x) => x.resultStatus === 'CONFIRMED')
            .map((x) => ({ home: x.scoreHome, away: x.scoreAway })),
        }));
        const names = new Map(g.teams.map((t) => [t.teamId, t.team.name]));
        const standings = computeStandings(g.teams.map((t) => t.teamId), results);
        return {
          groupId: g.id,
          name: g.name,
          matchesPlayed: finished.length,
          matchesTotal: g.matches.length,
          standings: standings.map((r) => ({ ...r, teamName: names.get(r.teamId) })),
        };
      }),
    };
  }

  /**
   * Sends teams to the next stages by group rank (e.g. ranks 1-2 → Elite, 3-4 → Amateur). Target seeds are
   * crossed: all 1st places (group A, B, …), then all 2nd places, and so on. Requires every group match to be
   * finished, and refuses when an unresolved tie straddles a qualification boundary unless the admin gives the
   * order of that group (`manualOrder: { [groupId]: teamId[] }`).
   */
  async qualify(stageId: string, input: { rules: QualificationRule[]; manualOrder?: Record<string, string[]> }) {
    const rules = input.rules ?? [];
    if (!rules.length) throw new TournamentError('invalid', 'at least one rule');
    const standings = await this.getStandings(stageId);
    const pending = standings.groups.filter((g) => g.matchesPlayed < g.matchesTotal);
    if (pending.length) {
      throw new TournamentError('conflict', `groups not finished: ${pending.map((g) => g.name).join(', ')}`);
    }

    const orderOf = (g: (typeof standings.groups)[number]) => {
      const manual = input.manualOrder?.[g.groupId];
      if (manual) {
        const ids = g.standings.map((r) => r.teamId);
        if (manual.length !== ids.length || !ids.every((id) => manual.includes(id))) {
          throw new TournamentError('invalid', `manualOrder of group ${g.name} must list exactly its teams`);
        }
        return manual;
      }
      // An unresolved tie is only a problem if the tied teams end up in different targets
      const targetOf = (rank: number) => rules.findIndex((r) => r.ranks.includes(rank));
      g.standings.forEach((row, i) => {
        const next = g.standings[i + 1];
        if (row.tied && next?.tied && targetOf(row.rank) !== targetOf(next.rank)) {
          throw new TournamentError(
            'conflict',
            `unresolved tie in group ${g.name} between ${row.teamName} and ${next.teamName}: give manualOrder`,
          );
        }
      });
      return g.standings.map((r) => r.teamId);
    };
    const orders = standings.groups.map(orderOf);

    const stage = await this.prisma.stage.findUniqueOrThrow({ where: { id: stageId } });
    const targets: { target: { id: string; name: string }; teamIds: string[] }[] = [];
    for (const rule of rules) {
      const target = await this.mustFind('target stage', () => this.prisma.stage.findUnique({ where: { id: rule.targetStageId } }));
      if (target.tournamentId !== stage.tournamentId || target.order <= stage.order) {
        throw new TournamentError('invalid', `target stage ${target.name} must be a later stage of the same tournament`);
      }
      if (await this.prisma.match.count({ where: { stageId: target.id } })) {
        throw new TournamentError('conflict', `target stage ${target.name} already has matches`);
      }
      const ranks = [...rule.ranks].sort((a, b) => a - b);
      const teamIds = ranks.flatMap((rank) => orders.map((o) => o[rank - 1]).filter(Boolean));
      targets.push({ target, teamIds });
    }
    await this.prisma.$transaction(
      targets.flatMap(({ target, teamIds }) => [
        this.prisma.stageTeam.deleteMany({ where: { stageId: target.id } }),
        this.prisma.stageTeam.createMany({
          data: teamIds.map((teamId, i) => ({ stageId: target.id, teamId, seed: i + 1 })),
        }),
      ]),
    );
    return targets.map(({ target, teamIds }) => ({ stageId: target.id, name: target.name, seeds: teamIds }));
  }

  /**
   * Double-elimination bracket of a stage, for its participants in seed order (set by a qualification, or given).
   * Byes are resolved at generation (see buildDoubleElimination); every match knows the exact slot of its winner
   * and loser; the grand final gives the upper-bracket finalist a one-map advantage. Regenerating is allowed as
   * long as no match of the stage is finished.
   */
  async generateDoubleElimination(stageId: string, input: { teamIds?: string[]; formats?: DoubleElimFormats } = {}) {
    const stage = await this.mustFind('stage', () =>
      this.prisma.stage.findUnique({ where: { id: stageId }, include: { teams: { orderBy: { seed: 'asc' } } } }),
    );
    if (stage.type !== 'DOUBLE_ELIM') throw new TournamentError('invalid', 'not a DOUBLE_ELIM stage');
    const teamIds = input.teamIds?.length ? input.teamIds : stage.teams.map((t) => t.teamId);
    if (new Set(teamIds).size !== teamIds.length) throw new TournamentError('invalid', 'duplicate team');
    if (teamIds.length < 3) throw new TournamentError('invalid', 'double elimination needs at least 3 teams');
    const formats = { upper: 'BO1', lower: 'BO1', grandFinal: 'BO3', ...(input.formats ?? {}) } as Required<DoubleElimFormats>;
    for (const f of Object.values(formats)) if (!FORMATS.includes(f)) throw new TournamentError('invalid', 'format: BO1 | BO3 | BO5');
    if (formats.grandFinal === 'BO1') throw new TournamentError('invalid', 'grand final must be BO3 or BO5 (one-map advantage)');
    if ((await this.prisma.team.count({ where: { id: { in: teamIds } } })) !== teamIds.length) {
      throw new TournamentError('not_found', 'unknown team id');
    }
    if (await this.prisma.match.count({ where: { stageId, status: 'FINISHED' } })) {
      throw new TournamentError('conflict', 'stage already has finished matches: the bracket cannot be regenerated');
    }

    const bracket = buildDoubleElimination(teamIds.length);
    const ids = new Map(bracket.map((m) => [m.key, randomUUID()]));
    const team = (src: SlotSource) => (src.kind === 'seed' ? teamIds[src.seed - 1] : null);
    const formatOf = { UPPER: formats.upper, LOWER: formats.lower, FINAL: formats.grandFinal } as const;

    await this.prisma.$transaction(async (tx) => {
      await tx.match.deleteMany({ where: { stageId } });
      if (input.teamIds?.length) {
        // explicit seeds replace the participants (otherwise those set by the qualification are kept)
        await tx.stageTeam.deleteMany({ where: { stageId } });
        await tx.stageTeam.createMany({ data: teamIds.map((teamId, i) => ({ stageId, teamId, seed: i + 1 })) });
      }
      // One INSERT: the self references (next / loser-next match) are checked at the end of the statement
      await tx.match.createMany({
        data: bracket.map((m) => ({
          id: ids.get(m.key)!,
          tournamentId: stage.tournamentId,
          stageId,
          stage: 'PLAYOFFS' as const,
          bracketType: m.bracket,
          roundNumber: m.round,
          bracketPosition: m.position,
          format: formatOf[m.bracket],
          teamHomeId: team(m.home),
          teamAwayId: team(m.away),
          nextMatchId: m.winnerTo ? ids.get(m.winnerTo.match)! : null,
          nextMatchSlot: m.winnerTo?.slot ?? null,
          loserNextMatchId: m.loserTo ? ids.get(m.loserTo.match)! : null,
          loserNextMatchSlot: m.loserTo?.slot ?? null,
          advantageHome: m.bracket === 'FINAL' ? 1 : 0,
        })),
      });
      await tx.stage.update({ where: { id: stageId }, data: { settings: { ...(stage.settings as object), formats } } });
    });
    return { stageId, teams: teamIds.length, matches: bracket.length, formats };
  }

  /**
   * Deletes a tournament (stages, matches, games and their stats cascade) and the teams / players that no longer
   * take part in any tournament - those created for that tournament only.
   */
  async deleteTournament(tournamentId: string) {
    const tournament = await this.mustFind('tournament', () =>
      this.prisma.tournament.findUnique({
        where: { id: tournamentId },
        include: {
          stages: { include: { teams: { select: { teamId: true } } } },
          matches: { select: { teamHomeId: true, teamAwayId: true } },
          rosters: { select: { playerId: true } },
        },
      }),
    );
    const teamIds = [
      ...new Set([
        ...tournament.stages.flatMap((s) => s.teams.map((t) => t.teamId)),
        ...tournament.matches.flatMap((m) => [m.teamHomeId, m.teamAwayId]).filter((id): id is string => !!id),
      ]),
    ];
    return this.prisma.$transaction(async (tx) => {
      await tx.tournament.delete({ where: { id: tournament.id } });
      const orphans = await tx.team.findMany({
        where: {
          id: { in: teamIds },
          stageEntries: { none: {} },
          matchesHome: { none: {} },
          matchesAway: { none: {} },
          rosters: { none: {} },
        },
        select: { id: true },
      });
      await tx.team.deleteMany({ where: { id: { in: orphans.map((t) => t.id) } } });
      // players of this tournament only (e.g. fake players of a simulation): no roster nor stats left
      const players = await tx.player.deleteMany({
        where: {
          id: { in: tournament.rosters.map((r) => r.playerId) },
          rosters: { none: {} },
          mapStats: { none: {} },
        },
      });
      return { deleted: tournament.name, teamsDeleted: orphans.length, playersDeleted: players.count };
    });
  }

  /** Everything the match detail page shows: series, origin / destination in the bracket, games, player stats. */
  async getMatchDetail(matchId: string): Promise<MatchDetailView> {
    const include = { stageRef: true, group: true } as const;
    const m = await this.mustFind('match', () =>
      this.prisma.match.findUnique({
        where: { id: matchId },
        include: {
          ...include,
          tournament: { select: { id: true, name: true } },
          teamHome: true,
          teamAway: true,
          winner: true,
          nextMatch: { include },
          loserNextMatch: { include },
          previousMatchesWon: { include },
          previousMatchesLost: { include },
          maps: {
            orderBy: { mapOrder: 'asc' },
            include: { server: true, playerStats: { include: { player: true, team: true } } },
          },
        },
      }),
    );
    type Labelled = { id: string; bracketType: string; roundNumber: number; bracketPosition: number | null; stageId: string | null; group: { name: string } | null };
    const label = (x: Labelled) =>
      !x.stageId
        ? 'Match bonus'
        : x.bracketType === 'FINAL'
          ? 'GF'
          : x.bracketType === 'UPPER' || x.bracketType === 'LOWER'
            ? `${x.bracketType === 'LOWER' ? 'B' : 'H'} T${x.roundNumber}#${x.bracketPosition}`
            : `Poule ${x.group?.name ?? '?'} R${x.roundNumber}#${x.bracketPosition}`;
    const ref = (x: Labelled) => ({ id: x.id, label: label(x) });
    const section = { UPPER: 'Bracket du haut', LOWER: 'Bracket du bas', FINAL: 'Grande finale' } as Record<string, string>;
    const context = !m.stageRef
      ? 'Match bonus'
      : `${m.stageRef.name} - ${section[m.bracketType] ?? (m.group ? `Poule ${m.group.name}` : m.stageRef.type)}`;

    return {
      id: m.id,
      tournament: m.tournament,
      context,
      label: label(m),
      format: m.format,
      status: m.status,
      home: m.teamHome?.name ?? null,
      away: m.teamAway?.name ?? null,
      scoreHome: m.scoreHome,
      scoreAway: m.scoreAway,
      winner: m.winner?.name ?? null,
      isForfeit: m.isForfeit,
      advantageHome: m.advantageHome,
      countsInStats: m.countsInStats,
      placement: m.placement,
      from: [
        ...m.previousMatchesWon.map((p) => ({ slot: p.nextMatchSlot, what: 'Vainq.' as const, match: ref(p) })),
        ...m.previousMatchesLost.map((p) => ({ slot: p.loserNextMatchSlot, what: 'Perd.' as const, match: ref(p) })),
      ]
        .filter((f): f is typeof f & { slot: 'HOME' | 'AWAY' } => !!f.slot)
        .sort((a, b) => (a.slot === b.slot ? 0 : a.slot === 'HOME' ? -1 : 1)),
      next: [
        ...(m.nextMatch ? [{ what: 'vainqueur' as const, slot: m.nextMatchSlot, match: ref(m.nextMatch) }] : []),
        ...(m.loserNextMatch ? [{ what: 'perdant' as const, slot: m.loserNextMatchSlot, match: ref(m.loserNextMatch) }] : []),
      ],
      games: m.maps.map((g) => ({
        order: g.mapOrder,
        mapName: g.mapName,
        status: g.status,
        scoreHome: g.scoreHome,
        scoreAway: g.scoreAway,
        source: g.resultSource,
        resultStatus: g.resultStatus,
        reportedBy: g.reportedBy,
        reportedAt: g.reportedAt,
        server: g.server?.name ?? null,
        stats: g.playerStats.map((r) => ({
          team: r.team.name, player: r.player.username, kills: r.kills, deaths: r.deaths,
          assists: r.assists, headshots: r.headshots, adr: r.adr,
        })),
      })),
    };
  }

  listTournaments() {
    return this.prisma.tournament.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, game: true, status: true } });
  }

  /** Everything the ASCII view shows: stages, groups with standings, matches with their games / servers, bonus matches. */
  async getOverview(tournamentId: string): Promise<TournamentView> {
    const tournament = await this.mustFind('tournament', () =>
      this.prisma.tournament.findUnique({
        where: { id: tournamentId },
        include: {
          stages: {
            orderBy: { order: 'asc' },
            include: { teams: { orderBy: { seed: 'asc' }, include: { team: true } } },
          },
          matches: {
            include: {
              teamHome: true,
              teamAway: true,
              winner: true,
              maps: { orderBy: { mapOrder: 'asc' }, include: { server: true } },
            },
          },
        },
      }),
    );
    const toView = (m: (typeof tournament.matches)[number]): ViewMatch => ({
      id: m.id,
      round: m.roundNumber,
      position: m.bracketPosition,
      home: m.teamHome?.name ?? null,
      away: m.teamAway?.name ?? null,
      format: m.format,
      status: m.status,
      scoreHome: m.scoreHome,
      scoreAway: m.scoreAway,
      winner: m.winner?.name ?? null,
      isForfeit: m.isForfeit,
      countsInStats: m.countsInStats,
      placement: m.placement,
      bracket: m.bracketType,
      advantageHome: m.advantageHome,
      games: m.maps.map((g) => ({
        order: g.mapOrder,
        mapName: g.mapName,
        scoreHome: g.scoreHome,
        scoreAway: g.scoreAway,
        status: g.status,
        source: g.resultSource,
        server: g.server?.name ?? null,
        resultStatus: g.resultStatus,
      })),
    });

    const stages: ViewStage[] = [];
    for (const st of tournament.stages) {
      const standings = st.type === 'ROUND_ROBIN' ? await this.getStandings(st.id) : null;
      const stageMatches = tournament.matches.filter((m) => m.stageId === st.id);
      const views = new Map(stageMatches.map((m) => [m.id, toView(m)]));
      // Brackets: where each still-unknown team comes from (winner / loser of which match)
      const label = (m: (typeof stageMatches)[number]) =>
        m.bracketType === 'FINAL' ? 'GF' : `${m.bracketType === 'LOWER' ? 'B' : 'H'} T${m.roundNumber}#${m.bracketPosition}`;
      const byId = new Map(stageMatches.map((m) => [m.id, m]));
      for (const m of stageMatches) {
        const v = views.get(m.id)!;
        v.label = label(m);
        const next = m.nextMatchId ? byId.get(m.nextMatchId) : undefined;
        v.winnerTo = next && m.nextMatchSlot ? { label: label(next), slot: m.nextMatchSlot } : null;
        for (const [target, slot, what] of [
          [m.nextMatchId, m.nextMatchSlot, 'Vainq.'],
          [m.loserNextMatchId, m.loserNextMatchSlot, 'Perd.'],
        ] as const) {
          const v = target ? views.get(target) : undefined;
          if (v && slot) v[slot === 'HOME' ? 'homeFrom' : 'awayFrom'] = `${what} ${label(m)}`;
        }
      }
      const ranking =
        st.type === 'DOUBLE_ELIM'
          ? doubleElimPlacements(
              stageMatches
                .filter((m) => m.bracketType === 'UPPER' || m.bracketType === 'LOWER' || m.bracketType === 'FINAL')
                .map((m) => {
                  const loser = m.winnerId === m.teamHomeId ? m.teamAway : m.teamHome;
                  return {
                    bracket: m.bracketType as 'UPPER' | 'LOWER' | 'FINAL',
                    round: m.roundNumber,
                    finished: m.status === 'FINISHED' && !!m.winnerId,
                    winner: m.winner?.name ?? null,
                    loser: loser?.name ?? null,
                  };
                }),
            ).map((r) => ({ place: r.place, team: r.team as string }))
          : undefined;
      stages.push({
        ranking,
        name: st.name,
        type: st.type,
        order: st.order,
        groups: (standings?.groups ?? []).map((g) => ({
          name: g.name,
          standings: g.standings.map((r) => ({
            rank: r.rank, team: r.teamName ?? r.teamId, played: r.played, wins: r.wins, draws: r.draws,
            losses: r.losses, points: r.points, scoreDiff: r.scoreDiff, tied: r.tied,
          })),
          matches: stageMatches.filter((m) => m.groupId === g.groupId).map((m) => views.get(m.id)!),
        })),
        seeds: st.teams.filter((t) => !t.groupId).map((t) => t.team.name),
        matches: stageMatches.filter((m) => !m.groupId).map((m) => views.get(m.id)!),
      });
    }
    return {
      name: tournament.name,
      game: tournament.game,
      stages,
      bonusMatches: tournament.matches.filter((m) => !m.stageId).map(toView),
      generatedAt: new Date(),
    };
  }

  private async mustFind<T>(what: string, find: () => Promise<T | null>): Promise<T> {
    const found = await find().catch(() => null); // malformed UUID -> not found
    if (!found) throw new TournamentError('not_found', `${what} not found`);
    return found;
  }
}

export type { StandingRow };
