// src/adapters/http/veto/veto.controller.ts
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Session } from '@app/auth/auth.service';
import { TournamentError } from '@app/tournament/tournament-stages.service';
import { VetoService } from '@app/tournament/veto.service';
import { renderVetoPage } from '@app/tournament/veto-view';
import { actorOf, VetoActions, vetoFirst } from './veto-actions';
import type { VetoBody } from './veto-actions';

type SessionRequest = Request & { ggSession?: Session | null };

/**
 * Rock-paper-scissors + map veto of a match, outside /api (a human page and its forms):
 * - GET  /veto/:matchId            page of the captains (public: spectators follow the veto) - only one's own moves;
 * - GET  /veto/:matchId/admin      admin page: who starts, a step played for a team, undo, reset;
 * - POST /veto/:matchId/rps        { choice: rock | paper | scissors }   captain
 * - POST /veto/:matchId/start      { first: true | false } RPS winner · { teamId } admin (RPS played elsewhere)
 * - POST /veto/:matchId/step       { map } (ban / pick) or { side: CT | T }   captain whose turn it is, or admin
 * - POST /veto/:matchId/undo|reset admin
 * Every action answers the new state as JSON, or redirects to the page for the page's forms (`_form=1`), and is
 * pushed to everyone following the match on the WebSocket (`veto:updated`, room of the series' match).
 * Logged-in players reach the actions (AuthMiddleware); the service checks who is captain of what.
 */
@Controller('veto')
export class VetoController {
  constructor(
    private readonly veto: VetoService,
    private readonly actions: VetoActions,
  ) {}

  @Get(':matchId')
  async page(@Param('matchId') matchId: string, @Query('error') error: string | undefined, @Req() req: SessionRequest, @Res() res: Response) {
    const actor = actorOf(req.ggSession);
    // an admin is read as a plain player here: only its own moves as a captain, the rest is on the admin page
    const view = await this.run(() => this.veto.getState(matchId, actor && { ...actor, admin: false }));
    res.type('html').send(renderVetoPage(view, { mode: 'captain', error, loggedIn: !!actor, isAdmin: !!actor?.admin }));
  }

  /** Admin only (AuthMiddleware). */
  @Get(':matchId/admin')
  async adminPage(@Param('matchId') matchId: string, @Query('error') error: string | undefined, @Req() req: SessionRequest, @Res() res: Response) {
    const view = await this.run(() => this.veto.getState(matchId, actorOf(req.ggSession)));
    res.type('html').send(renderVetoPage(view, { mode: 'admin', error, loggedIn: true }));
  }

  @Post(':matchId/rps')
  rps(@Param('matchId') id: string, @Body() body: VetoBody, @Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    return this.act(id, body, req, res, (actor) => this.veto.playRps(id, actor, body?.choice ?? ''));
  }

  @Post(':matchId/start')
  start(@Param('matchId') id: string, @Body() body: VetoBody, @Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    const first = vetoFirst(body?.first);
    return this.act(id, body, req, res, (actor) => this.veto.chooseStart(id, actor, { first, teamId: body?.teamId }));
  }

  @Post(':matchId/step')
  step(@Param('matchId') id: string, @Body() body: VetoBody, @Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    return this.act(id, body, req, res, (actor) => this.veto.playStep(id, actor, { map: body?.map, side: body?.side }));
  }

  @Post(':matchId/undo')
  undo(@Param('matchId') id: string, @Body() body: VetoBody, @Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    return this.act(id, body, req, res, (actor) => this.veto.undo(id, actor));
  }

  @Post(':matchId/reset')
  reset(@Param('matchId') id: string, @Body() body: VetoBody, @Req() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    return this.act(id, body, req, res, (actor) => this.veto.reset(id, actor));
  }

  private async act(id: string, body: VetoBody, req: SessionRequest, res: Response, fn: Parameters<VetoActions['execute']>[2]) {
    if (body?._form !== '1') {
      return this.actions.execute(id, req.ggSession, fn);
    }
    // Page form: back to the page, the refusal shown on it
    const page = `/veto/${encodeURIComponent(id)}${body._page === 'admin' ? '/admin' : ''}`;
    try {
      await this.actions.execute(id, req.ggSession, fn);
      res.redirect(303, page);
    } catch (e) {
      const reason = e instanceof HttpException ? (e.getResponse() as { message?: unknown })?.message : undefined;
      const message = typeof reason === 'string' ? reason : e instanceof HttpException ? e.message : 'unexpected error';
      res.redirect(303, `${page}?error=${encodeURIComponent(message)}`);
    }
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof TournamentError)) throw e;
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'conflict') throw new ConflictException(e.message);
      if (e.code === 'forbidden') throw new ForbiddenException(e.message);
      throw new BadRequestException(e.message);
    }
  }
}

/** Steam login → captain identity; any admin session (Steam, offline password, token) may act for a team. */
export { actorOf } from './veto-actions';
