// src/adapters/http/sandbox/sandbox.controller.ts
import { Controller, Get, Post, Body, Param, Res, Header, HttpCode, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { SandboxService } from '@app/match/sandbox/sandbox.service';
import { InjectStateDto, InGameRestoreDto } from '@app/match/sandbox/sandbox.dto';

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
    const html = this.renderSandboxHtml();
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

  private renderSandboxHtml(): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GG-Core Match Sandbox & Round Doctor</title>
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

    .terminal { background: #090d16; border: 1px solid #1e293b; border-radius: 6px; padding: 12px; font-family: 'Courier New', Courier, monospace; font-size: 0.85rem; height: 260px; overflow-y: auto; color: #a5f3fc; line-height: 1.4; }
    .terminal .entry { margin-bottom: 6px; }
    .terminal .time { color: var(--text-muted); margin-right: 8px; }
    .terminal .cmd { color: var(--accent); font-weight: bold; }
    .terminal .success { color: var(--success); }
    .terminal .error { color: var(--danger); }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <h1>GG-Core Match Sandbox & Round Doctor <span class="badge">LAN-First</span></h1>
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
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label>Console & Logs RCON Temps Réel</label>
            <button class="btn btn-outline" style="padding: 2px 8px; font-size: 0.75rem;" onclick="clearLogs()">Effacer</button>
          </div>
          <div class="terminal" id="terminal">
            <div class="entry"><span class="time">[INIT]</span> <span class="success">Match Sandbox & Round Doctor prêt. Choisis un preset ou configure les champs.</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let activePresets = [];

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
          sides: { home: 'CT', away: 'T' },
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

    async function refreshState() {
      const matchId = document.getElementById('matchId').value.trim();
      try {
        const res = await fetch('/sandbox/state/' + matchId);
        const data = await res.json();
        if (data.ok && data.snapshot) {
          const s = data.snapshot;
          if (s.phase) document.getElementById('phase').value = s.phase;
          if (s.score) {
            document.getElementById('scoreCt').value = s.score.ct ?? 0;
            document.getElementById('scoreT').value = s.score.t ?? 0;
          }
          updateComputedFields();
          log('time', 'État actuel : Phase=' + s.phase + ' Round=' + (s.score?.round ?? 0) + ' CT=' + (s.score?.ct ?? 0) + ' T=' + (s.score?.t ?? 0));
        }
      } catch (err) {
        log('error', "Impossible de récupérer l'état: " + err.message);
      }
    }

    function log(type, msg) {
      const term = document.getElementById('terminal');
      const now = new Date().toLocaleTimeString();
      const div = document.createElement('div');
      div.className = 'entry';
      div.innerHTML = \`<span class="time">[\${now}]</span> <span class="\${type}">\${msg}</span>\`;
      term.appendChild(div);
      term.scrollTop = term.scrollHeight;
    }

    function clearLogs() {
      document.getElementById('terminal').innerHTML = '';
    }

    // Chargement au démarrage
    window.onload = () => {
      loadPresets();

      const ctEl = document.getElementById('scoreCt');
      const tEl = document.getElementById('scoreT');

      ctEl.addEventListener('input', updateComputedFields);
      tEl.addEventListener('input', updateComputedFields);
      updateComputedFields();
    };
  </script>
</body>
</html>`;
  }
}
