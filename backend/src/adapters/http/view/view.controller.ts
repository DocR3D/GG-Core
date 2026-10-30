// src/adapters/http/view/view.controller.ts
import { BadRequestException, ConflictException, Controller, Get, Header, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TournamentError, TournamentStagesService } from '@app/tournament/tournament-stages.service';
import { asciiPage, renderMatchDetailHtml, renderTournamentAscii, renderTournamentHtml } from '@app/tournament/tournament-view';
import { htmlPage } from '@app/shared/html-page';

const STATUS_FR: Record<string, string> = { UPCOMING: 'à venir', ACTIVE: 'en cours', COMPLETED: 'terminé', ARCHIVED: 'archivé' };
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Human pages, outside /api (reserved for the JSON API used by services, scripts and the future frontend):
 * plain-text views of tournaments and matches - a <pre> in the shared page skeleton, no JS. The data behind them is
 * GET /api/tournament/tournaments/:id/overview (JSON).
 */
@Controller('view')
export class ViewController {
  constructor(private readonly stages: TournamentStagesService) {}

  /** List of tournaments. */
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  async list() {
    const list = await this.stages.listTournaments();
    const items = list.map(
      (t) => `<li><a href="/view/tournaments/${t.id}">${esc(t.name)}</a> <span class="gg-meta">${esc(t.game)}, ${STATUS_FR[t.status] ?? t.status}</span></li>`,
    );
    return htmlPage({
      title: 'Tournois',
      body: `<h1>Tournois</h1>
${items.length ? `<ul>${items.join('')}</ul>` : '<p>Aucun tournoi pour l’instant.</p>'}`,
    });
  }

  /**
   * A tournament: groups, standings, brackets (trees), matches with their games; every match links to its page.
   * `?refresh=N` reloads every N seconds (to follow a simulation). `/view/tournaments/:id.txt`: same as plain text.
   */
  @Get('tournaments/:id')
  async tournament(@Param('id') idParam: string, @Query('refresh') refresh: string | undefined, @Res({ passthrough: true }) res: Response) {
    const asText = idParam.endsWith('.txt');
    const overview = await this.run(() => this.stages.getOverview(asText ? idParam.slice(0, -4) : idParam));
    if (asText) {
      res.type('text/plain; charset=utf-8');
      return renderTournamentAscii(overview);
    }
    res.type('text/html; charset=utf-8');
    return asciiPage(overview.name, renderTournamentHtml(overview, (id) => `/view/matches/${id}`), true, Number(refresh) || undefined);
  }

  /** A match: series, games, player stats, where its teams come from and where they go (links). */
  @Get('matches/:id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async match(@Param('id') matchId: string) {
    const detail = await this.run(() => this.stages.getMatchDetail(matchId));
    return renderMatchDetailHtml(detail, `/view/tournaments/${detail.tournament.id}`, (id) => `/view/matches/${id}`);
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof TournamentError)) throw e;
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'conflict') throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
  }
}
