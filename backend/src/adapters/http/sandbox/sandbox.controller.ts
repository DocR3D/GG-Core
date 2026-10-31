// src/adapters/http/sandbox/sandbox.controller.ts
import { Controller, Get, Post, Body, Param, Res, Header, HttpCode, Logger } from '@nestjs/common';
import type { Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { renderSandboxHtml } from './sandbox.html';
import { SandboxService } from '@app/match/sandbox/sandbox.service';
import {
  InjectStateDto,
  InGameRestoreDto,
  ReplayRawLogDto,
  ReplayScenarioDto,
  StartRoundReplayDto,
  StepRoundReplayDto,
} from '@app/match/sandbox/sandbox.dto';

@Controller('sandbox')
export class SandboxController {
  private readonly logger = new Logger(SandboxController.name);
  constructor(private readonly sandboxService: SandboxService) {}

  /**
   * Page web interactive "Match Sandbox / Round Doctor"
   * Accessible directement sur http://<ip>:8081/sandbox
   */
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getSandboxHtml(@Res() res: Response) {
    this.logger.log('[Sandbox] GET /sandbox page chargée');
    const adminToken = jwt.sign(
      { sub: 'sandbox-admin', role: 'admin' },
      process.env.JWT_SECRET || 'dev-change-me',
      { expiresIn: '24h' },
    );
    const html = renderSandboxHtml(adminToken);
    return res.send(html);
  }

  /**
   * Récupère la liste des scénarios prédéfinis
   */
  @Get('presets')
  getPresets() {
    this.logger.log('[Sandbox] GET /sandbox/presets');
    return { ok: true, presets: this.sandboxService.getPresets() };
  }

  /**
   * Récupère l'état courant d'un match
   */
  @Get('state/:matchId')
  async getState(@Param('matchId') matchId: string) {
    this.logger.log(`[Sandbox] GET /sandbox/state/${matchId}`);
    const snapshot = await this.sandboxService.getState(matchId);
    return { ok: true, snapshot };
  }

  /**
   * Injecte directement un état dans Redis & diffuse en WebSocket
   */
  @Post('inject')
  @HttpCode(200)
  async injectState(@Body() body: InjectStateDto) {
    this.logger.log(`[Sandbox] POST /sandbox/inject: ${JSON.stringify(body)}`);
    const snapshot = await this.sandboxService.injectState(body);
    return { ok: true, snapshot };
  }

  /**
   * Génère un backup natif Valve CS2 et l'applique in-game via RCON
   */
  @Post('restore-ingame')
  @HttpCode(200)
  async restoreInGame(@Body() body: InGameRestoreDto) {
    this.logger.log(`[Sandbox] POST /sandbox/restore-ingame: ${JSON.stringify(body)}`);
    const result = await this.sandboxService.restoreInGame(body);
    return result;
  }

  /**
   * Simule un événement team_round_win
   */
  @Post('simulate/round-win')
  @HttpCode(200)
  async simulateRoundWin(
    @Body() body: { matchId: string; serverId: string; winner: 'CT' | 'T' },
  ) {
    return await this.sandboxService.simulateRoundWin(body.matchId, body.serverId, body.winner);
  }

  /**
   * Simule une commande chat (!ready, !pause, !stay, !switch, etc.)
   */
  @Post('simulate/command')
  @HttpCode(200)
  async simulateCommand(
    @Body()
    body: {
      matchId: string;
      serverId: string;
      command: string;
      sender: { name: string; steamId?: string; team: 'CT' | 'T' };
    },
  ) {
    return await this.sandboxService.simulateCommand(
      body.matchId,
      body.serverId,
      body.command,
      body.sender,
    );
  }

  /**
   * Exécute une commande RCON directe sur le serveur CS2
   */
  @Post('rcon')
  @HttpCode(200)
  async executeRcon(
    @Body() body: { serverId: string; command: string; matchId?: string },
  ) {
    this.logger.log(`[Sandbox] POST /sandbox/rcon: ${JSON.stringify(body)}`);
    return await this.sandboxService.executeRcon(body.serverId, body.command, body.matchId);
  }

  /**
   * Retourne la liste des fixtures et fichiers réels disponibles pour le rejeu
   */
  @Get('fixtures')
  getFixtures() {
    this.logger.log('[Sandbox] GET /sandbox/fixtures');
    return { ok: true, fixtures: this.sandboxService.getAvailableFixtures() };
  }

  /**
   * Rejoue un fichier de logs bruts Valve CS2
   */
  @Post('replay/raw-log')
  @HttpCode(200)
  async replayRawLog(@Body() body: ReplayRawLogDto) {
    this.logger.log(`[Sandbox] POST /sandbox/replay/raw-log fixture=${body.fixtureName} speed=${body.speed}`);
    return await this.sandboxService.replayRawLog(body);
  }

  /**
   * Rejoue un scénario complet d'événements structurés JSON
   */
  @Post('replay/scenario')
  @HttpCode(200)
  async replayScenario(@Body() body: ReplayScenarioDto) {
    this.logger.log(`[Sandbox] POST /sandbox/replay/scenario fixture=${body.fixtureName} speed=${body.speed}`);
    return await this.sandboxService.replayScenario(body);
  }

  /**
   * Replay round par round : charge la fixture / le contenu, découpe en rounds, réinitialise le match.
   */
  @Post('replay/rounds/start')
  @HttpCode(200)
  async startRoundByRound(@Body() body: StartRoundReplayDto) {
    this.logger.log(`[Sandbox] POST /sandbox/replay/rounds/start fixture=${body.fixtureName}`);
    return await this.sandboxService.startRoundByRound(body);
  }

  /**
   * Replay round par round : round suivant / précédent / aller au round N.
   */
  @Post('replay/rounds/step')
  @HttpCode(200)
  async stepRoundByRound(@Body() body: StepRoundReplayDto) {
    this.logger.log(`[Sandbox] POST /sandbox/replay/rounds/step ${body.action} ${body.round ?? ''}`);
    return await this.sandboxService.stepRoundByRound(body);
  }

  @Get('replay/rounds/:matchId')
  getRoundByRoundStatus(@Param('matchId') matchId: string) {
    return this.sandboxService.getRoundByRoundStatus(matchId);
  }

} // end of controller
