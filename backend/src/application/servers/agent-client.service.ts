// src/application/servers/agent-client.service.ts
//
// HTTP client vers l'agent Go.
// Chaque méthode correspond à un endpoint RESTful distinct de l'agent.
// URL construite depuis server.ip + server.agent_port (stockés en DB).

import { Injectable, Logger } from '@nestjs/common';
import { ServerRepository } from '@adapters/postgres/server.repository';

const TIMEOUT_MS = 5_000;
const INIT_MATCH_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 3_000;

export type AgentHealth = {
  rconConnected: boolean;
  currentMatchId: string | null;
};

@Injectable()
export class AgentClientService {
  private readonly log = new Logger(AgentClientService.name);

  constructor(private readonly serverRepo: ServerRepository) {}

  // ─── Résolution URL + token ───────────────────────────────────────────────

  private async resolve(serverId: string): Promise<{ baseUrl: string; token: string }> {
    const server = await this.serverRepo.findByServerId(serverId);
    if (!server?.agent_port) {
      throw new Error(`agent_port non configuré pour le serveur "${serverId}"`);
    }
    const host = server.agent_host?.trim() || server.ip;
    return {
      baseUrl: `http://${host}:${server.agent_port}`,
      token: server.agent_token ?? '',
    };
  }

  private cmdHeaders(token: string): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['X-Agent-Token'] = token;
    return h;
  }

  private async post(baseUrl: string, token: string, path: string, body: object): Promise<void> {
    const url = `${baseUrl}${path}`;
    this.log.debug(`POST ${url} — body: ${JSON.stringify(body)}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: this.cmdHeaders(token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.log.debug(`POST ${url} — réponse ${res.status}: ${text}`);
      throw new Error(`agent ${path} HTTP ${res.status}: ${text}`);
    }
    this.log.debug(`POST ${url} — OK ${res.status}`);
  }

  // ─── GET /health ─────────────────────────────────────────────────────────

  async health(serverId: string): Promise<AgentHealth> {
    const { baseUrl, token } = await this.resolve(serverId);
    const res = await fetch(`${baseUrl}/health`, {
      headers: token ? { 'X-Agent-Token': token } : {},
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`agent /health HTTP ${res.status}`);
    const data = await res.json() as { rconConnected?: boolean; currentMatchId?: string | null };
    return {
      rconConnected: data.rconConnected ?? false,
      currentMatchId: data.currentMatchId ?? null,
    };
  }

  // ─── POST /say ───────────────────────────────────────────────────────────

  async say(serverId: string, text: string): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    await this.post(baseUrl, token, '/say', { text });
    this.log.log(`[${serverId}] say`);
  }

  // ─── POST /say-team ──────────────────────────────────────────────────────

  async sayTeam(serverId: string, team: string, text: string): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    await this.post(baseUrl, token, '/say-team', { team, text });
    this.log.log(`[${serverId}] say-team team=${team}`);
  }

  // ─── POST /pause ─────────────────────────────────────────────────────────

  async pause(serverId: string): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    await this.post(baseUrl, token, '/pause', {});
    this.log.log(`[${serverId}] pause`);
  }

  // ─── POST /unpause ───────────────────────────────────────────────────────

  async unpause(serverId: string): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    await this.post(baseUrl, token, '/unpause', {});
    this.log.log(`[${serverId}] unpause`);
  }

  // ─── POST /init-match ────────────────────────────────────────────────────

  async initMatch(serverId: string, matchId: string, map: string): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    this.log.debug(`[${serverId}] init-match → ${baseUrl} matchId=${matchId} map=${map}`);
    const url = `${baseUrl}/init-match`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.cmdHeaders(token),
      body: JSON.stringify({ matchId, map }),
      signal: AbortSignal.timeout(INIT_MATCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.log.debug(`POST ${url} — réponse ${res.status}: ${text}`);
      throw new Error(`agent /init-match HTTP ${res.status}: ${text}`);
    }
    this.log.log(`[${serverId}] init-match matchId=${matchId} map=${map}`);
  }

  // ─── POST /changelevel ───────────────────────────────────────────────────

  async changelevel(serverId: string, map: string): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    await this.post(baseUrl, token, '/changelevel', { map });
    this.log.log(`[${serverId}] changelevel ${map}`);
  }

  // ─── POST /restart ───────────────────────────────────────────────────────

  async restart(serverId: string, delay = 3): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    await this.post(baseUrl, token, '/restart', { delay });
    this.log.log(`[${serverId}] restart delay=${delay}`);
  }

  // ─── POST /exec ──────────────────────────────────────────────────────────

  async exec(serverId: string, name: string, vars?: Record<string, string>, matchId?: string): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    await this.post(baseUrl, token, '/exec', {
      name,
      ...(matchId ? { matchId } : {}),
      ...(vars ? { vars } : {}),
    });
    this.log.log(`[${serverId}] exec ${name}`);
  }

  // ─── POST /rcon ──────────────────────────────────────────────────────────

  async rcon(serverId: string, command: string): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    await this.post(baseUrl, token, '/rcon', { command });
    this.log.log(`[${serverId}] rcon "${command}"`);
  }

  // ─── POST /admin-action ──────────────────────────────────────────────────

  async adminAction(
    serverId: string,
    payload: {
      action: string;
      phase?: string;
      map?: string;
      score?: { ct: { team_id: string; score: number }; t: { team_id: string; score: number } };
    },
  ): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    const url = `${baseUrl}/admin-action`;
    this.log.debug(`[${serverId}] admin-action → ${url} payload=${JSON.stringify(payload)}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: this.cmdHeaders(token),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`agent /admin-action HTTP ${res.status}: ${text}`);
    }
    this.log.log(`[${serverId}] admin-action OK action=${payload.action} phase=${payload.phase ?? '-'}`);
  }
}
