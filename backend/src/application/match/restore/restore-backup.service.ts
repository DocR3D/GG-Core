import { Injectable } from '@nestjs/common';
import { MatchStateService } from '@app/match/state/match-state.service';
import { RoundBackupService, type ValveBackupOptions, type ValveBackupPlayer } from '@app/match/backup/round-backup.service';
import { CS2_RCON_COMMANDS } from '@domain/rules/rules.constants';
import { validateRestoreState, type RestoreState, type TeamSide } from '@domain/restore/restore-state';

/** The state asked for is wrong: every problem, so the admin fixes them all at once. */
export class RestoreStateError extends Error {
  constructor(
    readonly errors: string[],
    readonly warnings: string[] = [],
  ) {
    super(errors.join(' | '));
  }
}

export interface RestoreBackup {
  /** Name to give the file in the game folder of the server */
  fileName: string;
  /** The file itself: a CS2 round backup (KeyValues text) */
  content: string;
  /** The command that loads it once it is in place */
  rconCommand: string;
  /** The round the game goes back to */
  round: number;
  /** What is doubtful but did not stop the file */
  warnings: string[];
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * A CS2 round backup built from the state an admin asked for: the way back to a round when the server has no backup of
 * it. Nothing is sent to the server here: the file is given back, to be put in the game folder (by the backend when that
 * folder is reachable, otherwise by the admin) and loaded.
 *
 * In the file, `round` is the number of rounds already played, and "team1" is the team that plays the counter-terrorists
 * in rounds 1 to 12 (it keeps that name for the whole match, whatever side it plays later).
 */
@Injectable()
export class RestoreBackupService {
  constructor(
    private readonly state: MatchStateService,
    private readonly backup: RoundBackupService,
  ) {}

  async build(matchId: string, input: RestoreState, now: Date = new Date()): Promise<RestoreBackup> {
    const [score, roster] = await Promise.all([this.state.getScoreWithTeams(matchId), this.state.getPlayers(matchId)]);
    const known = [...roster.home, ...roster.away].map((p) => p.steamId);
    const issues = validateRestoreState(input, { knownSteamIds: known });
    if (!input.map) issues.errors.push('map: the map of the game, e.g. "de_mirage"');
    if (issues.errors.length) throw new RestoreStateError(issues.errors, issues.warnings);

    const homeName = score.teams.home?.name ?? 'Home';
    const awayName = score.teams.away?.name ?? 'Away';
    const options = this.toBackupOptions(input, homeName, awayName);
    const content = this.backup.generateValveBackup(options);

    const played = input.round - 1;
    const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
    const fileName = `ggcore_round${pad(played)}_${stamp}.txt`;
    return { fileName, content, rconCommand: CS2_RCON_COMMANDS.RESTORE_LOAD(fileName), round: input.round, warnings: issues.warnings };
  }

  /** Home / away and the side of the replayed round, in the words of the file: team1 / team2, CT / T. */
  toBackupOptions(input: RestoreState, homeName: string, awayName: string): ValveBackupOptions {
    const upcoming = input.round;
    const played = upcoming - 1;
    const ctTeam: 'home' | 'away' = input.homeSide === 'CT' ? 'home' : 'away';
    const tTeam: 'home' | 'away' = ctTeam === 'home' ? 'away' : 'home';
    // team1 is the first half's CT team: during the replayed round it is on CT in rounds 1-12, on T in 13-24, and so on
    const team1: 'home' | 'away' = this.backup.isTeam1OnCt(upcoming) ? ctTeam : tTeam;
    const team2: 'home' | 'away' = team1 === 'home' ? 'away' : 'home';
    const nameOf = { home: homeName, away: awayName };
    const sideOf = (team: 'home' | 'away'): TeamSide => (team === ctTeam ? 'CT' : 'T');

    const toPlayer = (p: RestoreState['players'][number]): ValveBackupPlayer => ({
      steamId: p.steamId,
      name: p.name || p.steamId,
      cash: p.money,
      armor: p.armor,
      helmet: p.helmet ? 1 : 0,
      defusekit: p.defuseKit ? 1 : 0,
      items: p.items.length ? p.items : undefined,
    });
    const playersOf = (team: 'home' | 'away') => input.players.filter((p) => p.team === team).map(toPlayer);

    const ctStreak = input[ctTeam].lossStreak;
    const tStreak = input[tTeam].lossStreak;
    const firstHalf = input.firstHalf ? { team1: input.firstHalf[team1], team2: input.firstHalf[team2] } : undefined;
    const secondHalf = input.secondHalf ? { team1: input.secondHalf[team1], team2: input.secondHalf[team2] } : undefined;
    // Overtime: the rounds won by each team after the 24 of the regulation, and which overtime is being played (6 rounds each)
    const overtimeScore =
      played > 24 && firstHalf && secondHalf
        ? {
            team1: input[team1].score - firstHalf.team1 - secondHalf.team1,
            team2: input[team2].score - firstHalf.team2 - secondHalf.team2,
            overtimeId: Math.floor((played - 24) / 6) + 1,
          }
        : undefined;

    return {
      round: played,
      team1Name: nameOf[team1],
      team2Name: nameOf[team2],
      map: input.map,
      scoreTeam1: input[team1].score,
      scoreTeam2: input[team2].score,
      firstHalfScore: firstHalf,
      secondHalfScore: secondHalf,
      overtimeScore,
      history: {
        consecutiveCTLoses: ctStreak,
        consecutiveTLoses: tStreak,
        // CS2 also keeps which side lost the last round; nobody knows it here, so the side with the longer streak
        loserMostRecentTeam: ctStreak > tStreak ? 'CT' : tStreak > ctStreak ? 'T' : ctStreak > 0 ? 'CT' : 'T',
      },
      playersTeam1: playersOf(team1),
      playersTeam2: playersOf(team2),
      playersAliveCT: Math.max(1, input.players.filter((p) => sideOf(p.team) === 'CT').length),
      playersAliveT: Math.max(1, input.players.filter((p) => sideOf(p.team) === 'T').length),
    };
  }
}
