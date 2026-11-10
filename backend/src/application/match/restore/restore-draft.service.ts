import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '@adapters/database/prisma.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { GameRoundsService } from '@app/tournament/game-rounds.service';
import { RoundBackupService } from '@app/match/backup/round-backup.service';
import { MatchAdminError } from '@app/match/admin/match-admin.service';
import type { RestoreHalfScore, RestorePlayerState, RestoreState, TeamSide } from '@domain/restore/restore-state';

/** What the admin gives to find the round: the round to replay, or the score the game is to go back to. */
export interface RestoreDraftRequest {
  round?: number;
  scoreHome?: number;
  scoreAway?: number;
}

/** The parts of a draft that GG-Core fills from what it knows, and the ones the admin has to fill. */
export type DraftPart = 'score' | 'halves' | 'lossStreak' | 'money' | 'players' | 'inventory' | 'map';

export interface RestoreDraft {
  /** What GG-Core knows, in the shape the restore takes: the admin corrects it, then sends it back */
  state: RestoreState;
  /** Where each part comes from, in words */
  sources: Partial<Record<DraftPart, string>>;
  /** What GG-Core does not know and could not guess: the admin has to give it */
  missing: DraftPart[];
  /** The names of the two teams, to show next to home and away */
  teams: { home: string; away: string };
  /** What to do with this draft: the admin corrects `state`, then sends it to this route (the next step of the manual restore) */
  next: { method: 'POST'; path: string; body: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_START_MONEY = 800;
const DEFAULT_KNIFE: Record<TeamSide, string> = { CT: 'weapon_knife', T: 'weapon_knife_t' };
const DEFAULT_PISTOL: Record<TeamSide, string> = { CT: 'weapon_usp_silencer', T: 'weapon_glock' };

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 200;

/**
 * The state of a round as GG-Core remembers it, as a starting point for the admin: the score round by round, the loss
 * streaks and the money of each player as photographed at the start of that round, the players the match knows.
 * What nobody records (what each player carries, his armour) is left as the start-of-match default and flagged, and the
 * admin corrects whatever is wrong before asking for the file.
 */
@Injectable()
export class RestoreDraftService {
  constructor(
    private readonly state: MatchStateService,
    private readonly backup: RoundBackupService,
    @Optional() private readonly gameRounds?: GameRoundsService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async draft(matchId: string, request: RestoreDraftRequest): Promise<RestoreDraft> {
    const sources: RestoreDraft['sources'] = {};
    const missing = new Set<DraftPart>();

    const asked = isCount(request.scoreHome) && isCount(request.scoreAway) ? { home: request.scoreHome, away: request.scoreAway } : null;
    if (request.round === undefined && !asked) {
      throw new MatchAdminError('invalid', 'round, or the two scores (scoreHome and scoreAway), to say which round to go back to');
    }
    const round = request.round ?? (asked ? asked.home + asked.away + 1 : 0);
    if (!Number.isInteger(round) || round < 1 || round > 200) throw new MatchAdminError('invalid', 'round: a whole number from 1 to 200');
    if (asked && request.round !== undefined && asked.home + asked.away !== round - 1) {
      throw new MatchAdminError('invalid', `round ${round} comes after ${round - 1} rounds, but the two scores add up to ${asked.home + asked.away}`);
    }
    const played = round - 1;

    const [sides, current, roster, scoreWithTeams] = await Promise.all([
      this.state.getSides(matchId),
      this.state.getScore(matchId),
      this.state.getPlayers(matchId),
      this.state.getScoreWithTeams(matchId),
    ]);
    if (!sides) throw new MatchAdminError('conflict', 'No sides known for this match: it has not started');

    const currentPlayed = current.ct + current.t;
    // which team is the first half's counter-terrorist team ("team1") tells which side home played in every round
    const homeIsTeam1 = (sides.home === 'CT') === this.backup.isTeam1OnCt(currentPlayed + 1);
    const homeSideAt = (r: number): TeamSide => (homeIsTeam1 === this.backup.isTeam1OnCt(r) ? 'CT' : 'T');

    // --- score and halves -----------------------------------------------------------------------------------
    const fromEvents = await this.scoreFromEvents(matchId, played, homeSideAt);
    let home = 0;
    let away = 0;
    let firstHalf: RestoreHalfScore | undefined;
    let secondHalf: RestoreHalfScore | undefined;
    if (asked) {
      home = asked.home;
      away = asked.away;
      sources.score = 'asked';
      if (fromEvents && fromEvents.home === home && fromEvents.away === away) {
        ({ firstHalf, secondHalf } = fromEvents);
        sources.halves = 'game events, round by round';
      }
    } else if (fromEvents) {
      ({ home, away, firstHalf, secondHalf } = fromEvents);
      sources.score = 'game events, round by round';
      sources.halves = 'game events, round by round';
    } else if (played === currentPlayed) {
      home = sides.home === 'CT' ? current.ct : current.t;
      away = sides.home === 'CT' ? current.t : current.ct;
      sources.score = 'current score';
    } else {
      missing.add('score');
    }
    if (played >= 12 && !firstHalf) missing.add('halves');
    if (played >= 24 && !secondHalf) missing.add('halves');

    // --- loss streaks, money --------------------------------------------------------------------------------
    const teamsAt = await this.state.getTeamEconomyAt(matchId, played);
    let homeStreak = 0;
    let awayStreak = 0;
    if (teamsAt) {
      homeStreak = teamsAt.home_loss_streak;
      awayStreak = teamsAt.away_loss_streak;
      sources.lossStreak = 'photographed at the start of that round';
    } else if (played === currentPlayed) {
      const meta = await this.state.getTeamEconomyMeta(matchId);
      homeStreak = meta.home_loss_streak;
      awayStreak = meta.away_loss_streak;
      sources.lossStreak = 'current';
    } else {
      missing.add('lossStreak');
    }

    const moneyAt = await this.state.getPlayersEconomyAt(matchId, played);
    const nowAll = played === currentPlayed ? await this.state.getPlayersEconomy(matchId) : null;
    const moneyNow = nowAll && Object.keys(nowAll).length > 0 ? nowAll : null;
    sources.money = moneyAt ? 'photographed at the start of that round' : moneyNow ? 'current' : round === 1 || round === 13 ? 'pistol round: the start money' : undefined;
    if (!sources.money) missing.add('money');

    // --- players ----------------------------------------------------------------------------------------------
    const homeSide = homeSideAt(round);
    const sideOfTeam = (team: 'home' | 'away'): TeamSide => (team === 'home' ? homeSide : homeSide === 'CT' ? 'T' : 'CT');
    const players: RestorePlayerState[] = [
      ...roster.home.map((p) => ({ ...p, team: 'home' as const })),
      ...roster.away.map((p) => ({ ...p, team: 'away' as const })),
    ].map((p) => {
      const side = sideOfTeam(p.team);
      const money = moneyAt?.[p.steamId]?.money ?? moneyNow?.[p.steamId]?.money ?? (sources.money ? DEFAULT_START_MONEY : 0);
      return {
        steamId: p.steamId,
        name: p.name,
        team: p.team,
        money,
        armor: 0,
        helmet: false,
        defuseKit: false,
        items: [DEFAULT_KNIFE[side], DEFAULT_PISTOL[side]],
      };
    });
    if (players.length) {
      sources.players = 'the players this match knows';
      sources.inventory = 'the start-of-match loadout (knife and pistol): GG-Core does not record what each player carries';
      missing.add('inventory');
    } else {
      missing.add('players');
    }

    // --- map --------------------------------------------------------------------------------------------------
    const map = await this.mapOf(matchId);
    if (map) sources.map = 'the game of the tournament';
    else missing.add('map');

    return {
      state: {
        round,
        homeSide,
        home: { score: home, lossStreak: homeStreak },
        away: { score: away, lossStreak: awayStreak },
        players,
        ...(map ? { map } : {}),
        ...(firstHalf ? { firstHalf } : {}),
        ...(secondHalf ? { secondHalf } : {}),
      },
      sources,
      missing: [...missing],
      teams: { home: scoreWithTeams.teams.home?.name ?? 'Home', away: scoreWithTeams.teams.away?.name ?? 'Away' },
      next: { method: 'POST', path: `/api/matches/${matchId}/manual-restore/backup`, body: 'state, once corrected' },
    };
  }

  /** Who won each of the rounds already played, from the events of the game; null when one of them is missing. */
  private async scoreFromEvents(
    matchId: string,
    played: number,
    homeSideAt: (round: number) => TeamSide,
  ): Promise<{ home: number; away: number; firstHalf?: RestoreHalfScore; secondHalf?: RestoreHalfScore } | null> {
    if (!this.gameRounds || !UUID.test(matchId)) return null;
    const rounds = await this.gameRounds.forGame(matchId);
    const winners = new Map(rounds.map((r) => [r.number, r.winner]));
    const zero = (): RestoreHalfScore => ({ home: 0, away: 0 });
    let total = zero();
    let first = zero();
    let second = zero();
    for (let r = 1; r <= played; r++) {
      const winner = winners.get(r);
      if (winner !== 'CT' && winner !== 'T') return null;
      const team: 'home' | 'away' = homeSideAt(r) === winner ? 'home' : 'away';
      total = { ...total, [team]: total[team] + 1 };
      if (r <= 12) first = { ...first, [team]: first[team] + 1 };
      else if (r <= 24) second = { ...second, [team]: second[team] + 1 };
    }
    return { ...total, firstHalf: played >= 12 ? first : undefined, secondHalf: played >= 24 ? second : undefined };
  }

  private async mapOf(matchId: string): Promise<string | undefined> {
    if (!this.prisma || !UUID.test(matchId)) return undefined;
    const row = await this.prisma.matchMap.findUnique({ where: { id: matchId }, select: { mapName: true } });
    return row?.mapName || undefined;
  }
}
