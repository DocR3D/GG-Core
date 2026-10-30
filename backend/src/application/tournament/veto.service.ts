// src/application/tournament/veto.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma, VetoAction } from '@prisma/client';
import { PrismaService } from '@adapters/database/prisma.service';
import { isUuid } from '@adapters/database/tournament-persistence.service';
import { steam64ToSteam3 } from '@app/auth/steam-openid';
import {
  RPS_CHOICES,
  RpsChoice,
  rpsWinner,
  Side,
  validateVetoConfig,
  VetoConfig,
  VetoDone,
  VetoError,
  VetoFormat,
  VetoKind,
  vetoState,
  VetoTeam,
} from '@domain/tournament/veto';
import { TournamentError } from './tournament-stages.service';

/** Who acts: a team captain (SteamID from the Steam login) or an admin (acts for the team whose turn it is). */
export interface VetoActor {
  steamId?: string;
  admin: boolean;
  name: string;
}

export type VetoPhase = 'unavailable' | 'rps' | 'rps_decision' | 'veto' | 'done';

export interface VetoView {
  matchId: string;
  tournament: { id: string; name: string };
  format: VetoFormat;
  phase: VetoPhase;
  /** why the veto cannot happen (phase "unavailable") */
  reason?: string;
  teams: { home: VetoViewTeam; away: VetoViewTeam };
  config: VetoConfig | null;
  rps: {
    /** finished rounds, choices revealed */
    rounds: { round: number; home: RpsChoice; away: RpsChoice }[];
    /** round being played: who has already chosen - never what (the opponent could read it) */
    current: { round: number; homePlayed: boolean; awayPlayed: boolean; mine?: RpsChoice } | null;
    winnerTeamId: string | null;
  };
  startTeamId: string | null;
  steps: { order: number; teamId: string; kind: VetoKind; map: string; side?: Side; actedBy: string | null; at: Date }[];
  remaining: string[];
  next: { kind: VetoKind; teamId: string; map?: string } | null;
  maps: {
    order: number;
    map: string;
    pickedByTeamId: string | null;
    side: { teamId: string; side: Side } | null;
    /** grand final: the map left at the end is the advantage map, not played, counted as won by this team */
    advantageTeamId?: string;
  }[];
  /** teams whose captain has to act now (both during a RPS round nobody has played yet) */
  waitingFor: string[];
  /** last RPS choice or veto step: how long a captain has been keeping the others waiting (no timer) */
  lastActionAt: Date | null;
  /** number of recorded actions (RPS choices, starting team, steps): version of the state, lower after an undo */
  seq: number;
  viewer: { teamId: string | null; admin: boolean; canAct: boolean };
}

/** One line of a veto list (captain's "my vetos", admin overview of a tournament). */
export interface VetoListItem {
  matchId: string;
  tournament: { id: string; name: string };
  format: VetoFormat;
  home: { id: string; name: string };
  away: { id: string; name: string };
  phase: VetoPhase;
  reason?: string;
  waitingFor: string[];
  lastActionAt: Date | null;
  /** captain's list: it is this captain's turn */
  myTurn?: boolean;
}

interface VetoViewTeam {
  id: string;
  name: string;
  captain: string | null;
}

const KIND_TO_ACTION: Record<VetoKind, VetoAction> = { ban: 'BAN', pick: 'PICK', side: 'SIDE' };
const ACTION_TO_KIND: Partial<Record<VetoAction, VetoKind>> = { BAN: 'ban', PICK: 'pick', SIDE: 'side' };

const matchInclude = {
  teamHome: true,
  teamAway: true,
  tournament: { include: { rosters: { where: { isCaptain: true }, include: { player: true } } } },
  stageRef: true,
  maps: true,
  vetos: { orderBy: { stepOrder: 'asc' } },
  rps: { orderBy: { round: 'asc' } },
} satisfies Prisma.MatchInclude;
type VetoMatch = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;

/**
 * Rock-paper-scissors then map veto, played on the website by the two captains (decided with the user):
 * the RPS winner decides who starts the veto, then bans / picks follow the series format; the maps become the
 * games of the series (MatchMap), the server is chosen later, at launch. No timer: an admin can play a step for
 * an absent captain, undo the last action or reset. Every step records its author and time.
 */
@Injectable()
export class VetoService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Configuration --------------------------------------------------------------------------------------

  /** Map pool and side mode of a tournament (default for its stages). */
  async setTournamentConfig(tournamentId: string, input: Partial<VetoConfig>) {
    const config = this.validate(input);
    const t = await this.prisma.tournament.findUnique({ where: { id: this.uuid(tournamentId, 'tournament') } });
    if (!t) throw new TournamentError('not_found', 'tournament not found');
    await this.prisma.tournament.update({ where: { id: t.id }, data: { settings: { ...((t.settings as object) ?? {}), veto: { ...config } } } });
    return config;
  }

  /** Map pool and side mode of one stage (overrides the tournament's). */
  async setStageConfig(stageId: string, input: Partial<VetoConfig>) {
    const config = this.validate(input);
    const stage = await this.prisma.stage.findUnique({ where: { id: this.uuid(stageId, 'stage') } });
    if (!stage) throw new TournamentError('not_found', 'stage not found');
    await this.prisma.stage.update({ where: { id: stage.id }, data: { settings: { ...((stage.settings as object) ?? {}), veto: { ...config } } } });
    return config;
  }

  /**
   * Adds players to the roster of a team for a tournament (created, or found by SteamID). `captain: true` makes
   * one of them the captain. SteamID64 or the CS2 log format ([U:1:x]) are both accepted.
   */
  async addPlayers(tournamentId: string, teamId: string, players: { username: string; steamId?: string; captain?: boolean }[]) {
    await this.mustExist(tournamentId, teamId);
    if (!players?.length) throw new TournamentError('invalid', 'players: [{ username, steamId?, captain? }]');
    if (players.filter((p) => p.captain).length > 1) throw new TournamentError('invalid', 'one captain per team');
    const added: { playerId: string; username: string; steamId: string | null; captain: boolean }[] = [];
    for (const p of players) {
      const username = p.username?.trim();
      if (!username) throw new TournamentError('invalid', 'every player needs a username');
      const steamId = p.steamId?.trim() || null;
      const player = steamId
        ? await this.prisma.player.upsert({ where: { steamId }, create: { username, steamId }, update: { username } })
        : await this.prisma.player.create({ data: { username } });
      const other = await this.prisma.teamRoster.findUnique({ where: { tournamentId_playerId: { tournamentId, playerId: player.id } } });
      if (other && other.teamId !== teamId) throw new TournamentError('conflict', `${username} already plays for another team in this tournament`);
      if (!other) await this.prisma.teamRoster.create({ data: { tournamentId, teamId, playerId: player.id } });
      if (p.captain) await this.setCaptain(tournamentId, teamId, player.id);
      added.push({ playerId: player.id, username, steamId, captain: !!p.captain });
    }
    return added;
  }

  /** Makes a roster player the captain of its team for the tournament (the previous captain is no longer). */
  async setCaptain(tournamentId: string, teamId: string, playerId: string) {
    await this.mustExist(tournamentId, teamId);
    const roster = await this.prisma.teamRoster.findFirst({ where: { tournamentId, teamId, playerId: this.uuid(playerId, 'player') }, include: { player: true } });
    if (!roster) throw new TournamentError('not_found', 'player not in this team for this tournament');
    await this.prisma.$transaction([
      this.prisma.teamRoster.updateMany({ where: { tournamentId, teamId, isCaptain: true }, data: { isCaptain: false } }),
      this.prisma.teamRoster.update({ where: { id: roster.id }, data: { isCaptain: true } }),
    ]);
    return { teamId, playerId, username: roster.player.username, steamId: roster.player.steamId };
  }

  // --- State ----------------------------------------------------------------------------------------------

  async getState(matchId: string, actor?: VetoActor): Promise<VetoView> {
    const match = await this.load(matchId);
    return this.view(match, actor ? await this.captainTeam(match, actor) : null, actor);
  }

  // --- Actions --------------------------------------------------------------------------------------------

  /** A captain plays rock / paper / scissors for the current round (an admin cannot: it can set who starts). */
  async playRps(matchId: string, actor: VetoActor, choice: string) {
    const match = await this.load(matchId);
    const teamId = await this.captainTeam(match, actor);
    if (!teamId) throw new TournamentError('forbidden', 'only a captain of this match plays rock-paper-scissors (admin: set who starts)');
    if (!RPS_CHOICES.includes(choice as RpsChoice)) throw new TournamentError('invalid', 'choice: rock | paper | scissors');
    const view = this.view(match, teamId, actor);
    if (view.phase !== 'rps') throw new TournamentError('conflict', `not the time for rock-paper-scissors (${view.phase})`);
    if (view.rps.current!.mine) throw new TournamentError('conflict', 'already played this round');
    await this.insert(() =>
      this.prisma.matchRps.create({ data: { matchId: match.id, round: view.rps.current!.round, teamId, choice, actedBy: this.author(actor, true) } }),
    );
    return this.getState(matchId, actor);
  }

  /**
   * Who starts the veto: the RPS winner decides (`first`: true = it starts, false = the opponent starts);
   * an admin sets it directly with `teamId` (RPS played elsewhere, e.g. on Discord or face to face).
   */
  async chooseStart(matchId: string, actor: VetoActor, input: { first?: boolean; teamId?: string }) {
    const match = await this.load(matchId);
    const view = this.view(match, await this.captainTeam(match, actor), actor);
    if (view.phase === 'unavailable') throw new TournamentError('conflict', view.reason!);
    if (view.startTeamId) throw new TournamentError('conflict', 'the starting team is already set');
    let startTeamId: string;
    if (actor.admin && input.teamId) {
      if (input.teamId !== match.teamHomeId && input.teamId !== match.teamAwayId) throw new TournamentError('invalid', 'teamId: one of the two teams');
      startTeamId = input.teamId;
    } else {
      const winner = view.rps.winnerTeamId;
      if (!winner) throw new TournamentError('conflict', 'rock-paper-scissors not won yet');
      if (view.viewer.teamId !== winner && !actor.admin) throw new TournamentError('forbidden', 'only the rock-paper-scissors winner decides');
      if (typeof input.first !== 'boolean') throw new TournamentError('invalid', 'first: true (start the veto) | false (let the opponent start)');
      startTeamId = input.first ? winner : this.opponent(match, winner);
    }
    await this.prisma.match.update({ where: { id: match.id }, data: { vetoStartTeamId: startTeamId } });
    return this.getState(matchId, actor);
  }

  /** Next ban / pick (`map`) or side choice (`side`). Captain of the team whose turn it is, or an admin for it. */
  async playStep(matchId: string, actor: VetoActor, input: { map?: string; side?: string }) {
    const match = await this.load(matchId);
    const captainOf = await this.captainTeam(match, actor);
    const view = this.view(match, captainOf, actor);
    if (view.phase !== 'veto') throw new TournamentError('conflict', view.phase === 'unavailable' ? view.reason! : `no veto step to play (${view.phase})`);
    const next = view.next!;
    if (captainOf !== next.teamId && !actor.admin) throw new TournamentError('forbidden', 'not your turn');

    // A request for another step than the expected one (e.g. sent just after someone else played)
    if (next.kind === 'side' && !input.side) throw new TournamentError('invalid', `a side is expected (CT or T) on ${next.map}`);
    if (next.kind !== 'side' && !input.map?.trim()) throw new TournamentError('invalid', `a map is expected (${next.kind})`);

    const startTeamId = match.vetoStartTeamId!;
    const step: VetoDone =
      next.kind === 'side'
        ? { kind: 'side', team: this.letter(next.teamId, startTeamId), map: next.map!, side: input.side as Side }
        : { kind: next.kind, team: this.letter(next.teamId, startTeamId), map: input.map?.trim() ?? '' };
    const config = this.config(match)!;
    const format = match.format as VetoFormat;
    let after;
    try {
      after = vetoState(config, format, [...this.done(match), step]);
    } catch (e) {
      if (e instanceof VetoError) throw new TournamentError('invalid', e.message);
      throw e;
    }

    const row = this.prisma.matchVeto.create({
      data: {
        matchId: match.id,
        stepOrder: match.vetos.length + 1,
        teamId: next.teamId,
        action: KIND_TO_ACTION[step.kind],
        mapName: step.map,
        sidePick: step.side ?? null,
        actedBy: this.author(actor, captainOf === next.teamId),
      },
    });
    // Veto over: the maps become the games of the series, in order (server chosen at launch)
    // (grand final: the map left at the end is the advantage map - already counted by advantageHome / Away, no game)
    const played = this.advantageTeamId(match) ? after.maps.filter((m) => m.pickedBy) : after.maps;
    const games = after.finished
      ? played.map((m, i) => this.prisma.matchMap.create({ data: { matchId: match.id, mapOrder: i + 1, mapName: m.map } }))
      : [];
    await this.insert(() => this.prisma.$transaction([row, ...games]));
    return this.getState(matchId, actor);
  }

  /** Admin: undoes the last action (veto step, else the choice of the starting team). */
  async undo(matchId: string, actor: VetoActor) {
    this.mustBeAdmin(actor);
    const match = await this.load(matchId);
    const last = match.vetos[match.vetos.length - 1];
    if (last) {
      await this.prisma.$transaction([...this.deleteGames(match), this.prisma.matchVeto.delete({ where: { id: last.id } })]);
    } else if (match.vetoStartTeamId) {
      await this.prisma.match.update({ where: { id: match.id }, data: { vetoStartTeamId: null } });
    } else {
      throw new TournamentError('conflict', 'nothing to undo (reset starts the rock-paper-scissors again)');
    }
    return this.getState(matchId, actor);
  }

  /** Admin: everything again from the rock-paper-scissors. */
  async reset(matchId: string, actor: VetoActor) {
    this.mustBeAdmin(actor);
    const match = await this.load(matchId);
    await this.prisma.$transaction([
      ...this.deleteGames(match),
      this.prisma.matchVeto.deleteMany({ where: { matchId: match.id } }),
      this.prisma.matchRps.deleteMany({ where: { matchId: match.id } }),
      this.prisma.match.update({ where: { id: match.id }, data: { vetoStartTeamId: null } }),
    ]);
    return this.getState(matchId, actor);
  }

  /**
   * Starting sides of game n° `order` decided by the veto (side mode "pick"), for the launch: null = knife round.
   */
  async startingSides(matchId: string, order: number): Promise<{ home: Side; away: Side } | null> {
    const match = await this.load(matchId);
    const view = this.view(match, null);
    const game = view.maps.find((m) => m.order === order);
    if (view.phase !== 'done' || !game?.side) return null;
    const homeSide = game.side.teamId === match.teamHomeId ? game.side.side : game.side.side === 'CT' ? 'T' : 'CT';
    return { home: homeSide, away: homeSide === 'CT' ? 'T' : 'CT' };
  }

  // --- Lists ----------------------------------------------------------------------------------------------

  /**
   * "My vetos": the unfinished matches of the teams the actor is captain of (Steam login), with whether it is
   * its turn - how a captain finds its match without being sent a link.
   */
  async listForCaptain(actor: VetoActor): Promise<VetoListItem[]> {
    const rosters = actor.steamId
      ? await this.prisma.teamRoster.findMany({ where: { isCaptain: true, player: { steamId: { in: steamIds(actor.steamId) } } } })
      : [];
    if (!rosters.length) return [];
    const matches = await this.prisma.match.findMany({
      where: {
        status: { not: 'FINISHED' },
        OR: rosters.map((r) => ({ tournamentId: r.tournamentId, OR: [{ teamHomeId: r.teamId }, { teamAwayId: r.teamId }] })),
      },
      include: matchInclude,
      orderBy: [{ roundNumber: 'asc' }, { createdAt: 'asc' }],
    });
    return matches.flatMap((m) => {
      const teamId = rosters.find((r) => r.tournamentId === m.tournamentId && (r.teamId === m.teamHomeId || r.teamId === m.teamAwayId))!.teamId;
      const view = this.view(m, teamId, { ...actor, admin: false });
      if (view.phase === 'unavailable' && view.reason === 'both teams must be known') return [];
      return [{ ...this.item(view), myTurn: view.viewer.canAct }];
    });
  }

  /**
   * Admin overview of a tournament: every match whose two teams are known, with its veto phase, who is
   * expected and since when (there is no timer: this is how a slow captain is spotted).
   */
  async listForTournament(tournamentId: string): Promise<VetoListItem[]> {
    const t = await this.prisma.tournament.findUnique({ where: { id: this.uuid(tournamentId, 'tournament') } });
    if (!t) throw new TournamentError('not_found', 'tournament not found');
    const matches = await this.prisma.match.findMany({
      where: { tournamentId: t.id, teamHomeId: { not: null }, teamAwayId: { not: null } },
      include: matchInclude,
      orderBy: [{ roundNumber: 'asc' }, { createdAt: 'asc' }],
    });
    return matches.map((m) => this.item(this.view(m, null)));
  }

  private item(v: VetoView): VetoListItem {
    return {
      matchId: v.matchId,
      tournament: v.tournament,
      format: v.format,
      home: { id: v.teams.home.id, name: v.teams.home.name },
      away: { id: v.teams.away.id, name: v.teams.away.name },
      phase: v.phase,
      ...(v.reason ? { reason: v.reason } : {}),
      waitingFor: v.waitingFor,
      lastActionAt: v.lastActionAt,
    };
  }

  // --- Internals ------------------------------------------------------------------------------------------

  private view(match: VetoMatch, captainOf: string | null, actor?: VetoActor): VetoView {
    const home = match.teamHome;
    const away = match.teamAway;
    const config = this.config(match);
    const format = match.format as VetoFormat;
    const captain = (teamId?: string) =>
      match.tournament.rosters.find((r) => r.teamId === teamId)?.player.username ?? null;
    const base: VetoView = {
      matchId: match.id,
      tournament: { id: match.tournament.id, name: match.tournament.name },
      format,
      phase: 'unavailable',
      teams: {
        home: { id: home?.id ?? '', name: home?.name ?? '?', captain: captain(home?.id) },
        away: { id: away?.id ?? '', name: away?.name ?? '?', captain: captain(away?.id) },
      },
      config,
      rps: { rounds: [], current: null, winnerTeamId: null },
      startTeamId: match.vetoStartTeamId,
      steps: [],
      remaining: [],
      next: null,
      maps: [],
      waitingFor: [],
      lastActionAt: latest([...match.rps.map((r) => r.createdAt), ...match.vetos.map((v) => v.createdAt)]),
      seq: match.rps.length + Number(!!match.vetoStartTeamId) + match.vetos.length,
      viewer: { teamId: captainOf, admin: !!actor?.admin, canAct: false },
    };
    if (!home || !away) return { ...base, reason: 'both teams must be known' };
    if (!config) return { ...base, reason: 'no map pool configured for this tournament / stage' };
    // A veto already started stays visible (even once the match is over)
    const started = match.vetos.length > 0 || !!match.vetoStartTeamId;
    if (!started && match.maps.length > 0) return { ...base, reason: 'the games of this match were set without a veto' };
    if (!started && match.status === 'FINISHED') return { ...base, reason: 'match finished' };

    // Rock-paper-scissors: rounds until one has a winner
    const byRound = new Map<number, Map<string, RpsChoice>>();
    for (const r of match.rps) {
      if (!byRound.has(r.round)) byRound.set(r.round, new Map());
      byRound.get(r.round)!.set(r.teamId, r.choice as RpsChoice);
    }
    let round = 1;
    for (; ; round++) {
      const played = byRound.get(round);
      const h = played?.get(home.id);
      const a = played?.get(away.id);
      if (!h || !a) {
        base.rps.current = { round, homePlayed: !!h, awayPlayed: !!a, mine: captainOf ? played?.get(captainOf) : undefined };
        break;
      }
      base.rps.rounds.push({ round, home: h, away: a });
      const w = rpsWinner(h, a);
      if (w) {
        base.rps.winnerTeamId = w === 'first' ? home.id : away.id;
        break;
      }
    }
    if (base.rps.winnerTeamId || match.vetoStartTeamId) base.rps.current = null;

    if (!match.vetoStartTeamId) {
      if (base.rps.winnerTeamId) {
        return {
          ...base,
          phase: 'rps_decision',
          waitingFor: [base.rps.winnerTeamId],
          viewer: { ...base.viewer, canAct: captainOf === base.rps.winnerTeamId || !!actor?.admin },
        };
      }
      const c = base.rps.current!;
      const waitingFor = [...(c.homePlayed ? [] : [home.id]), ...(c.awayPlayed ? [] : [away.id])];
      return { ...base, phase: 'rps', waitingFor, viewer: { ...base.viewer, canAct: !!captainOf && !c.mine } };
    }

    const start = match.vetoStartTeamId;
    const teamOf = (t: VetoTeam) => (t === 'A' ? start : this.opponent(match, start));
    let state;
    try {
      state = vetoState(config, format, this.done(match));
    } catch (e) {
      // e.g. map pool changed after the veto started: an admin resets it
      return { ...base, reason: `veto inconsistent with the current settings (${(e as Error).message}): reset it` };
    }
    const steps = match.vetos.map((v) => ({
      order: v.stepOrder,
      teamId: v.teamId!,
      kind: ACTION_TO_KIND[v.action]!,
      map: v.mapName,
      ...(v.sidePick ? { side: v.sidePick as Side } : {}),
      actedBy: v.actedBy,
      at: v.createdAt,
    }));
    const next = state.next ? { kind: state.next.kind, teamId: teamOf(state.next.team), ...(state.next.map ? { map: state.next.map } : {}) } : null;
    return {
      ...base,
      phase: state.finished ? 'done' : 'veto',
      steps,
      remaining: state.remaining,
      next,
      waitingFor: next ? [next.teamId] : [],
      maps: state.maps.map((m, i) => ({
        order: i + 1,
        map: m.map,
        pickedByTeamId: m.pickedBy ? teamOf(m.pickedBy) : null,
        side: m.sideChosenBy ? { teamId: teamOf(m.sideChosenBy), side: m.side! } : null,
        ...(!m.pickedBy && this.advantageTeamId(match) ? { advantageTeamId: this.advantageTeamId(match)! } : {}),
      })),
      viewer: { ...base.viewer, canAct: !!next && (captainOf === next.teamId || !!actor?.admin) },
    };
  }

  private done(match: VetoMatch): VetoDone[] {
    const start = match.vetoStartTeamId!;
    return match.vetos.map((v) => ({
      kind: ACTION_TO_KIND[v.action]!,
      team: this.letter(v.teamId!, start),
      map: v.mapName,
      ...(v.sidePick ? { side: v.sidePick as Side } : {}),
    }));
  }

  private config(match: VetoMatch): VetoConfig | null {
    const fromStage = (match.stageRef?.settings as any)?.veto;
    const fromTournament = (match.tournament.settings as any)?.veto;
    const raw = fromStage ?? fromTournament;
    if (!raw) return null;
    try {
      return validateVetoConfig(raw);
    } catch {
      return null;
    }
  }

  /** Team of the match the actor is the captain of (null: not a captain of either team). */
  private async captainTeam(match: VetoMatch, actor: VetoActor): Promise<string | null> {
    if (!actor.steamId || !match.teamHomeId || !match.teamAwayId) return null;
    const roster = await this.prisma.teamRoster.findFirst({
      where: {
        tournamentId: match.tournamentId,
        teamId: { in: [match.teamHomeId, match.teamAwayId] },
        isCaptain: true,
        player: { steamId: { in: steamIds(actor.steamId) } },
      },
    });
    return roster?.teamId ?? null;
  }

  /** Games created by the veto, removed when it is undone - refused once one of them has started. */
  private deleteGames(match: VetoMatch) {
    if (!match.maps.length) return [];
    if (match.maps.some((m) => m.status !== 'PENDING' || m.resultStatus || m.serverId)) {
      throw new TournamentError('conflict', 'a game of this match has already started: the veto can no longer change');
    }
    return [this.prisma.matchMap.deleteMany({ where: { matchId: match.id } })];
  }

  private async load(matchId: string): Promise<VetoMatch> {
    const match = await this.prisma.match.findUnique({ where: { id: this.uuid(matchId, 'match') }, include: matchInclude });
    if (!match) throw new TournamentError('not_found', 'match not found');
    return match;
  }

  private async mustExist(tournamentId: string, teamId: string) {
    const [t, team] = await Promise.all([
      this.prisma.tournament.findUnique({ where: { id: this.uuid(tournamentId, 'tournament') } }),
      this.prisma.team.findUnique({ where: { id: this.uuid(teamId, 'team') } }),
    ]);
    if (!t) throw new TournamentError('not_found', 'tournament not found');
    if (!team) throw new TournamentError('not_found', 'team not found');
  }

  /** Two captains clicking at the same time: the second write hits a unique key → "refresh". */
  private async insert<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new TournamentError('conflict', 'someone acted at the same time: refresh the page');
      }
      throw e;
    }
  }

  private validate(input: Partial<VetoConfig>): VetoConfig {
    try {
      return validateVetoConfig(input);
    } catch (e) {
      if (e instanceof VetoError) throw new TournamentError('invalid', e.message);
      throw e;
    }
  }

  private mustBeAdmin(actor: VetoActor) {
    if (!actor.admin) throw new TournamentError('forbidden', 'admin only');
  }

  private uuid(id: string, what: string): string {
    if (!isUuid(id)) throw new TournamentError('not_found', `${what} not found`);
    return id;
  }

  private letter(teamId: string, startTeamId: string): VetoTeam {
    return teamId === startTeamId ? 'A' : 'B';
  }

  /**
   * Grand final: the upper-bracket finalist starts one map up. Decided with the user: the usual veto (ban ban pick
   * pick ban ban for a BO3), the map left at the end being that advantage map - only the picks are played.
   */
  private advantageTeamId(match: VetoMatch): string | null {
    if (match.advantageHome > 0) return match.teamHomeId;
    if (match.advantageAway > 0) return match.teamAwayId;
    return null;
  }

  private opponent(match: VetoMatch, teamId: string): string {
    return teamId === match.teamHomeId ? match.teamAwayId! : match.teamHomeId!;
  }

  /** SteamID of the captain playing its own turn, "admin:<name>" for an admin playing for a team. */
  private author(actor: VetoActor, asCaptain: boolean): string {
    return (asCaptain && actor.steamId ? actor.steamId : `admin:${actor.name}`).slice(0, 64);
  }
}

/** A SteamID64 and the same account in the CS2 log format ([U:1:x]): rosters may hold either. */
function steamIds(steam64: string): string[] {
  try {
    return [steam64, steam64ToSteam3(steam64)];
  } catch {
    return [steam64]; // not a SteamID64
  }
}

const latest = (dates: Date[]): Date | null => (dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null);
