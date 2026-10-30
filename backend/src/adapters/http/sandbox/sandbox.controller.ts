// src/adapters/http/sandbox/sandbox.controller.ts
import { Controller, Get, Post, Body, Param, Res, Header, HttpCode, Logger } from '@nestjs/common';
import type { Response } from 'express';
import * as jwt from 'jsonwebtoken';
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
    const html = this.renderSandboxHtml(adminToken);
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

  private renderSandboxHtml(adminToken = ''): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GG-Core Match Sandbox & Round Doctor</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    :root {
      --bg-dark: #0f172a;
      --bg-card: #1e293b;
      --bg-input: #334155;
      --border: #475569;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #f59e0b;
      --accent-hover: #d97706;
      --ct: #38bdf8;
      --ct-bg: rgba(56, 189, 248, 0.15);
      --t: #fb923c;
      --t-bg: rgba(251, 146, 60, 0.15);
      --success: #10b981;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    body { background-color: var(--bg-dark); color: var(--text); padding: 24px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .title-group h1 { font-size: 1.6rem; color: #fff; display: flex; align-items: center; gap: 10px; }
    .badge { background: var(--accent); color: #000; font-size: 0.75rem; font-weight: bold; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; }
    .status-pill { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--text-muted); background: var(--bg-card); padding: 6px 14px; border-radius: 20px; border: 1px solid var(--border); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); }
    
    .presets-title { font-size: 0.95rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 12px; }
    .presets-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .preset-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; cursor: pointer; transition: all 0.2s; position: relative; }
    .preset-card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    .preset-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .preset-name { font-weight: bold; font-size: 0.95rem; color: #fff; }
    .preset-phase { font-size: 0.75rem; background: var(--bg-input); padding: 2px 6px; border-radius: 4px; }
    .preset-desc { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px; }
    .preset-score { font-size: 0.85rem; font-weight: bold; color: var(--accent); }

    .main-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 1024px) { .main-grid { grid-template-columns: 1fr; } }

    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .card-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 8px; color: #fff; display: flex; justify-content: space-between; }
    
    .form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .form-group { display: flex; flex-direction: column; gap: 6px; }
    label { font-size: 0.8rem; font-weight: 500; color: var(--text-muted); text-transform: uppercase; }
    input, select { background: var(--bg-input); border: 1px solid var(--border); color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 0.9rem; outline: none; }
    input:focus, select:focus { border-color: var(--accent); }

    .score-container { display: flex; gap: 16px; margin: 16px 0; }
    .score-box { flex: 1; padding: 14px; border-radius: 8px; text-align: center; border: 1px solid; }
    .score-box.ct { background: var(--ct-bg); border-color: var(--ct); }
    .score-box.t { background: var(--t-bg); border-color: var(--t); }
    .score-box input { font-size: 2rem; font-weight: bold; text-align: center; width: 80px; margin: 8px auto 0 auto; display: block; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 18px; border-radius: 6px; font-size: 0.9rem; font-weight: 600; cursor: pointer; border: none; transition: 0.2s; }
    .btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .btn-accent { background: var(--accent); color: #000; }
    .btn-primary { background: var(--success); color: #fff; }
    .btn-ct { background: var(--ct); color: #000; }
    .btn-t { background: var(--t); color: #000; }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: #fff; }
    .btn-outline:hover { background: var(--bg-input); }

    .action-group { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }

    .terminal { background: #090d16; border: 1px solid #1e293b; border-radius: 6px; padding: 12px; font-family: 'Courier New', Courier, monospace; font-size: 0.85rem; height: 300px; overflow-y: auto; color: #a5f3fc; line-height: 1.5; }
    .terminal .entry { margin-bottom: 6px; word-break: break-word; }
    .terminal .time { color: var(--text-muted); margin-right: 8px; font-size: 0.75rem; }
    .terminal .cmd { color: var(--accent); font-weight: bold; }
    .terminal .success { color: var(--success); }
    .terminal .error { color: var(--danger); }

    .ws-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; padding: 2px 8px; border-radius: 12px; font-weight: 600; border: 1px solid var(--border); }
    .ws-pill.connected { background: rgba(16, 185, 129, 0.15); border-color: #10b981; color: #10b981; }
    .ws-pill.connecting { background: rgba(245, 158, 11, 0.15); border-color: #f59e0b; color: #f59e0b; }
    .ws-pill.disconnected { background: rgba(239, 68, 68, 0.15); border-color: #ef4444; color: #ef4444; }

    .log-filter-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
    .filter-label { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-right: 4px; }
    .filter-btn { background: var(--bg-input); color: var(--text-muted); border: 1px solid var(--border); border-radius: 12px; padding: 2px 10px; font-size: 0.75rem; cursor: pointer; transition: 0.15s; }
    .filter-btn:hover { background: var(--border); color: #fff; }
    .filter-btn.active { background: var(--accent); color: #000; font-weight: bold; border-color: var(--accent); }

    .tag-kill { background: #ef4444; color: #fff; font-size: 0.65rem; font-weight: bold; padding: 1px 5px; border-radius: 3px; margin-right: 6px; }
    .tag-round { background: #10b981; color: #000; font-size: 0.65rem; font-weight: bold; padding: 1px 5px; border-radius: 3px; margin-right: 6px; }
    .tag-score { background: #f59e0b; color: #000; font-size: 0.65rem; font-weight: bold; padding: 1px 5px; border-radius: 3px; margin-right: 6px; }
    .tag-phase { background: #a855f7; color: #fff; font-size: 0.65rem; font-weight: bold; padding: 1px 5px; border-radius: 3px; margin-right: 6px; }
    .tag-bomb { background: #f97316; color: #000; font-size: 0.65rem; font-weight: bold; padding: 1px 5px; border-radius: 3px; margin-right: 6px; }
    .tag-chat { background: #06b6d4; color: #000; font-size: 0.65rem; font-weight: bold; padding: 1px 5px; border-radius: 3px; margin-right: 6px; }
    .tag-system { background: #475569; color: #fff; font-size: 0.65rem; font-weight: bold; padding: 1px 5px; border-radius: 3px; margin-right: 6px; }

    /* Scoreboard TAB CS2 */
    .scoreboard-container { margin-bottom: 24px; }
    .scoreboard-teams { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px; }
    @media (max-width: 900px) { .scoreboard-teams { grid-template-columns: 1fr; } }
    .scoreboard-team-box { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .scoreboard-team-box.ct { border-top: 3px solid var(--ct); }
    .scoreboard-team-box.t { border-top: 3px solid var(--t); }
    .team-box-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(0,0,0,0.25); border-bottom: 1px solid var(--border); }
    .team-title { font-weight: bold; font-size: 0.95rem; display: flex; align-items: center; gap: 8px; }
    .team-score-badge { font-size: 1.1rem; font-weight: 800; padding: 2px 8px; border-radius: 4px; }
    .team-score-badge.ct { background: var(--ct); color: #000; }
    .team-score-badge.t { background: var(--t); color: #000; }

    .sb-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .sb-table th { background: rgba(0,0,0,0.3); color: var(--text-muted); font-weight: 600; text-transform: uppercase; font-size: 0.72rem; padding: 8px 10px; text-align: right; }
    .sb-table th.col-player { text-align: left; }
    .sb-table td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); text-align: right; }
    .sb-table td.col-player { text-align: left; font-weight: 600; color: #fff; }
    .sb-table tr:hover { background: rgba(255,255,255,0.03); }
    .sb-table .val-cash { color: #34d399; font-weight: 600; }
    .sb-table .val-equip { color: #94a3b8; }
    .sb-table .val-score { color: #f59e0b; font-weight: bold; }
    .sb-table .val-hs { color: #38bdf8; font-size: 0.8rem; font-weight: 600; }
    .sb-table .empty-row { text-align: center; color: var(--text-muted); font-style: italic; padding: 16px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <h1>GG-Core Match Sandbox & Round Doctor <span class="badge">LAN-First</span></h1>
      <a href="/sandbox/tournament">Tournois simulés →</a>
    </div>
    <div class="status-pill">
      <span class="dot"></span>
      <span>API & WebSocket Connectés (:8081)</span>
    </div>
  </div>

  <div class="presets-title">⚡ Scénarios Prédéfinis (Presets 1-Clic)</div>
  <div class="presets-grid" id="presets-container">
    <!-- Presets injectés dynamiquement -->
  </div>

  <!-- 🏆 CS2 Live TAB Scoreboard -->
  <div class="scoreboard-container">
    <div class="card" style="margin-bottom: 0;">
      <div class="card-title" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span>🏆 Scoreboard CS2 (Vue TAB Temps Réel)</span>
          <span class="badge" style="background: #3b82f6; color: #fff;">Live CS2</span>
        </div>
        <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: normal;">
          <span id="sbRoundLbl" style="color: var(--accent); font-weight: bold;">Round 1</span> |
          <span id="sbPhaseLbl" style="color: #fff;">LIVE</span>
        </div>
      </div>

      <div class="scoreboard-teams">
        <!-- Home Team Box (Left) -->
        <div class="scoreboard-team-box ct" id="sbHomeBox">
          <div class="team-box-header">
            <div class="team-title" id="sbHomeTitle" style="color: var(--ct);">
              <span id="sbHomeIcon">🛡️</span>
              <span id="sbHomeTeamName">ÉQUIPE 1 (HOME)</span>
              <span class="badge" id="sbHomeSideBadge" style="background: var(--ct); color: #000; font-size: 0.72rem; padding: 1px 6px; border-radius: 4px; font-weight: bold;">CT</span>
            </div>
            <div class="team-score-badge ct" id="sbHomeScore">0</div>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; padding: 4px 10px; margin: 4px 0 8px 0; background: rgba(0,0,0,0.22); border-radius: 4px;">
            <span id="sbHomeWinStreak" style="font-weight: 600; color: #fbbf24; display: none;">🔥 0 W</span>
            <span id="sbHomeLossStreak" style="color: var(--text-muted); display: inline-flex; align-items: center; gap: 5px; margin-left: auto;">
              <span>Loss Bonus :</span>
              <span id="sbHomeLossPips" style="letter-spacing: 2px; color: #ef4444; font-size: 0.85rem;">○○○○○</span>
              <span id="sbHomeLossBonus" style="color: var(--text-muted);">($1,400)</span>
            </span>
          </div>
          <table class="sb-table">
            <thead>
              <tr>
                <th class="col-player">Joueur</th>
                <th>K</th>
                <th>A</th>
                <th>D</th>
                <th>HS%</th>
                <th>Score</th>
                <th>$ Cash</th>
                <th>$ Equip</th>
              </tr>
            </thead>
            <tbody id="sbHomeBody">
              <tr><td colspan="8" class="empty-row">En attente de données joueurs...</td></tr>
            </tbody>
          </table>
        </div>

        <!-- Away Team Box (Right) -->
        <div class="scoreboard-team-box t" id="sbAwayBox">
          <div class="team-box-header">
            <div class="team-title" id="sbAwayTitle" style="color: var(--t);">
              <span id="sbAwayIcon">💣</span>
              <span id="sbAwayTeamName">ÉQUIPE 2 (AWAY)</span>
              <span class="badge" id="sbAwaySideBadge" style="background: var(--t); color: #000; font-size: 0.72rem; padding: 1px 6px; border-radius: 4px; font-weight: bold;">T</span>
            </div>
            <div class="team-score-badge t" id="sbAwayScore">0</div>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; padding: 4px 10px; margin: 4px 0 8px 0; background: rgba(0,0,0,0.22); border-radius: 4px;">
            <span id="sbAwayWinStreak" style="font-weight: 600; color: #fbbf24; display: none;">🔥 0 W</span>
            <span id="sbAwayLossStreak" style="color: var(--text-muted); display: inline-flex; align-items: center; gap: 5px; margin-left: auto;">
              <span>Loss Bonus :</span>
              <span id="sbAwayLossPips" style="letter-spacing: 2px; color: #ef4444; font-size: 0.85rem;">○○○○○</span>
              <span id="sbAwayLossBonus" style="color: var(--text-muted);">($1,400)</span>
            </span>
          </div>
          <table class="sb-table">
            <thead>
              <tr>
                <th class="col-player">Joueur</th>
                <th>K</th>
                <th>A</th>
                <th>D</th>
                <th>HS%</th>
                <th>Score</th>
                <th>$ Cash</th>
                <th>$ Equip</th>
              </tr>
            </thead>
            <tbody id="sbAwayBody">
              <tr><td colspan="8" class="empty-row">En attente de données joueurs...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <div class="main-grid">
    <!-- Colonne Gauche : Configuration du Match & État -->
    <div>
      <div class="card">
        <div class="card-title">
          <span>Paramètres du Match & Roster Joueur</span>
          <button class="btn btn-outline" style="padding: 4px 10px; font-size: 0.75rem;" onclick="refreshState()">Rafraîchir État</button>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Server ID (Agent RCON)</label>
            <input type="text" id="serverId" value="srv-a">
          </div>
          <div class="form-group">
            <label>Match ID</label>
            <input type="text" id="matchId" value="m-sandbox-1">
          </div>
          <div class="form-group">
            <label>Carte (Map)</label>
            <select id="map">
              <option value="de_mirage">de_mirage</option>
              <option value="de_inferno" selected>de_inferno</option>
              <option value="de_dust2">de_dust2</option>
              <option value="de_anubis">de_anubis</option>
              <option value="de_nuke">de_nuke</option>
              <option value="de_ancient">de_ancient</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Phase Globale (MatchPhase)</label>
            <select id="phase">
              <option value="warmup_knife">warmup_knife</option>
              <option value="warmup_main">warmup_main</option>
              <option value="knife_live">knife_live</option>
              <option value="knife_choice">knife_choice</option>
              <option value="live_main" selected>live_main</option>
              <option value="halftime">halftime</option>
              <option value="overtime">overtime</option>
              <option value="postgame">postgame</option>
            </select>
          </div>
          <div class="form-group">
            <label>État Calculé (depuis les scores)</label>
            <div id="computedStatusBadge" style="background: var(--bg-input); border: 1px solid var(--border); padding: 8px 14px; border-radius: 6px; font-size: 0.85rem; color: var(--accent); display: flex; align-items: center; justify-content: space-around;">
              <span>Round : <strong id="lblRound" style="color: #fff; font-size: 1rem;">11</strong></span>
              <span style="color: var(--border);">|</span>
              <span id="lblHalftime" style="color: var(--text-muted);">1ère Mi-temps</span>
              <span style="color: var(--border);">|</span>
              <span id="lblOvertime" style="color: var(--text-muted);">Réglementaire</span>
            </div>
          </div>
        </div>

        <div class="score-container">
          <div class="score-box ct">
            <div style="font-weight: bold; color: var(--ct);">SCORE CT</div>
            <input type="number" id="scoreCt" value="6" min="0">
          </div>
          <div class="score-box t">
            <div style="font-weight: bold; color: var(--t);">SCORE T</div>
            <input type="number" id="scoreT" value="5" min="0">
          </div>
        </div>

        <!-- Joueur de Test / Connexion In-Game -->
        <div style="margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--border);">
          <label style="color: var(--accent); margin-bottom: 8px; display: block;">🎮 Joueur Cobaye / In-Game Tester</label>
          <div class="form-row">
            <div class="form-group">
              <label>SteamID (AccountID ou SteamID64)</label>
              <input type="text" id="playerSteamId" value="32976386">
            </div>
            <div class="form-group">
              <label>Pseudo In-Game</label>
              <input type="text" id="playerName" value="DocR3D">
            </div>
            <div class="form-group">
              <label>Side Joueur</label>
              <select id="playerSide">
                <option value="CT" selected>CT</option>
                <option value="T">T</option>
              </select>
            </div>
            <div class="form-group">
              <label>Économie ($ Cash)</label>
              <select id="playerCash">
                <option value="16000" selected>$16,000 (Max / OT)</option>
                <option value="10000">$10,000 (Overtime Start)</option>
                <option value="4000">$4,000 (Buy Standard)</option>
                <option value="800">$800 (Pistol Round)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Actions Principales -->
        <div style="margin-top: 10px;">
          <button class="btn" style="width: 100%; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #fff; font-size: 1.05rem; font-weight: bold; padding: 14px; margin-bottom: 10px; border: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);" onclick="applyEverywhere()">
            🚀 1-CLIC : APPLIQUER PARTOUT (GG-Core + CS2 In-Game)
          </button>
          <div class="action-group">
            <button class="btn btn-primary" style="flex: 1;" onclick="injectState()">⚡ Injecter GG-Core (Redis/WS seul)</button>
            <button class="btn btn-accent" style="flex: 1;" onclick="restoreInGame()">🎮 Restaurer In-Game (RCON seul)</button>
          </div>
        </div>
      </div>

      <!-- Card Replay de Match Réel -->
      <div class="card" style="border-color: #6366f1;">
        <div class="card-title" style="color: #a5b4fc;">
          <span>🎞️ Replay de Match Réel (.log Valve / Scénario JSON)</span>
          <span class="badge" style="background: #6366f1; color: #fff;">End-to-End</span>
        </div>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 14px;">
          Rejoue un match complet depuis un fichier de logs bruts Valve CS2 ou un scénario. L'Agent Go et le moteur de règles réagissent comme en direct LAN !
        </p>

        <div class="form-row">
          <div class="form-group" style="flex: 2;">
            <label>Match LAN Archivé (Fixtures)</label>
            <select id="fixtureSelect" onchange="onFixtureSelected()">
              <option value="">-- Chargement des matchs archivés... --</option>
            </select>
          </div>
          <div class="form-group" style="flex: 1;">
            <label>Vitesse</label>
            <select id="replaySpeed">
              <option value="fast" selected>🚀 Accéléré (x10)</option>
              <option value="instant">⚡ Instantané (Stress Test)</option>
              <option value="realtime">⏱️ Temps Réel</option>
              <option value="rounds">🎯 Round par round</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom: 14px; padding: 10px 14px; background: var(--bg-input); border-radius: 6px; border: 1px dashed var(--border);">
          <label style="display: block; margin-bottom: 6px; color: var(--accent); font-size: 0.8rem;">OU Charger son propre fichier (.log, .txt, .json)</label>
          <input type="file" id="fileUpload" accept=".log,.txt,.json" style="width: 100%; cursor: pointer;" onchange="onFileUploaded(event)">
          <div id="fileInfo" style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;"></div>
        </div>

        <div class="action-group">
          <button class="btn" id="btnStartReplay" style="flex: 1; background: #6366f1; color: #fff;" onclick="startReplay()">▶️ Lancer la Simulation</button>
        </div>

        <!-- Barre de navigation du replay round par round -->
        <div id="roundReplayBar" style="display: none; margin-top: 12px; padding: 10px 14px; background: var(--bg-input); border-radius: 6px; border: 1px solid #6366f1;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <button class="btn" id="btnRoundPrev" onclick="stepRound('prev')">⏮ Round précédent</button>
            <div style="flex: 1; min-width: 160px; text-align: center;">
              <div id="roundReplayLabel" style="font-weight: 600;">Round 0 / 0</div>
              <div id="roundReplayDetail" style="font-size: 0.8rem; color: var(--text-muted);">Aucun round joué</div>
            </div>
            <button class="btn" id="btnRoundNext" style="background: #6366f1; color: #fff;" onclick="stepRound('next')">Round suivant ⏭</button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
            <label style="font-size: 0.8rem; color: var(--text-muted);">Aller au round</label>
            <select id="roundReplaySelect" style="flex: 1;"></select>
            <button class="btn" onclick="stepRound('goto', Number(document.getElementById('roundReplaySelect').value))">Aller</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Colonne Droite : Simulation & Console Directe -->
    <div>
      <div class="card">
        <div class="card-title">Simulateur d'Événements Match (Trigger En Direct)</div>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">
          Simule les événements de fin de round ou les commandes du chat in-game comme si le serveur CS2 venait de les émettre :
        </p>

        <div style="margin-bottom: 14px;">
          <label style="margin-bottom: 6px; display: block;">Victoire de Round</label>
          <div class="action-group">
            <button class="btn btn-ct" onclick="simulateWin('CT')">🏆 Simuler Victoire CT</button>
            <button class="btn btn-t" onclick="simulateWin('T')">💣 Simuler Victoire T</button>
          </div>
        </div>

        <div style="margin-bottom: 14px;">
          <label style="margin-bottom: 6px; display: block;">Commandes Joueur In-Game (Chat !cmd)</label>
          <div class="action-group">
            <button class="btn btn-outline" style="border-color: var(--ct); color: var(--ct);" onclick="simulateCmd('!ready', 'CT')">💬 !ready (CT)</button>
            <button class="btn btn-outline" style="border-color: var(--t); color: var(--t);" onclick="simulateCmd('!ready', 'T')">💬 !ready (T)</button>
            <button class="btn btn-outline" onclick="simulateCmd('!pause')">⏸️ !pause</button>
            <button class="btn btn-outline" onclick="simulateCmd('!unpause')">▶️ !unpause</button>
            <button class="btn btn-outline" onclick="simulateCmd('!stay')">🛡️ !stay</button>
            <button class="btn btn-outline" onclick="simulateCmd('!switch')">🔀 !switch</button>
          </div>
        </div>

        <div style="margin-bottom: 14px;">
          <label style="margin-bottom: 6px; display: block; color: var(--accent);">🛠️ Contrôles Directs RCON Serveur CS2</label>
          <div class="action-group">
            <button class="btn btn-outline" style="border-color: var(--success); color: var(--success);" onclick="sendRcon('mp_unpause_match; unpause')">▶️ Unpause</button>
            <button class="btn btn-outline" style="border-color: #38bdf8; color: #38bdf8;" onclick="sendRcon('exec warmup.cfg; mp_warmup_start 1; mp_warmuptime 999999; mp_warmup_pausetimer 1')">🔥 Start Warmup</button>
            <button class="btn btn-outline" style="border-color: #f59e0b; color: #f59e0b;" onclick="sendRcon('exec knife.cfg')">🔪 Start Knife Round</button>
            <button class="btn btn-outline" style="border-color: var(--t); color: var(--t);" onclick="sendRcon('mp_warmup_end 1')">⏹️ End Warmup</button>
            <button class="btn btn-outline" onclick="sendRcon('status')">ℹ️ CS2 Status</button>
            <button class="btn btn-outline" onclick="sendRcon('bot_quota 2; bot_quota_mode fill')">👥 Fix Bots 1v1</button>
            <button class="btn btn-outline" style="border-color: var(--accent); color: var(--accent);" onclick="sendRconMap()">🗺️ Reload Map</button>
          </div>
        </div>

        <div style="margin-bottom: 14px;">
          <label style="margin-bottom: 6px; display: block;">Envoyer Commande RCON Personnalisée</label>
          <div style="display: flex; gap: 8px;">
            <input type="text" id="customRcon" placeholder="ex: status, bot_add, mp_freezetime 5" style="flex: 1;" onkeydown="if(event.key==='Enter') sendCustomRcon()">
            <button class="btn btn-outline" onclick="sendCustomRcon()">Envoyer</button>
          </div>
        </div>

        <div style="margin-top: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <label style="margin: 0;">Console & Flux WebSocket Temps Réel</label>
              <span id="wsStatusPill" class="ws-pill connecting">● Connexion WS...</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <label style="font-size: 0.75rem; text-transform: none; margin: 0; color: var(--text-muted); display: flex; align-items: center; gap: 4px; cursor: pointer;">
                <input type="checkbox" id="chkAutoSync" checked style="cursor: pointer;"> Auto-Sync Live
              </label>
              <button class="btn btn-outline" style="padding: 2px 8px; font-size: 0.75rem;" onclick="clearLogs()">Effacer</button>
            </div>
          </div>

          <!-- Filtres de log par catégorie -->
          <div class="log-filter-bar">
            <span class="filter-label">Filtre :</span>
            <button class="filter-btn active" data-filter="all" onclick="setLogFilter('all')">Tous (Debug)</button>
            <button class="filter-btn" data-filter="match" onclick="setLogFilter('match')">Match (Rounds/Scores)</button>
            <button class="filter-btn" data-filter="combat" onclick="setLogFilter('combat')">Combat (Kills/Bomb)</button>
            <button class="filter-btn" data-filter="chat" onclick="setLogFilter('chat')">Chat & Cmds</button>
            <button class="filter-btn" data-filter="system" onclick="setLogFilter('system')">Système & RCON</button>
          </div>

          <div class="terminal" id="terminal">
            <div class="entry" data-cat="system"><span class="time">[INIT]</span> <span class="tag-system">SYSTEM</span> <span class="success">Match Sandbox & Round Doctor prêt. Choisis un preset ou configure les champs.</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const WS_ADMIN_TOKEN = '${adminToken}';
    let activePresets = [];
    let currentSocket = null;
    let currentLogFilter = 'all';

    async function loadPresets() {
      try {
        const res = await fetch('/sandbox/presets');
        const data = await res.json();
        if (data.ok && data.presets) {
          activePresets = data.presets;
          renderPresets(activePresets);
        }
      } catch (err) {
        log('error', 'Erreur lors du chargement des presets: ' + err.message);
      }
    }

    function renderPresets(presets) {
      const c = document.getElementById('presets-container');
      c.innerHTML = '';
      presets.forEach(p => {
        const el = document.createElement('div');
        el.className = 'preset-card';
        el.onclick = () => applyPreset(p);
        el.innerHTML = \`
          <div class="preset-header">
            <span class="preset-name">\${p.name}</span>
            <span class="preset-phase">\${p.phase}</span>
          </div>
          <div class="preset-desc">\${p.description}</div>
          <div class="preset-score">Round \${p.round} | Score: CT \${p.score.ct} - \${p.score.t} T (OT:\${p.overtimeCount})</div>
        \`;
        c.appendChild(el);
      });
    }

    function applyPreset(p) {
      document.getElementById('phase').value = p.phase;
      document.getElementById('scoreCt').value = p.score.ct;
      document.getElementById('scoreT').value = p.score.t;
      updateComputedFields();
      log('cmd', 'Preset chargé : ' + p.name + ' -> ' + p.suggestedTest);
    }

    function updateComputedFields() {
      const ct = parseInt(document.getElementById('scoreCt').value, 10) || 0;
      const t = parseInt(document.getElementById('scoreT').value, 10) || 0;
      const round = ct + t;

      const lblRound = document.getElementById('lblRound');
      const lblHalftime = document.getElementById('lblHalftime');
      const lblOvertime = document.getElementById('lblOvertime');
      const phaseEl = document.getElementById('phase');

      if (lblRound) lblRound.textContent = round;
      if (lblHalftime) {
        lblHalftime.textContent = round > 12 ? '2ème Mi-temps (Swap)' : '1ère Mi-temps';
        lblHalftime.style.color = round > 12 ? '#38bdf8' : 'var(--text-muted)';
      }
      if (lblOvertime) {
        if (round > 24) {
          const otCount = Math.max(1, Math.floor((round - 25) / 6) + 1);
          lblOvertime.textContent = 'Overtime #' + otCount;
          lblOvertime.style.color = 'var(--accent)';
          if (phaseEl && phaseEl.value === 'live_main') {
            phaseEl.value = 'overtime';
          }
        } else {
          lblOvertime.textContent = 'Réglementaire';
          lblOvertime.style.color = 'var(--text-muted)';
        }
      }
    }

    function getFormData() {
      const matchId = document.getElementById('matchId').value.trim();
      const serverId = document.getElementById('serverId').value.trim();
      const map = document.getElementById('map').value;
      const scoreCt = parseInt(document.getElementById('scoreCt').value, 10) || 0;
      const scoreT = parseInt(document.getElementById('scoreT').value, 10) || 0;
      const round = scoreCt + scoreT;
      const halftimePlayed = round > 12;
      const overtimeCount = round > 24 ? Math.max(1, Math.floor((round - 25) / 6) + 1) : 0;
      let phase = document.getElementById('phase').value;
      if (round > 24 && phase === 'live_main') {
        phase = 'overtime';
      }

      const steamId = document.getElementById('playerSteamId').value.trim();
      const name = document.getElementById('playerName').value.trim();
      const side = document.getElementById('playerSide').value;
      const cash = parseInt(document.getElementById('playerCash').value, 10) || 16000;

      return {
        matchId, serverId, map, phase, round, scoreCt, scoreT, halftimePlayed, overtimeCount,
        player: { steamId, name, side, cash }
      };
    }

    async function injectState() {
      const d = getFormData();
      log('time', 'Injection état dans Redis pour match ' + d.matchId + '...');

      try {
        const payload = {
          matchId: d.matchId,
          serverId: d.serverId,
          phase: d.phase,
          roundPhase: 'live',
          score: { ct: d.scoreCt, t: d.scoreT, round: d.round },
          sides: (d.halftimePlayed ? { home: 'T', away: 'CT' } : { home: 'CT', away: 'T' }),
          halftimePlayed: d.halftimePlayed,
          overtimeCount: d.overtimeCount,
          lastScoredRound: d.round,
          players: [
            {
              steamId: d.player.steamId,
              name: d.player.name,
              side: d.player.side,
              cash: d.player.cash,
            }
          ]
        };

        const res = await fetch('/sandbox/inject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.ok) {
          log('success', '✅ État injecté avec succès ! Scoreboard et WebSockets mis à jour.');
        } else {
          log('error', 'Erreur injection: ' + JSON.stringify(data));
        }
      } catch (err) {
        log('error', 'Erreur réseau: ' + err.message);
      }
    }

    async function restoreInGame() {
      const d = getFormData();
      log('time', 'Génération backup Valve et commande RCON vers ' + d.serverId + '...');

      try {
        const isCt = d.player.side === 'CT';
        const playerObj = {
          steamId: d.player.steamId,
          name: d.player.name,
          cash: d.player.cash,
          roundsWon: isCt ? d.scoreCt : d.scoreT
        };

        const payload = {
          matchId: d.matchId,
          serverId: d.serverId,
          phase: d.phase,
          round: d.round,
          scoreCt: d.scoreCt,
          scoreT: d.scoreT,
          scoreTeam1: d.scoreCt,
          scoreTeam2: d.scoreT,
          map: d.map,
          playersCt: isCt ? [playerObj] : [],
          playersT: !isCt ? [playerObj] : [],
          applyViaRcon: true
        };

        const res = await fetch('/sandbox/restore-ingame', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.ok) {
          log('success', '🎮 Backup généré : ' + data.backupFileName);
          log('cmd', 'RCON exécuté : ' + data.rconCommand);
          log('time', 'Restauré in-game pour ' + d.player.name + ' (' + d.player.side + ') avec score ' + d.scoreCt + ' - ' + d.scoreT);
        } else {
          log('error', 'Erreur restore in-game: ' + JSON.stringify(data));
        }
      } catch (err) {
        log('error', 'Erreur restore: ' + err.message);
      }
    }

    async function simulateWin(winner) {
      const d = getFormData();
      log('cmd', 'Envoi team_round_win (' + winner + ') pour ' + d.matchId + '...');

      try {
        const res = await fetch('/sandbox/simulate/round-win', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchId: d.matchId, serverId: d.serverId, winner })
        });
        const data = await res.json();
        if (data.ok) {
          log('success', 'Victoire de round ' + winner + ' transmise au bus.');
          setTimeout(refreshState, 500);
        }
      } catch (err) {
        log('error', 'Erreur: ' + err.message);
      }
    }

    async function applyEverywhere() {
      const d = getFormData();
      log('time', '🚀 1-Clic : Application partout (GG-Core + CS2 In-Game) pour ' + d.matchId + '...');
      await restoreInGame();
      setTimeout(refreshState, 600);
    }

    async function simulateCmd(cmd, teamOverride) {
      const d = getFormData();
      const side = teamOverride || d.player.side;
      const senderName = teamOverride ? ('Capitaine_' + teamOverride) : d.player.name;
      const steamId = teamOverride === 'T' ? '76561198000000002' : (teamOverride === 'CT' ? '76561198000000001' : d.player.steamId);
      log('cmd', 'Envoi commande chat ' + cmd + ' par ' + senderName + ' (' + side + ')...');

      try {
        const res = await fetch('/sandbox/simulate/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matchId: d.matchId,
            serverId: d.serverId,
            command: cmd,
            sender: { name: senderName, steamId: steamId, team: side }
          })
        });
        const data = await res.json();
        if (data.ok) {
          log('success', 'Commande ' + cmd + ' traitée pour équipe ' + side + '.');
          setTimeout(refreshState, 500);
        }
      } catch (err) {
        log('error', 'Erreur: ' + err.message);
      }
    }

    async function sendRcon(cmd) {
      const d = getFormData();
      log('cmd', 'RCON direct -> ' + cmd);
      try {
        const res = await fetch('/sandbox/rcon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverId: d.serverId, matchId: d.matchId, command: cmd })
        });
        const data = await res.json();
        if (data.ok) {
          log('success', 'RCON exécuté avec succès : ' + cmd);
        } else {
          log('error', 'Échec RCON: ' + JSON.stringify(data));
        }
      } catch (err) {
        log('error', 'Erreur RCON: ' + err.message);
      }
    }

    function sendRconMap() {
      const map = document.getElementById('map').value;
      sendRcon('changelevel ' + map);
    }

    function sendCustomRcon() {
      const input = document.getElementById('customRcon');
      const val = input.value.trim();
      if (!val) return;
      sendRcon(val);
      input.value = '';
    }

    let availableFixtures = [];
    let uploadedFileContent = null;
    let uploadedFileName = '';

    async function loadFixtures() {
      try {
        const res = await fetch('/sandbox/fixtures');
        const data = await res.json();
        if (data.ok && data.fixtures) {
          availableFixtures = data.fixtures;
          const sel = document.getElementById('fixtureSelect');
          if (!sel) return;
          sel.innerHTML = '<option value="">-- Choisir un match archivé --</option>';
          const rawGroup = document.createElement('optgroup');
          rawGroup.label = '📄 Logs Bruts Valve CS2 (.log)';
          const scGroup = document.createElement('optgroup');
          scGroup.label = '📦 Scénarios Structurés JSON (.json)';

          data.fixtures.forEach(function(f) {
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.dataset.type = f.type;
            const sizeStr = f.sizeBytes ? (' (' + Math.round(f.sizeBytes / 1024) + ' KB)') : '';
            opt.textContent = (f.type === 'raw-log' ? '📄 ' : '📦 ') + f.name + sizeStr;
            if (f.type === 'raw-log') {
              rawGroup.appendChild(opt);
            } else {
              scGroup.appendChild(opt);
            }
          });
          if (rawGroup.children.length > 0) sel.appendChild(rawGroup);
          if (scGroup.children.length > 0) sel.appendChild(scGroup);
        }
      } catch (err) {
        log('error', 'Erreur chargement fixtures: ' + err.message);
      }
    }

    function onFixtureSelected() {
      const sel = document.getElementById('fixtureSelect');
      const val = sel.value;
      const fileInput = document.getElementById('fileUpload');
      const fileInfo = document.getElementById('fileInfo');
      if (val) {
        uploadedFileContent = null;
        uploadedFileName = '';
        if (fileInput) fileInput.value = '';
        const f = availableFixtures.find(function(x) { return x.id === val; });
        if (fileInfo && f) fileInfo.textContent = 'Fixture sélectionnée : ' + f.description;
      } else {
        if (fileInfo) fileInfo.textContent = '';
      }
    }

    function onFileUploaded(e) {
      const file = e.target.files[0];
      const fileInfo = document.getElementById('fileInfo');
      const sel = document.getElementById('fixtureSelect');
      if (!file) return;
      uploadedFileName = file.name;
      if (sel) sel.value = '';

      const reader = new FileReader();
      reader.onload = function(evt) {
        uploadedFileContent = evt.target.result;
        if (fileInfo) fileInfo.textContent = 'Fichier chargé : ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB)';
        log('cmd', 'Fichier ' + file.name + ' prêt pour simulation (' + Math.round(file.size / 1024) + ' KB)');
      };
      reader.readAsText(file);
    }

    let localScoreboard = { home: [], away: [] };
    let localSides = { home: 'CT', away: 'T' };
    let localScore = { ct: 0, t: 0, round: 1 };
    let localTeams = { home_name: '', away_name: '', ct_name: 'CT', t_name: 'T' };
    let localPhase = 'LIVE';
    let localStreaks = { home: { win: 0, loss: 0 }, away: { win: 0, loss: 0 } };

    const LOSS_BONUS_TIERS = [1400, 1900, 2400, 2900, 3400];
    function formatLossPips(loss) {
      const count = Math.min(Math.max(loss || 0, 0), 5);
      return '●'.repeat(count) + '○'.repeat(5 - count);
    }
    function formatLossBonus(loss) {
      const s = Math.max(loss || 0, 0);
      const idx = s <= 0 ? 0 : Math.min(s, LOSS_BONUS_TIERS.length) - 1;
      return '($' + LOSS_BONUS_TIERS[idx].toLocaleString() + ')';
    }

    function getOrAddLocalPlayer(ref, defaultSide) {
      if (!ref) return null;
      const name = (typeof ref === 'string') ? ref : (ref.name || ref.playerName || ref.steamId || '');
      if (!name || name === 'world' || name === 'console' || name === 'Inconnu' || name === 'Suicide' || name === 'SourceTV' || name.startsWith('de_') || name.startsWith('cs_')) return null;

      const steamId = (typeof ref === 'object' && ref.steamId) ? ref.steamId : (ref.id || name);
      if (steamId === 'BOT') return null;
      let rawSide = (typeof ref === 'object' && ref.team ? ref.team : (defaultSide || localSides.home)).toUpperCase();
      if (rawSide === 'SPECTATOR' || rawSide === 'UNASSIGNED') return null;
      const side = (rawSide === 'T' || rawSide === 'TERRORIST') ? 'T' : 'CT';

      let p = localScoreboard.home.find(x => (steamId && x.steamId === steamId) || x.name === name);
      let logical = 'home';
      if (!p) {
        p = localScoreboard.away.find(x => (steamId && x.steamId === steamId) || x.name === name);
        if (p) logical = 'away';
      }

      if (!p) {
        logical = (side === localSides.home) ? 'home' : 'away';
        p = {
          steamId: steamId,
          name: name,
          logical: logical,
          side: side,
          kills: 0,
          deaths: 0,
          assists: 0,
          headshots: 0,
          hsPercent: 0,
          score: 0,
          money: 0,
          equip: 0,
        };
        localScoreboard[logical].push(p);
      } else {
        p.side = side;
      }
      return p;
    }

    function updateScoreboardUI() {
      const sortFn = (a, b) => ((b.score ?? 0) - (a.score ?? 0)) || ((b.kills ?? 0) - (a.kills ?? 0));
      localScoreboard.home.sort(sortFn);
      localScoreboard.away.sort(sortFn);

      const homeIsCt = (localSides.home === 'CT');
      const awayIsCt = (localSides.away === 'CT');

      const scoreHome = homeIsCt ? (localScore.ct ?? 0) : (localScore.t ?? 0);
      const scoreAway = awayIsCt ? (localScore.ct ?? 0) : (localScore.t ?? 0);

      let homeName = localTeams.home_name;
      let awayName = localTeams.away_name;
      if (!homeName && localScoreboard.home.length > 0) {
        const first = localScoreboard.home[0].name || '';
        const tag = first.includes('_') ? first.split('_')[0] : (first.includes(' ') ? first.split(' ')[0] : '');
        if (tag && tag.length >= 3) homeName = tag;
      }
      if (!awayName && localScoreboard.away.length > 0) {
        const first = localScoreboard.away[0].name || '';
        const tag = first.includes('_') ? first.split('_')[0] : (first.includes(' ') ? first.split(' ')[0] : '');
        if (tag && tag.length >= 3) awayName = tag;
      }
      homeName = homeName || (homeIsCt ? (localTeams.ct_name || 'ÉQUIPE 1') : (localTeams.t_name || 'ÉQUIPE 1'));
      awayName = awayName || (awayIsCt ? (localTeams.ct_name || 'ÉQUIPE 2') : (localTeams.t_name || 'ÉQUIPE 2'));

      // 1. Box Home (Gauche)
      const homeBox = document.getElementById('sbHomeBox');
      const homeSideBadge = document.getElementById('sbHomeSideBadge');
      const homeTitle = document.getElementById('sbHomeTitle');
      const homeIcon = document.getElementById('sbHomeIcon');
      const homeScore = document.getElementById('sbHomeScore');
      const homeTeamName = document.getElementById('sbHomeTeamName');

      if (homeBox) homeBox.className = 'scoreboard-team-box ' + (homeIsCt ? 'ct' : 't');
      if (homeScore) {
        homeScore.className = 'team-score-badge ' + (homeIsCt ? 'ct' : 't');
        homeScore.textContent = scoreHome;
      }
      if (homeTitle) homeTitle.style.color = homeIsCt ? 'var(--ct)' : 'var(--t)';
      if (homeIcon) homeIcon.textContent = homeIsCt ? '🛡️' : '💣';
      if (homeTeamName) homeTeamName.textContent = homeName.toUpperCase();
      if (homeSideBadge) {
        homeSideBadge.style.background = homeIsCt ? 'var(--ct)' : 'var(--t)';
        homeSideBadge.textContent = homeIsCt ? 'CT' : 'T';
      }

      // 2. Box Away (Droite)
      const awayBox = document.getElementById('sbAwayBox');
      const awaySideBadge = document.getElementById('sbAwaySideBadge');
      const awayTitle = document.getElementById('sbAwayTitle');
      const awayIcon = document.getElementById('sbAwayIcon');
      const awayScore = document.getElementById('sbAwayScore');
      const awayTeamName = document.getElementById('sbAwayTeamName');

      if (awayBox) awayBox.className = 'scoreboard-team-box ' + (awayIsCt ? 'ct' : 't');
      if (awayScore) {
        awayScore.className = 'team-score-badge ' + (awayIsCt ? 'ct' : 't');
        awayScore.textContent = scoreAway;
      }
      if (awayTitle) awayTitle.style.color = awayIsCt ? 'var(--ct)' : 'var(--t)';
      if (awayIcon) awayIcon.textContent = awayIsCt ? '🛡️' : '💣';
      if (awayTeamName) awayTeamName.textContent = awayName.toUpperCase();
      if (awaySideBadge) {
        awaySideBadge.style.background = awayIsCt ? 'var(--ct)' : 'var(--t)';
        awaySideBadge.textContent = awayIsCt ? 'CT' : 'T';
      }

      // 3. Round & Phase
      if (document.getElementById('sbRoundLbl')) document.getElementById('sbRoundLbl').textContent = 'Round ' + (localScore.round ?? 1);
      if (document.getElementById('sbPhaseLbl')) document.getElementById('sbPhaseLbl').textContent = String(localPhase).toUpperCase();

      // 4. Streaks & Loss Bonus Home
      const homeWinEl = document.getElementById('sbHomeWinStreak');
      const homePipsEl = document.getElementById('sbHomeLossPips');
      const homeBonusEl = document.getElementById('sbHomeLossBonus');
      if (homeWinEl) {
        if (localStreaks.home.win >= 2) {
          homeWinEl.textContent = '🔥 ' + localStreaks.home.win + ' W';
          homeWinEl.style.display = 'inline-block';
        } else if (localStreaks.home.win === 1) {
          homeWinEl.textContent = '⚡ 1 W';
          homeWinEl.style.display = 'inline-block';
        } else {
          homeWinEl.style.display = 'none';
        }
      }
      if (homePipsEl) homePipsEl.textContent = formatLossPips(localStreaks.home.loss);
      if (homeBonusEl) homeBonusEl.textContent = formatLossBonus(localStreaks.home.loss);

      // 5. Streaks & Loss Bonus Away
      const awayWinEl = document.getElementById('sbAwayWinStreak');
      const awayPipsEl = document.getElementById('sbAwayLossPips');
      const awayBonusEl = document.getElementById('sbAwayLossBonus');
      if (awayWinEl) {
        if (localStreaks.away.win >= 2) {
          awayWinEl.textContent = '🔥 ' + localStreaks.away.win + ' W';
          awayWinEl.style.display = 'inline-block';
        } else if (localStreaks.away.win === 1) {
          awayWinEl.textContent = '⚡ 1 W';
          awayWinEl.style.display = 'inline-block';
        } else {
          awayWinEl.style.display = 'none';
        }
      }
      if (awayPipsEl) awayPipsEl.textContent = formatLossPips(localStreaks.away.loss);
      if (awayBonusEl) awayBonusEl.textContent = formatLossBonus(localStreaks.away.loss);

      const renderTable = (tbodyId, list) => {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        if (!list || list.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" class="empty-row">En attente de données joueurs...</td></tr>';
          return;
        }

        tbody.innerHTML = list.map(p => {
          const pName = escapeHtml(p.name || p.steamId);
          const hsClass = (p.hsPercent >= 50) ? 'val-hs' : '';
          return '<tr>' +
            '<td class="col-player" title="' + escapeHtml(p.steamId) + '">' + pName + '</td>' +
            '<td>' + (p.kills ?? 0) + '</td>' +
            '<td>' + (p.assists ?? 0) + '</td>' +
            '<td>' + (p.deaths ?? 0) + '</td>' +
            '<td class="' + hsClass + '">' + (p.hsPercent ?? 0) + '%</td>' +
            '<td class="val-score">' + (p.score ?? 0) + '</td>' +
            '<td class="val-cash">$' + (p.money ?? 0).toLocaleString() + '</td>' +
            '<td class="val-equip">$' + (p.equip ?? 0).toLocaleString() + '</td>' +
          '</tr>';
        }).join('');
      };

      renderTable('sbHomeBody', localScoreboard.home);
      renderTable('sbAwayBody', localScoreboard.away);
    }

    function clearScoreboard() {
      localScoreboard = { home: [], away: [] };
      localSides = { home: 'CT', away: 'T' };
      localScore = { ct: 0, t: 0, round: 1 };
      localPhase = 'LIVE';
      localStreaks = { home: { win: 0, loss: 0 }, away: { win: 0, loss: 0 } };
      updateScoreboardUI();
    }

    // ---- Replay round par round ----
    let roundReplay = null;
    const ROUND_OUTCOMES = {
      CTs_Win: 'Victoire CT (élimination)', Terrorists_Win: 'Victoire T (élimination)',
      Target_Bombed: 'Bombe explosée', Bomb_Defused: 'Bombe désamorcée', Target_Saved: 'Temps écoulé (CT)',
      Round_Draw: 'Nul (restauration de backup ?)',
    };
    function describeRoundEnd(end) {
      if (!end) return 'Round inachevé (fin du log)';
      const outcome = ROUND_OUTCOMES[end.outcome] || end.outcome;
      return 'CT ' + end.ct + ' - ' + end.t + ' T · ' + outcome;
    }
    function renderRoundReplay(st) {
      roundReplay = st;
      document.getElementById('roundReplayBar').style.display = 'block';
      document.getElementById('roundReplayLabel').textContent = 'Round ' + st.cursor + ' / ' + st.totalRounds;
      document.getElementById('roundReplayDetail').textContent = st.cursor > 0
        ? describeRoundEnd(st.rounds[st.cursor - 1].end)
        : 'Aucun round joué — Round suivant pour commencer';
      document.getElementById('btnRoundPrev').disabled = st.cursor === 0;
      document.getElementById('btnRoundNext').disabled = st.cursor >= st.totalRounds;
      const sel = document.getElementById('roundReplaySelect');
      sel.innerHTML = '<option value="0">0 — avant le 1er round</option>' + st.rounds.map(function (r) {
        return '<option value="' + r.index + '"' + (r.index === st.cursor ? ' selected' : '') + '>' + r.index + ' — ' + describeRoundEnd(r.end) + '</option>';
      }).join('');
    }
    async function startRoundReplay(payload) {
      const body = { matchId: payload.matchId, serverId: payload.serverId };
      if (payload.fixtureName) body.fixtureName = payload.fixtureName;
      if (payload.content) body.content = payload.content;
      if (payload.events) body.events = payload.events;
      try {
        const res = await fetch('/sandbox/replay/rounds/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok) { log('error', 'Erreur replay round par round: ' + JSON.stringify(data)); return; }
        renderRoundReplay(data);
        log('success', '🎯 Replay round par round prêt : ' + data.totalRounds + ' rounds. Utilisez « Round suivant ».');
        setTimeout(refreshState, 300);
      } catch (err) {
        log('error', 'Erreur réseau replay round par round: ' + err.message);
      }
    }
    async function stepRound(action, round) {
      if (!roundReplay) return;
      const d = getFormData();
      const prev = document.getElementById('btnRoundPrev'), next = document.getElementById('btnRoundNext');
      prev.disabled = true; next.disabled = true;
      try {
        const res = await fetch('/sandbox/replay/rounds/step', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchId: d.matchId, action: action, round: round }),
        });
        const data = await res.json();
        if (!data.ok) { log('error', 'Erreur round par round: ' + (data.message || JSON.stringify(data))); return; }
        if (action !== 'next') clearScoreboard();
        renderRoundReplay(data);
        log('time', '🎯 Round ' + data.cursor + '/' + data.totalRounds + (data.cursor > 0 ? ' · ' + describeRoundEnd(data.rounds[data.cursor - 1].end) : ''));
        setTimeout(refreshState, 200);
      } catch (err) {
        log('error', 'Erreur réseau round par round: ' + err.message);
      } finally {
        renderRoundReplay(roundReplay);
      }
    }

    async function startReplay() {
      clearScoreboard();
      const d = getFormData();
      const speed = document.getElementById('replaySpeed').value;
      const sel = document.getElementById('fixtureSelect');
      const fixtureName = sel ? sel.value : '';

      if (!uploadedFileContent && !fixtureName) {
        log('error', 'Veuillez sélectionner un match archivé ou charger un fichier .log / .json');
        return;
      }

      const isJson = uploadedFileName.endsWith('.json') || (fixtureName && fixtureName.endsWith('.json'));
      const endpoint = isJson ? '/sandbox/replay/scenario' : '/sandbox/replay/raw-log';
      const typeLabel = isJson ? 'Scénario JSON' : 'Logs bruts Valve CS2 (.log)';

      log('time', '▶️ Démarrage replay ' + typeLabel + ' (Vitesse: ' + speed + ')...');

      const payload = {
        matchId: d.matchId,
        serverId: d.serverId,
        speed: speed,
      };

      if (uploadedFileContent) {
        if (isJson) {
          try {
            const parsed = JSON.parse(uploadedFileContent);
            payload.events = Array.isArray(parsed.events) ? parsed.events : parsed;
          } catch (err) {
            log('error', 'Fichier JSON invalide: ' + err.message);
            return;
          }
        } else {
          payload.content = uploadedFileContent;
        }
      } else {
        payload.fixtureName = fixtureName;
      }

      if (speed === 'rounds') {
        await startRoundReplay(payload);
        return;
      }

      const btn = document.getElementById('btnStartReplay');
      if (btn) btn.disabled = true;

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.ok) {
          const count = data.linesSent || data.eventsSent;
          const modeStr = data.mode || 'scenario';
          log('success', '✅ Replay terminé avec succès (' + modeStr + ') : ' + count + ' éléments traités en ' + data.durationMs + 'ms');
          setTimeout(refreshState, 500);
        } else {
          log('error', 'Erreur replay: ' + JSON.stringify(data));
        }
      } catch (err) {
        log('error', 'Erreur réseau replay: ' + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    let refreshTimer = null;
    let refreshPending = false;
    let lastRefreshTime = 0;
    function scheduleRefreshState(minInterval = 400, silent = true) {
      const now = Date.now();
      const elapsed = now - lastRefreshTime;
      if (elapsed >= minInterval && !refreshPending) {
        lastRefreshTime = now;
        refreshState(silent);
      } else {
        if (!refreshTimer) {
          refreshTimer = setTimeout(() => {
            refreshTimer = null;
            lastRefreshTime = Date.now();
            refreshState(silent);
          }, Math.max(100, minInterval - elapsed));
        }
      }
    }

    async function refreshState(silent = false) {
      const matchId = document.getElementById('matchId').value.trim();
      try {
        refreshPending = true;
        const res = await fetch('/sandbox/state/' + matchId);
        const data = await res.json();
        if (data.ok && data.snapshot) {
          const s = data.snapshot;
          const currentPhase = s.phase || s.score?.phase || 'live_main';
          if (document.getElementById('phase')) document.getElementById('phase').value = currentPhase;
          if (s.score) {
            document.getElementById('scoreCt').value = s.score.ct ?? 0;
            document.getElementById('scoreT').value = s.score.t ?? 0;
          }
          updateComputedFields();
          if (s.streaks) {
            localStreaks.home.win = s.streaks.home?.win ?? localStreaks.home.win;
            localStreaks.home.loss = s.streaks.home?.loss ?? localStreaks.home.loss;
            localStreaks.away.win = s.streaks.away?.win ?? localStreaks.away.win;
            localStreaks.away.loss = s.streaks.away?.loss ?? localStreaks.away.loss;
          } else if (s.economy) {
            localStreaks.home.win = s.economy.home_win_streak ?? localStreaks.home.win;
            localStreaks.home.loss = s.economy.home_loss_streak ?? localStreaks.home.loss;
            localStreaks.away.win = s.economy.away_win_streak ?? localStreaks.away.win;
            localStreaks.away.loss = s.economy.away_loss_streak ?? localStreaks.away.loss;
          }
          if (s.scoreboard) {
            renderScoreboard(s.scoreboard, s.teams, s.score, currentPhase, s.sides, s.streaks, s.economy);
          }
          if (!silent) {
            log('time', 'État actuel : Phase=' + currentPhase + ' Round=' + (s.score?.round ?? 0) + ' CT=' + (s.score?.ct ?? 0) + ' T=' + (s.score?.t ?? 0));
          }
        }
      } catch (err) {
        log('error', "Impossible de récupérer l'état: " + err.message);
      } finally {
        refreshPending = false;
      }
    }

    function setLogFilter(filter) {
      currentLogFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
      });
      document.querySelectorAll('#terminal .entry').forEach(entry => {
        const cat = entry.dataset.cat || 'system';
        if (filter === 'all' || cat === filter) {
          entry.style.display = 'block';
        } else {
          entry.style.display = 'none';
        }
      });
    }

    function renderScoreboard(scoreboard, teams, score, phase, sides, streaks, economy) {
      if (!scoreboard) return;
      if (score) localScore = { ...score };
      if (phase) localPhase = phase;
      if (teams) localTeams = { ...teams };
      if (sides) localSides = { ...sides };
      if (streaks) {
        localStreaks.home.win = streaks.home?.win ?? localStreaks.home.win;
        localStreaks.home.loss = streaks.home?.loss ?? localStreaks.home.loss;
        localStreaks.away.win = streaks.away?.win ?? localStreaks.away.win;
        localStreaks.away.loss = streaks.away?.loss ?? localStreaks.away.loss;
      } else if (economy) {
        localStreaks.home.win = economy.home_win_streak ?? localStreaks.home.win;
        localStreaks.home.loss = economy.home_loss_streak ?? localStreaks.home.loss;
        localStreaks.away.win = economy.away_win_streak ?? localStreaks.away.win;
        localStreaks.away.loss = economy.away_loss_streak ?? localStreaks.away.loss;
      }

      if (Array.isArray(scoreboard.home) && Array.isArray(scoreboard.away)) {
        localScoreboard.home = scoreboard.home.map(p => ({ ...p }));
        localScoreboard.away = scoreboard.away.map(p => ({ ...p }));
      } else if (Array.isArray(scoreboard.ct) && Array.isArray(scoreboard.t)) {
        if (localSides.home === 'CT') {
          localScoreboard.home = scoreboard.ct.map(p => ({ ...p, logical: 'home' }));
          localScoreboard.away = scoreboard.t.map(p => ({ ...p, logical: 'away' }));
        } else {
          localScoreboard.home = scoreboard.t.map(p => ({ ...p, logical: 'home' }));
          localScoreboard.away = scoreboard.ct.map(p => ({ ...p, logical: 'away' }));
        }
      }
      updateScoreboardUI();
    }

    function escapeHtml(str) {
      return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function log(type, msg, cat = 'system') {
      const term = document.getElementById('terminal');
      if (!term) return;
      const now = new Date().toLocaleTimeString();
      const div = document.createElement('div');
      div.className = 'entry';
      div.dataset.cat = cat;
      if (currentLogFilter !== 'all' && currentLogFilter !== cat) {
        div.style.display = 'none';
      }
      div.innerHTML = '<span class="time">[' + now + ']</span> <span class="' + type + '">' + msg + '</span>';
      term.appendChild(div);
      term.scrollTop = term.scrollHeight;
    }

    function clearLogs() {
      document.getElementById('terminal').innerHTML = '';
    }

    function initWebSocket() {
      const matchIdEl = document.getElementById('matchId');
      const matchId = (matchIdEl ? matchIdEl.value.trim() : '') || 'm-sandbox-1';
      if (typeof io === 'undefined') {
        log('error', 'Bibliothèque Socket.IO non chargée (/socket.io/socket.io.js)', 'system');
        return;
      }

      if (currentSocket) {
        currentSocket.disconnect();
        currentSocket = null;
      }

      const pill = document.getElementById('wsStatusPill');
      if (pill) {
        pill.className = 'ws-pill connecting';
        pill.textContent = '● Connexion WS...';
      }

      try {
        currentSocket = io({
          query: { matchId: matchId, token: WS_ADMIN_TOKEN },
          auth: { token: WS_ADMIN_TOKEN },
          transports: ['websocket', 'polling']
        });

        currentSocket.on('connect', () => {
          if (pill) {
            pill.className = 'ws-pill connected';
            pill.textContent = '🟢 WS Live (' + matchId + ')';
          }
          log('success', '🛰️ Abonné au flux WebSocket en direct (match: ' + matchId + ')', 'system');
        });

        currentSocket.on('disconnect', () => {
          if (pill) {
            pill.className = 'ws-pill disconnected';
            pill.textContent = '🔴 Déconnecté';
          }
        });

        currentSocket.on('connect_error', (err) => {
          if (pill) {
            pill.className = 'ws-pill disconnected';
            pill.textContent = '⚠️ Erreur WS';
          }
        });

        currentSocket.onAny((eventName, data) => {
          handleIncomingWsEvent(eventName, data);
        });
      } catch (err) {
        log('error', 'Erreur init WebSocket: ' + err.message, 'system');
      }
    }

    function handleIncomingWsEvent(eventName, data) {
      const chkSync = document.getElementById('chkAutoSync');
      const autoSync = chkSync ? chkSync.checked : true;
      const p = data?.payload || data;

      switch (eventName) {
        case 'kill': {
          const victimName = p?.victim?.name || p?.victim_name || (p?.kind === 'suicide' ? 'Suicide' : 'Inconnu');
          if (victimName.startsWith('de_') || victimName.startsWith('cs_')) {
            break;
          }
          const killer = p?.killer?.name || p?.killer_name || (p?.kind === 'suicide' ? (p?.player?.name || 'Inconnu') : 'Inconnu');
          const killerSide = p?.killer?.team || p?.killer_team || p?.player?.team ? (' (' + (p?.killer?.team || p?.killer_team || p?.player?.team) + ')') : '';
          const victimSide = p?.victim?.team || p?.victim_team ? (' (' + (p?.victim?.team || p?.victim_team) + ')') : '';
          const weapon = p?.weapon || 'arme';
          const hs = p?.headshot ? ' 🎯 (HS)' : '';
          log('entry', '<span class="tag-kill">KILL</span> <b>' + killer + killerSide + '</b> [' + weapon + ']' + hs + ' ➔ <b>' + victimName + victimSide + '</b>', 'combat');

          if (autoSync && String(localPhase).toLowerCase() !== 'postgame') {
            const rawKillerSide = p?.killer?.team || p?.killer_team || (p?.victim?.team === 'CT' || p?.victim_team === 'CT' ? 'T' : 'CT');
            const rawVictimSide = p?.victim?.team || p?.victim_team || p?.player?.team || (rawKillerSide === 'CT' ? 'T' : 'CT');

            if (p?.kind !== 'suicide' && killer !== 'Inconnu' && killer !== 'world') {
              const kPlayer = getOrAddLocalPlayer(p?.killer || { name: killer, team: rawKillerSide }, rawKillerSide);
              if (kPlayer) {
                kPlayer.kills = (kPlayer.kills || 0) + 1;
                if (p?.headshot) {
                  kPlayer.headshots = (kPlayer.headshots || 0) + 1;
                  kPlayer.score = (kPlayer.score || 0) + 3;
                } else {
                  kPlayer.score = (kPlayer.score || 0) + 2;
                }
                kPlayer.hsPercent = Math.round((kPlayer.headshots / kPlayer.kills) * 100);
              }
            }
            const actualVictimObj = (p?.kind === 'suicide') ? (p?.player || p?.victim) : (p?.victim || { name: victimName, team: rawVictimSide });
            const actualVictimName = actualVictimObj?.name || '';
            if (actualVictimName && actualVictimName !== 'Inconnu' && actualVictimName !== 'Suicide' && actualVictimName !== 'world' && !actualVictimName.startsWith('de_')) {
              const vPlayer = getOrAddLocalPlayer(actualVictimObj, rawVictimSide);
              if (vPlayer) {
                vPlayer.deaths = (vPlayer.deaths || 0) + 1;
              }
            }
            updateScoreboardUI();
            scheduleRefreshState(300, true);
          }
          break;
        }

        case 'assist': {
          const player = p?.player?.name || 'Inconnu';
          const playerSide = p?.player?.team ? (' (' + p.player.team + ')') : '';
          const victim = p?.victim?.name || 'Inconnu';
          const flash = p?.flashAssist ? ' ⚡ (Flash)' : '';
          log('entry', '<span class="tag-kill" style="background:#0284c7;">ASSIST</span> <b>' + player + playerSide + '</b>' + flash + ' ➔ <b>' + victim + '</b>', 'combat');

          if (autoSync) {
            const aPlayer = getOrAddLocalPlayer(p?.player || { name: player, team: p?.player?.team }, p?.player?.team);
            if (aPlayer) {
              aPlayer.assists = (aPlayer.assists || 0) + 1;
              aPlayer.score = (aPlayer.score || 0) + 1;
              updateScoreboardUI();
            }
            scheduleRefreshState(300, true);
          }
          break;
        }

        case 'team_round_win': {
          const winner = p?.winner || p?.team || 'Inconnu';
          const reason = p?.reason ? (' (motif: ' + p.reason + ')') : '';
          log('entry', '<span class="tag-round">ROUND WIN</span> Victoire équipe <b>' + winner + '</b>' + reason, 'match');
          if (autoSync) {
            const winTeam = String(winner).toUpperCase();
            if (winTeam === 'CT') {
              localScore.ct = (localScore.ct || 0) + 1;
            } else if (winTeam === 'T' || winTeam === 'TERRORIST') {
              localScore.t = (localScore.t || 0) + 1;
            }
            localScore.round = (localScore.ct || 0) + (localScore.t || 0) + 1;

            const homeIsCt = (localSides.home === 'CT');
            const homeWon = (winTeam === 'CT') ? homeIsCt : !homeIsCt;
            if (homeWon) {
              localStreaks.home.win += 1;
              localStreaks.home.loss = Math.max(0, localStreaks.home.loss - 1);
              localStreaks.away.win = 0;
              localStreaks.away.loss = Math.min(5, localStreaks.away.loss + 1);
            } else {
              localStreaks.away.win += 1;
              localStreaks.away.loss = Math.max(0, localStreaks.away.loss - 1);
              localStreaks.home.win = 0;
              localStreaks.home.loss = Math.min(5, localStreaks.home.loss + 1);
            }

            updateScoreboardUI();
            if (document.getElementById('scoreCt')) document.getElementById('scoreCt').value = localScore.ct;
            if (document.getElementById('scoreT')) document.getElementById('scoreT').value = localScore.t;
            updateComputedFields();
            scheduleRefreshState(200, true);
          }
          break;
        }

        case 'score:update': {
          const ct = p?.score?.ct ?? p?.ct ?? p?.scoreCt;
          const t = p?.score?.t ?? p?.t ?? p?.scoreT;
          const round = p?.score?.round ?? p?.round ?? (ct !== undefined && t !== undefined ? ct + t : '?');
          log('entry', '<span class="tag-score">SCORE</span> CT <b>' + ct + '</b> - <b>' + t + '</b> T (Round ' + round + ')', 'match');
          if (autoSync && ct !== undefined && t !== undefined) {
            localScore.ct = Number(ct);
            localScore.t = Number(t);
            if (round !== '?') localScore.round = Number(round);
            if (p?.streaks) {
              localStreaks.home.win = p.streaks.home?.win ?? localStreaks.home.win;
              localStreaks.home.loss = p.streaks.home?.loss ?? localStreaks.home.loss;
              localStreaks.away.win = p.streaks.away?.win ?? localStreaks.away.win;
              localStreaks.away.loss = p.streaks.away?.loss ?? localStreaks.away.loss;
            } else if (p?.economy) {
              localStreaks.home.win = p.economy.home_win_streak ?? localStreaks.home.win;
              localStreaks.home.loss = p.economy.home_loss_streak ?? localStreaks.home.loss;
              localStreaks.away.win = p.economy.away_win_streak ?? localStreaks.away.win;
              localStreaks.away.loss = p.economy.away_loss_streak ?? localStreaks.away.loss;
            }
            document.getElementById('scoreCt').value = ct;
            document.getElementById('scoreT').value = t;
            updateComputedFields();
            updateScoreboardUI();
          }
          break;
        }

        case 'round:start': {
          const round = p?.round ?? '';
          log('entry', '<span class="tag-round">ROUND START</span> Début de la manche ' + round, 'match');
          if (autoSync && round) {
            localScore.round = Number(round);
            updateScoreboardUI();
          }
          break;
        }

        case 'round:end': {
          log('entry', '<span class="tag-round">ROUND END</span> Fin de la manche', 'match');
          break;
        }

        case 'phase:changed': {
          const phase = p?.phase || p?.newPhase || '';
          log('entry', '<span class="tag-phase">PHASE</span> Changement de phase : <b>' + phase + '</b>', 'match');
          if (autoSync && phase) {
            localPhase = phase;
            if (document.getElementById('phase')) document.getElementById('phase').value = phase;
            updateComputedFields();
            updateScoreboardUI();
          }
          break;
        }

        case 'phase:countdown': {
          const sec = p?.seconds !== undefined ? (p.seconds + 's') : '';
          log('entry', '<span class="tag-phase">COUNTDOWN</span> Compte à rebours phase : ' + sec, 'match');
          break;
        }

        case 'bomb:planted': {
          const site = p?.site ? (' (Site ' + p.site + ')') : '';
          const planterObj = p?.planter || p?.player;
          const planter = planterObj?.name ? (' par ' + planterObj.name) : '';
          log('entry', '<span class="tag-bomb">BOMBE</span> Bombe amorcée' + site + planter, 'combat');
          if (autoSync && planterObj) {
            const bPlayer = getOrAddLocalPlayer(planterObj, 'T');
            if (bPlayer) {
              bPlayer.score = (bPlayer.score || 0) + 2;
              updateScoreboardUI();
            }
            scheduleRefreshState(300, true);
          }
          break;
        }

        case 'defuse:begin': {
          const defuser = p?.player?.name ? (' par ' + p.player.name) : '';
          log('entry', '<span class="tag-bomb">DEFUSE</span> Désamorçage commencé' + defuser, 'combat');
          break;
        }

        case 'bomb_defused': {
          const defuserObj = p?.defuser || p?.player;
          const defuserName = defuserObj?.name ? (' par ' + defuserObj.name) : '';
          log('entry', '<span class="tag-bomb">DEFUSED</span> Bombe désamorcée' + defuserName, 'combat');
          if (autoSync && defuserObj) {
            const dPlayer = getOrAddLocalPlayer(defuserObj, 'CT');
            if (dPlayer) {
              dPlayer.score = (dPlayer.score || 0) + 2;
              updateScoreboardUI();
            }
            scheduleRefreshState(300, true);
          }
          break;
        }

        case 'player:connected': {
          if (autoSync && p?.player) {
            getOrAddLocalPlayer(p.player, p.team || p.player.team);
            updateScoreboardUI();
          }
          break;
        }

        case 'chat:public': {
          const sender = p?.player?.name || 'Joueur';
          const team = p?.player?.team ? (' (' + p.player.team + ')') : '';
          const text = p?.text || p?.message || '';
          log('entry', '<span class="tag-chat">CHAT</span> <b>' + sender + team + '</b>: ' + text, 'chat');
          break;
        }

        case 'command': {
          const cmd = p?.command || '';
          const sender = p?.sender?.name || 'Joueur';
          const team = p?.sender?.team ? (' (' + p.sender.team + ')') : '';
          const params = Array.isArray(p?.parameters) && p.parameters.length > 0 ? (' ' + p.parameters.join(' ')) : '';
          log('entry', '<span class="tag-chat">CMD</span> <b>' + sender + team + '</b>: <code>' + cmd + params + '</code>', 'chat');
          break;
        }

        case 'pause:update': {
          const state = p?.state || 'update';
          log('entry', '<span class="tag-phase">PAUSE</span> État pause : ' + state, 'match');
          break;
        }

        case 'sides:swapped': {
          log('entry', '<span class="tag-phase">SWAP</span> Inversion des côtés (Sides Swapped)', 'match');
          if (autoSync) {
            if (p?.sides && p.sides.home && p.sides.away) {
              localSides.home = p.sides.home;
              localSides.away = p.sides.away;
            } else {
              localSides.home = (localSides.home === 'CT') ? 'T' : 'CT';
              localSides.away = (localSides.away === 'CT') ? 'T' : 'CT';
            }
            localStreaks = { home: { win: 0, loss: 0 }, away: { win: 0, loss: 0 } };
            localScoreboard.home.forEach(x => { x.side = localSides.home; });
            localScoreboard.away.forEach(x => { x.side = localSides.away; });
            updateScoreboardUI();
            scheduleRefreshState(200, true);
          }
          break;
        }

        case 'match:ended': {
          const wName = p?.winner || 'Équipe';
          log('entry', '<span class="tag-phase">MATCH ENDED</span> Victoire : <b>' + wName + '</b>', 'match');
          if (autoSync) {
            localPhase = 'postgame';
            if (document.getElementById('phase')) document.getElementById('phase').value = 'postgame';
            updateComputedFields();
            updateScoreboardUI();
            scheduleRefreshState(100, true);
          }
          break;
        }

        case 'match:state': {
          if (data && data.scoreboard) {
            renderScoreboard(data.scoreboard, data.teams, data.score, data.phase, data.sides, data.streaks, data.economy);
          }
          if (autoSync && data) {
            if (data.score) {
              if (data.score.ct !== undefined) document.getElementById('scoreCt').value = data.score.ct;
              if (data.score.t !== undefined) document.getElementById('scoreT').value = data.score.t;
            }
            if (data.phase && document.getElementById('phase')) {
              document.getElementById('phase').value = data.phase;
            }
            updateComputedFields();
          }
          break;
        }

        default: {
          const cat = (eventName.includes('kill') || eventName.includes('bomb') || eventName.includes('grenade')) ? 'combat' :
                      (eventName.includes('chat') || eventName.includes('cmd')) ? 'chat' :
                      (eventName.includes('round') || eventName.includes('score') || eventName.includes('phase')) ? 'match' : 'system';
          log('entry', '<span class="tag-system">' + eventName.toUpperCase() + '</span> ' + JSON.stringify(p), cat);
          break;
        }
      }
    }

    // Chargement au démarrage
    window.onload = () => {
      loadPresets();
      loadFixtures();

      const ctEl = document.getElementById('scoreCt');
      const tEl = document.getElementById('scoreT');

      ctEl.addEventListener('input', updateComputedFields);
      tEl.addEventListener('input', updateComputedFields);
      updateComputedFields();

      initWebSocket();
      const matchIdEl = document.getElementById('matchId');
      if (matchIdEl) {
        matchIdEl.addEventListener('change', () => {
          initWebSocket();
          refreshState(true);
        });
      }
      setTimeout(() => refreshState(true), 200);
    };
  </script>
</body>
</html>`;
  }
}
