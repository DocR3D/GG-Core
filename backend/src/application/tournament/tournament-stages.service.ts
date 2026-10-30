// src/application/tournament/tournament-stages.service.ts
import { Injectable } from '@nestjs/common';
import { MatchFormat, StageType } from '@prisma/client';
import { PrismaService } from '@adapters/database/prisma.service';
import { computeStandings, FinishedSeries, roundRobinPairings, snakeDistribute, StandingRow } from '@domain/tournament/round-robin';

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

  private async mustFind<T>(what: string, find: () => Promise<T | null>): Promise<T> {
    const found = await find().catch(() => null); // malformed UUID -> not found
    if (!found) throw new TournamentError('not_found', `${what} not found`);
    return found;
  }
}

export type { StandingRow };
