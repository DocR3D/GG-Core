// src/application/tournament/tournament-edit.service.ts
import { Injectable } from '@nestjs/common';
import { TournamentStatus } from '@prisma/client';
import { PrismaService } from '@adapters/database/prisma.service';
import { isUuid } from '@adapters/database/tournament-persistence.service';
import { toLogSteamId } from '@app/match/access/match-access.service';
import { TournamentError } from './tournament-stages.service';

const STATUSES: TournamentStatus[] = ['UPCOMING', 'ACTIVE', 'COMPLETED', 'ARCHIVED'];

/**
 * Changes to what was created for a tournament (the admin screen to manage a tournament): rename, status, a team
 * renamed or taken out, a player corrected or taken out of a roster. Nothing here touches a played result: a team
 * that already has a match is replaced (TournamentAdminService.replaceTeam), not taken out.
 */
@Injectable()
export class TournamentEditService {
  constructor(private readonly prisma: PrismaService) {}

  /** { name?, status? } - status: UPCOMING | ACTIVE | COMPLETED | ARCHIVED (ARCHIVED: hidden from the home page). */
  async updateTournament(tournamentId: string, input: { name?: string; status?: string }) {
    await this.mustFind('tournament', tournamentId, (id) => this.prisma.tournament.findUnique({ where: { id } }));
    const data: { name?: string; status?: TournamentStatus } = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new TournamentError('invalid', 'name cannot be empty');
      data.name = input.name.trim().slice(0, 128);
    }
    if (input.status !== undefined) {
      if (!STATUSES.includes(input.status as TournamentStatus)) throw new TournamentError('invalid', `status: ${STATUSES.join(' | ')}`);
      data.status = input.status as TournamentStatus;
    }
    return this.prisma.tournament.update({ where: { id: tournamentId }, data, select: { id: true, name: true, game: true, status: true } });
  }

  /** { name?, tag? } - a team is shared by every tournament it plays: renamed everywhere. */
  async updateTeam(teamId: string, input: { name?: string; tag?: string | null }) {
    await this.mustFind('team', teamId, (id) => this.prisma.team.findUnique({ where: { id } }));
    const data: { name?: string; tag?: string | null } = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new TournamentError('invalid', 'name cannot be empty');
      data.name = input.name.trim().slice(0, 128);
    }
    if (input.tag !== undefined) data.tag = input.tag?.trim().slice(0, 32) || null;
    return this.prisma.team.update({ where: { id: teamId }, data, select: { id: true, name: true, tag: true } });
  }

  /**
   * Takes a team out of a tournament before it plays: refused once it has a match or a place in a stage (replace it
   * then). Its roster for this tournament goes; the team itself is deleted when no other tournament has it.
   */
  async removeTeam(tournamentId: string, teamId: string) {
    await this.mustFind('tournament', tournamentId, (id) => this.prisma.tournament.findUnique({ where: { id } }));
    await this.mustFind('team', teamId, (id) => this.prisma.team.findUnique({ where: { id } }));
    const [match, entry] = await Promise.all([
      this.prisma.match.findFirst({ where: { tournamentId, OR: [{ teamHomeId: teamId }, { teamAwayId: teamId }] } }),
      this.prisma.stageTeam.findFirst({ where: { teamId, stage: { tournamentId } } }),
    ]);
    if (match || entry) {
      throw new TournamentError('conflict', 'this team already has a match or a place in a stage: replace it in its matches instead');
    }
    return this.prisma.$transaction(async (tx) => {
      const rosters = await tx.teamRoster.deleteMany({ where: { tournamentId, teamId } });
      const [otherRoster, otherEntry, otherMatch] = await Promise.all([
        tx.teamRoster.findFirst({ where: { teamId } }),
        tx.stageTeam.findFirst({ where: { teamId } }),
        tx.match.findFirst({ where: { OR: [{ teamHomeId: teamId }, { teamAwayId: teamId }] } }),
      ]);
      const teamDeleted = !otherRoster && !otherEntry && !otherMatch;
      if (teamDeleted) await tx.team.delete({ where: { id: teamId } });
      return { teamId, playersRemoved: rosters.count, teamDeleted };
    });
  }

  /**
   * { username?, steamId? } - SteamID64 or the CS2 log format ([U:1:x]), empty = none. Refused when another
   * player already has it (named in the message).
   */
  async updatePlayer(playerId: string, input: { username?: string; steamId?: string | null }) {
    await this.mustFind('player', playerId, (id) => this.prisma.player.findUnique({ where: { id } }));
    const data: { username?: string; steamId?: string | null } = {};
    if (input.username !== undefined) {
      if (!input.username.trim()) throw new TournamentError('invalid', 'username cannot be empty');
      data.username = input.username.trim().slice(0, 64);
    }
    if (input.steamId !== undefined) {
      const steamId = input.steamId?.trim() || null;
      if (steamId && !toLogSteamId(steamId)) throw new TournamentError('invalid', 'steamId: SteamID64 (17 digits) or [U:1:x]');
      if (steamId) {
        const other = await this.prisma.player.findUnique({ where: { steamId } });
        if (other && other.id !== playerId) throw new TournamentError('conflict', `SteamID already used by ${other.username}`);
      }
      data.steamId = steamId;
    }
    return this.prisma.player.update({ where: { id: playerId }, data, select: { id: true, username: true, steamId: true } });
  }

  /** Takes a player out of a team's roster for this tournament (the player is kept: other teams, stats). */
  async removePlayer(tournamentId: string, teamId: string, playerId: string) {
    if (![tournamentId, teamId, playerId].every(isUuid)) throw new TournamentError('not_found', 'player not in this team for this tournament');
    const removed = await this.prisma.teamRoster.deleteMany({ where: { tournamentId, teamId, playerId } });
    if (!removed.count) throw new TournamentError('not_found', 'player not in this team for this tournament');
    return { tournamentId, teamId, playerId, removed: true };
  }

  private async mustFind<T>(what: string, id: string, find: (id: string) => Promise<T | null>): Promise<T> {
    const found = isUuid(id) ? await find(id) : null;
    if (!found) throw new TournamentError('not_found', `${what} not found`);
    return found;
  }
}
