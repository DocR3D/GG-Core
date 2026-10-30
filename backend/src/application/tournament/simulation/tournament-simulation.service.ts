// src/application/tournament/simulation/tournament-simulation.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { MatchFormat, StageType } from '@prisma/client';
import { PrismaService } from '@adapters/database/prisma.service';
import { TournamentPersistenceService } from '@adapters/database/tournament-persistence.service';
import { DoubleElimFormats, TournamentError, TournamentStagesService } from '../tournament-stages.service';
import { fakeGameStats, fakePlayerNames, fakeTeamNames, hashSeed, Random, seededRandom } from './fake-data';

/** A fake tournament, as in test/fixtures/tournaments/*.json */
export interface TournamentScenario {
  name: string;
  game?: string;
  teams: number | string[];
  playersPerTeam?: number;
  stages: { key: string; name: string; type: StageType; order: number; groupCount?: number; format?: MatchFormat; formats?: DoubleElimFormats }[];
  qualify?: { from: string; rules: { ranks: number[]; to: string }[] };
  results?: { mode?: 'seeded'; upsetRate?: number; randomSeed?: number; maps?: string[] };
}

export interface SimulationOptions {
  fixtureName?: string;
  scenario?: TournamentScenario;
  /** pause between two games (ms); 0 = as fast as possible */
  delayMs?: number;
  /** series played at the same time (like several servers) */
  parallel?: number;
  /** fake players and CS2 stats for every game */
  withStats?: boolean;
  /** start paused (then step / resume) */
  paused?: boolean;
}

export interface SimulationRun {
  id: string;
  tournamentId: string;
  name: string;
  status: 'running' | 'paused' | 'done' | 'stopped' | 'error';
  gamesPlayed: number;
  seriesPlayed: number;
  delayMs: number;
  parallel: number;
  withStats: boolean;
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
  /** current step, e.g. "Élite : arbre" */
  phase: string;
}

class Stopped extends Error {}

const WINS: Record<string, number> = { BO1: 1, BO3: 2, BO5: 3 };
const SIM_AUTHOR = 'simulation';

/**
 * Plays fake tournaments for the Sandbox: same JSON scenarios as `make tournament`, deterministic results
 * (better seed usually wins, seeded upsets), optional fake players / CS2 stats, played in accelerated time
 * (games go LIVE, then finish after `delayMs`), several series at once, pause / resume / step / stop.
 * Runs live in memory (dev tool); the tournament itself is regular data, viewable on its pages.
 */
@Injectable()
export class TournamentSimulationService {
  private readonly log = new Logger(TournamentSimulationService.name);
  private readonly runs = new Map<string, SimulationRun & { steps: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly stages: TournamentStagesService,
    private readonly persistence: TournamentPersistenceService,
  ) {}

  /** JSON scenarios available in test/fixtures/tournaments */
  listScenarios(): string[] {
    const dir = this.scenariosDir();
    return dir ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  }

  listRuns(): SimulationRun[] {
    return [...this.runs.values()].map(({ steps, ...run }) => run).sort((a, b) => +b.startedAt - +a.startedAt);
  }

  getRun(id: string): SimulationRun {
    const run = this.runs.get(id);
    if (!run) throw new TournamentError('not_found', `simulation ${id} not found`);
    const { steps, ...out } = run;
    return out;
  }

  /**
   * Creates the tournament (teams, players, stages) and starts playing it in the background. A new run
   * replaces the previous tournaments of the same scenario (and their teams / players).
   */
  async start(opts: SimulationOptions): Promise<SimulationRun> {
    const scenario = opts.scenario ?? this.loadScenario(opts.fixtureName);
    if (!scenario?.name || !scenario.stages?.length) throw new TournamentError('invalid', 'scenario needs a name and stages');

    for (const old of await this.stages.listTournaments()) {
      if (old.name.startsWith(`${scenario.name} `)) await this.stages.deleteTournament(old.id);
    }
    const tournament = await this.stages.createTournament({
      name: `${scenario.name} ${new Date().toLocaleTimeString('fr-FR')}`,
      game: scenario.game,
    });
    const run: SimulationRun & { steps: number } = {
      id: randomUUID(),
      tournamentId: tournament.id,
      name: tournament.name,
      status: opts.paused ? 'paused' : 'running',
      gamesPlayed: 0,
      seriesPlayed: 0,
      delayMs: Math.max(0, Number(opts.delayMs ?? 800)),
      parallel: Math.min(16, Math.max(1, Number(opts.parallel ?? 4))),
      withStats: opts.withStats !== false,
      startedAt: new Date(),
      phase: 'préparation',
      steps: 0,
    };
    this.runs.set(run.id, run);

    this.play(run, scenario).catch((e) => {
      if (e instanceof Stopped) run.status = 'stopped';
      else {
        run.status = 'error';
        run.error = e?.message ?? String(e);
        this.log.error(`[simulation] ${run.name}: ${run.error}`);
      }
      run.finishedAt = new Date();
    });
    return this.getRun(run.id);
  }

  /** pause | resume | step (one more game while paused) | stop */
  control(id: string, action: string): SimulationRun {
    const run = this.runs.get(id);
    if (!run) throw new TournamentError('not_found', `simulation ${id} not found`);
    const active = run.status === 'running' || run.status === 'paused';
    if (!active) throw new TournamentError('conflict', `simulation already ${run.status}`);
    if (action === 'pause') run.status = 'paused';
    else if (action === 'resume') run.status = 'running';
    else if (action === 'step') {
      run.status = 'paused';
      run.steps++;
    } else if (action === 'stop') run.status = 'stopped';
    else throw new TournamentError('invalid', 'action: pause | resume | step | stop');
    return this.getRun(id);
  }

  // ---------------------------------------------------------------------------------------------------------

  private async play(run: SimulationRun & { steps: number }, scenario: TournamentScenario) {
    const names = Array.isArray(scenario.teams) ? scenario.teams : fakeTeamNames(scenario.teams);
    const teams = await this.stages.createTeams(names);
    const seedOf = new Map(teams.map((t, i) => [t.id, i + 1]));
    const playersPerTeam = scenario.playersPerTeam ?? 5;
    const players = run.withStats ? await this.createRosters(run.tournamentId, teams, playersPerTeam) : new Map<string, string[]>();
    await this.prisma.tournament.update({ where: { id: run.tournamentId }, data: { status: 'ACTIVE' } });

    const stageIds: Record<string, string> = {};
    for (const s of scenario.stages) {
      stageIds[s.key] = (await this.stages.createStage(run.tournamentId, { name: s.name, type: s.type, order: s.order })).id;
    }
    const first = Math.min(...scenario.stages.map((s) => s.order));

    for (const s of [...scenario.stages].sort((a, b) => a.order - b.order)) {
      if (s.type === 'ROUND_ROBIN') {
        run.phase = `${s.name} : poules`;
        await this.stages.generateGroups(stageIds[s.key], {
          ...(s.order === first ? { teamIds: teams.map((t) => t.id) } : {}),
          groupCount: s.groupCount ?? 1,
          format: s.format,
        });
      } else {
        run.phase = `${s.name} : arbre`;
        await this.stages.generateDoubleElimination(stageIds[s.key], s.formats ? { formats: s.formats } : {});
      }
      await this.playStage(run, scenario, stageIds[s.key], seedOf, players);

      const q = scenario.qualify;
      if (q?.from === s.key) {
        run.phase = `${s.name} : qualification`;
        const standings = await this.stages.getStandings(stageIds[s.key]);
        // unresolved ties: the displayed order (seed order) is kept, as an admin would
        const manualOrder = Object.fromEntries(
          standings.groups.filter((g) => g.standings.some((r) => r.tied)).map((g) => [g.groupId, g.standings.map((r) => r.teamId)]),
        );
        await this.stages.qualify(stageIds[s.key], {
          rules: q.rules.map((r) => ({ ranks: r.ranks, targetStageId: stageIds[r.to] })),
          manualOrder,
        });
      }
    }
    await this.prisma.tournament.update({ where: { id: run.tournamentId }, data: { status: 'COMPLETED' } });
    run.phase = 'terminé';
    run.status = 'done';
    run.finishedAt = new Date();
    this.log.log(`[simulation] ${run.name}: done (${run.seriesPlayed} series, ${run.gamesPlayed} games)`);
  }

  /** Plays every series of a stage whose two teams are known, `parallel` at a time, until none is left. */
  private async playStage(
    run: SimulationRun & { steps: number },
    scenario: TournamentScenario,
    stageId: string,
    seedOf: Map<string, number>,
    players: Map<string, string[]>,
  ) {
    for (;;) {
      const ready = await this.prisma.match.findMany({
        where: { stageId, status: { not: 'FINISHED' }, teamHomeId: { not: null }, teamAwayId: { not: null } },
        orderBy: [{ bracketType: 'asc' }, { roundNumber: 'asc' }, { bracketPosition: 'asc' }],
        include: { stageRef: { select: { order: true } }, group: { select: { name: true } } },
        take: run.parallel,
      });
      if (!ready.length) return;
      await Promise.all(ready.map((m) => this.playSeries(run, scenario, m, seedOf, players)));
    }
  }

  private async playSeries(
    run: SimulationRun & { steps: number },
    scenario: TournamentScenario,
    match: {
      id: string;
      format: MatchFormat;
      advantageHome: number;
      teamHomeId: string | null;
      teamAwayId: string | null;
      bracketType: string;
      roundNumber: number;
      bracketPosition: number | null;
      stageRef: { order: number } | null;
      group: { name: string } | null;
    },
    seedOf: Map<string, number>,
    players: Map<string, string[]>,
  ) {
    const res = scenario.results ?? {};
    // Own generator per series, seeded by its place in the tournament: results do not depend on the order in
    // which parallel series run (same file = same tournament)
    const rnd = seededRandom(
      hashSeed(res.randomSeed ?? 1, match.stageRef?.order ?? 0, match.group?.name ?? '', match.bracketType, match.roundNumber, match.bracketPosition ?? 0),
    );
    const homeBetter = (seedOf.get(match.teamHomeId!) ?? 0) < (seedOf.get(match.teamAwayId!) ?? 0);
    const needed = WINS[match.format] ?? 1;
    let home = match.advantageHome;
    let away = 0;
    for (let order = 1; home < needed && away < needed; order++) {
      const mapName = (res.maps ?? ['de_mirage'])[Math.floor(rnd() * (res.maps?.length ?? 1))];
      const homeWins = homeBetter !== rnd() < (res.upsetRate ?? 0.25);
      const loserRounds = Math.floor(rnd() * 12);
      const [scoreHome, scoreAway] = homeWins ? [13, loserRounds] : [loserRounds, 13];

      // the game is shown LIVE during the delay
      await this.prisma.matchMap.upsert({
        where: { matchId_mapOrder: { matchId: match.id, mapOrder: order } },
        create: { matchId: match.id, mapOrder: order, mapName, status: 'LIVE', startedAt: new Date() },
        update: { mapName, status: 'LIVE', startedAt: new Date() },
      });
      await this.prisma.match.updateMany({ where: { id: match.id, status: 'PENDING' }, data: { status: 'LIVE' } });
      await this.wait(run);

      const { game } = await this.persistence.recordManualGameResult({
        matchId: match.id, mapOrder: order, scoreHome, scoreAway, mapName, reportedBy: SIM_AUTHOR,
      });
      if (players.size) await this.recordFakeStats(rnd, game.id, match, scoreHome, scoreAway, players);
      run.gamesPlayed++;
      homeWins ? home++ : away++;
    }
    run.seriesPlayed++;
  }

  private async recordFakeStats(
    rnd: Random,
    gameId: string,
    match: { teamHomeId: string | null; teamAwayId: string | null },
    scoreHome: number,
    scoreAway: number,
    players: Map<string, string[]>,
  ) {
    const homePlayers = players.get(match.teamHomeId!) ?? [];
    const awayPlayers = players.get(match.teamAwayId!) ?? [];
    const stats = fakeGameStats(scoreHome, scoreAway, Math.min(homePlayers.length, awayPlayers.length) || 5, rnd);
    const rows = [
      ...homePlayers.map((playerId, i) => ({ playerId, teamId: match.teamHomeId!, ...stats.home[i] })),
      ...awayPlayers.map((playerId, i) => ({ playerId, teamId: match.teamAwayId!, ...stats.away[i] })),
    ].filter((r) => r.kills !== undefined);
    await this.prisma.playerMapStats.createMany({
      data: rows.map((r) => ({
        matchMapId: gameId, playerId: r.playerId, teamId: r.teamId, kills: r.kills, deaths: r.deaths,
        assists: r.assists, headshots: r.headshots, mvps: r.mvps, damageDealt: r.damageDealt, adr: r.adr,
        score: r.kills * 2 + r.assists,
      })),
      skipDuplicates: true,
    });
  }

  /** Fake players (no SteamID) and the tournament rosters. */
  private async createRosters(tournamentId: string, teams: { id: string }[], perTeam: number) {
    const out = new Map<string, string[]>();
    for (const [i, team] of teams.entries()) {
      const created = await this.prisma.$transaction(
        fakePlayerNames(i, perTeam).map((username) => this.prisma.player.create({ data: { username } })),
      );
      await this.prisma.teamRoster.createMany({
        data: created.map((p) => ({ tournamentId, teamId: team.id, playerId: p.id, role: 'STARTER' as const })),
      });
      out.set(team.id, created.map((p) => p.id));
    }
    return out;
  }

  /** Delay between games, honouring pause (wait for resume or a step) and stop. */
  private async wait(run: SimulationRun & { steps: number }) {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (;;) {
      if (run.status === 'stopped') throw new Stopped();
      if (run.status === 'running') break;
      if (run.steps > 0) {
        run.steps--;
        return;
      }
      await sleep(200);
    }
    if (run.delayMs) await sleep(run.delayMs);
    if ((run.status as string) === 'stopped') throw new Stopped();
  }

  private loadScenario(fixtureName?: string): TournamentScenario {
    const dir = this.scenariosDir();
    const name = path.basename(fixtureName ?? '');
    if (!dir || !name || !fs.existsSync(path.join(dir, name))) {
      throw new TournamentError('not_found', `scenario ${fixtureName ?? '(none)'} not found in test/fixtures/tournaments`);
    }
    return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  }

  private scenariosDir(): string | null {
    for (const base of [path.resolve(process.cwd(), 'test/fixtures'), path.resolve(process.cwd(), '../test/fixtures')]) {
      const dir = path.join(base, 'tournaments');
      if (fs.existsSync(dir)) return dir;
    }
    return null;
  }
}
