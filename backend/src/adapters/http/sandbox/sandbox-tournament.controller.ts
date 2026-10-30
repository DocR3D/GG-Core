// src/adapters/http/sandbox/sandbox-tournament.controller.ts
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { TournamentError } from '@app/tournament/tournament-stages.service';
import { htmlPage } from '@app/shared/html-page';
import {
  SimulationRun,
  TournamentSimulationService,
} from '@app/tournament/simulation/tournament-simulation.service';

const PAGE = '/sandbox/tournament';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Sandbox - simulated tournaments (dev tool): fake teams / players / stats from the JSON scenarios of
 * test/fixtures/tournaments, played in accelerated time. Plain HTML page (forms, no CSS / JS) + JSON API.
 */
@Controller('sandbox/tournament')
export class SandboxTournamentController {
  constructor(private readonly sim: TournamentSimulationService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page() {
    const scenarios = this.sim.listScenarios();
    const runs = this.sim.listRuns();
    const options = scenarios.map((s) => `<option>${esc(s)}</option>`).join('');
    const rows = runs.map((r) => this.row(r)).join('\n');
    const active = runs.some((r) => r.status === 'running' || r.status === 'paused');
    return htmlPage({
      theme: 'admin',
      title: 'Sandbox - tournois simulés',
      refreshSec: active ? 3 : undefined,
      body: `<h1>Sandbox - tournois simulés</h1>
<form method="post" action="${PAGE}/runs">
<input type="hidden" name="_form" value="1">
<fieldset>
<label>Scénario <select name="fixtureName">${options}</select></label>
<label>Délai entre games (ms) <input type="number" name="delayMs" value="800" min="0" step="100"></label>
<label>Séries en parallèle <input type="number" name="parallel" value="4" min="1" max="16"></label>
<label><input type="checkbox" name="withStats" checked> Joueurs et stats CS2 factices</label>
<label><input type="checkbox" name="paused"> Démarrer en pause (pas à pas)</label>
</fieldset>
<button>Lancer la simulation</button>
<p><small>Relancer un scénario remplace son tournoi précédent. Résultats déterministes : même fichier, même tournoi.</small></p>
</form>
<h2>Simulations</h2>
${runs.length ? `<figure><table>\n<thead><tr><th>Tournoi</th><th>État</th><th>Étape</th><th>Séries / games</th><th>Actions</th></tr></thead>\n<tbody>${rows}</tbody>\n</table></figure>` : '<p>Aucune simulation lancée.</p>'}
${active ? '<p><small>Page rafraîchie toutes les 3 s pendant une simulation.</small></p>' : ''}`,
    });
  }

  @Get('scenarios')
  scenarios() {
    return this.sim.listScenarios();
  }

  @Get('runs')
  runs() {
    return this.sim.listRuns();
  }

  @Get('runs/:id')
  run(@Param('id') id: string) {
    return this.wrap(() => this.sim.getRun(id));
  }

  /** JSON: { fixtureName | scenario, delayMs?, parallel?, withStats?, paused? } - or the page's form. */
  @Post('runs')
  async start(@Body() body: Record<string, any>, @Res({ passthrough: true }) res: Response) {
    const form = body?._form === '1';
    const opts = form
      ? {
          fixtureName: body.fixtureName,
          delayMs: Number(body.delayMs),
          parallel: Number(body.parallel),
          withStats: body.withStats === 'on',
          paused: body.paused === 'on',
        }
      : body ?? {};
    const run = await this.wrap(() => this.sim.start(opts));
    if (form) return res.redirect(303, PAGE);
    return run;
  }

  /** pause | resume | step | stop */
  @Post('runs/:id/:action')
  control(@Param('id') id: string, @Param('action') action: string, @Body() body: Record<string, any>, @Res({ passthrough: true }) res: Response) {
    const run = this.wrapSync(() => this.sim.control(id, action));
    if (body?._form === '1') return res.redirect(303, PAGE);
    return run;
  }

  private row(r: SimulationRun) {
    const state = { running: 'en cours', paused: 'en pause', done: 'terminé', stopped: 'arrêté', error: `erreur : ${r.error ?? ''}` }[r.status];
    const button = (action: string, label: string, cls = '') =>
      `<form method="post" action="${PAGE}/runs/${r.id}/${action}"><input type="hidden" name="_form" value="1"><button${cls ? ` class="${cls}"` : ''}>${label}</button></form>`;
    const actions =
      r.status === 'running'
        ? button('pause', 'Pause', 'secondary') + button('stop', 'Arrêter', 'danger')
        : r.status === 'paused'
          ? button('resume', 'Reprendre') + button('step', 'Game suivant', 'secondary') + button('stop', 'Arrêter', 'danger')
          : '';
    const view = `/view/tournaments/${r.tournamentId}`;
    return `<tr><td><a href="${view}?refresh=2">${esc(r.name)}</a><br><a class="gg-meta" href="${view}">sans rafraîchissement</a></td><td>${esc(state)}</td><td>${esc(r.phase)}</td><td>${r.seriesPlayed} / ${r.gamesPlayed}</td><td>${actions}</td></tr>`;
  }

  private async wrap<T>(fn: () => Promise<T> | T): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw this.http(e);
    }
  }

  private wrapSync<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      throw this.http(e);
    }
  }

  private http(e: unknown) {
    if (!(e instanceof TournamentError)) return e;
    if (e.code === 'not_found') return new NotFoundException(e.message);
    if (e.code === 'conflict') return new ConflictException(e.message);
    return new BadRequestException(e.message);
  }
}
