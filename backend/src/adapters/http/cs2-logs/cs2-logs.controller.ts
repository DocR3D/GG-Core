import {
  Controller, Post, Body, Req, UnauthorizedException, ForbiddenException,
  HttpCode, Query, BadRequestException, Logger, Headers
} from '@nestjs/common';
import type { Request } from 'express';
import { Cs2LogsService, LogCtx } from './cs2-logs.service';
import { MatchStateService } from '@app/state/match-state.service';

// ================= Utils IP (inchangés) =================
function normalizeIpv4(ip: string): string {
  const m = ip.match(/(\d{1,3}\.){3}\d{1,3}$/);
  return m ? m[0] : ip;
}
function ipInCidr(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr || '32', 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;
  const toInt = (s: string) => s.split('.').reduce((a, b) => (a << 8) + (parseInt(b, 10) & 255), 0) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const ipInt = toInt(ip);
  const netInt = toInt(net);
  return (ipInt & mask) === (netInt & mask);
}
function isIpAllowed(ip: string, allowedList: string[]): boolean {
  const v4 = normalizeIpv4(ip);
  return allowedList.some(entry => {
    const e = entry.trim();
    if (!e) return false;
    if (e.includes('/')) return ipInCidr(v4, e);
    return v4 === e;
  });
}

@Controller('cs2/logs')
export class Cs2LogsController {
  private readonly allowed: string[] = (process.env.ALLOWED_IPS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  private readonly logger = new Logger('CS2-LOGS');

  constructor(
    private readonly svc: Cs2LogsService,
    private readonly matchState: MatchStateService
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: Request,
    @Body() body: any,
    @Headers('x-server-id') headerServerId?: string, // [MOD] lis X-Server-ID dans les headers (prioritaire sur query)
    @Query('server') serverQ?: string,
    @Query('serverId') serverIdQ?: string,
    @Query('matchId') matchIdQ?: string,           // [MOD] supprime le doublon matchIdFromQuery/m
    @Query('m') matchIdShort?: string,
    @Query('map') map?: string,
    @Query('round') roundQ?: string,
    @Query('tick') tickQ?: string,
  ) {
    // ===== 1) Auth token (ne pas logger la valeur du token) =====
    const token = req.header('x-cs2-token') || (typeof req.query.token === 'string' ? req.query.token : undefined);
    if (process.env.CS2_TOKEN) {
      if (!token || token !== process.env.CS2_TOKEN) {
        throw new UnauthorizedException('bad token');
      }
    }

    // ===== 2) Filtrage IP (avec trust proxy côté main.ts) =====
    if (this.allowed.length > 0) {
      const clientIp =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.ip || '0.0.0.0';
      if (!isIpAllowed(clientIp, this.allowed)) {
        throw new ForbiddenException(`ip not allowed: ${clientIp}`);
      }
    }

    // ===== 3) ServerId & Content-Type =====
    // [MOD] priorité au header X-Server-ID, puis query serverId/server
    const serverId = headerServerId ?? serverIdQ ?? serverQ ?? null;

    // [MOD] contrôle (souple) du Content-Type pour NDJSON
    const ct = (req.headers['content-type'] || '').split(';')[0].toLowerCase();
    const isNdjson = ct === 'application/x-ndjson';

    // ===== 4) Résolution du matchId via query ou Redis =====
    let matchId = matchIdQ ?? matchIdShort ?? null;
    if (!matchId && serverId) {
      matchId = await this.matchState.getServerMatch(serverId);
    }

    // ===== 5) Construction du contexte =====
    // [MOD] propage map/round/tick + marque serverBound si matchId résolu
    const ctx: LogCtx = {
      serverId: (serverId ?? 'unknown'),
      matchId: (matchId ?? null),
      map: map ?? null,
      round: roundQ ? (Number(roundQ) || null) : null,
      tick: tickQ ? (Number(tickQ) || null) : null,
      source: 'logs',
      recvAt: Date.now(),
      lineTs: null,
      serverBound: !!matchId,
    };

    // ===== 6) Lecture du body =====
    // [MOD] comme /cs2/logs est parsé en texte brut, @Body() est (normalement) string
    //      on force en string proprement, sans Buffer/JSON.stringify
    const text = String(body ?? '');

    // [MOD] nettoyage mineur (NUL chars)
    let t = text.replace(/\0/g, '');

    // [MOD] log sans le token pour éviter la fuite
    this.logger.debug(`RX serverId=${serverId ?? '∅'} matchId=${matchId ?? '∅'} ct=${ct} bodyLen=${t.length}`);

    // ===== 7) Gestion blocs JSON round_stats (inchangée) =====
    const blocks = this.findRoundStatsBlocks(t);

    if (blocks.length) {
      let last = 0;

      for (const { start, end } of blocks) {
        // a) lignes AVANT le bloc JSON
        const before = t.slice(last, start);
        const beforeLines = before.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const line of beforeLines) {
          await this.svc.handleLogLine(ctx, line);
        }

        // b) traiter le bloc JSON lui-même
        const seg = t.slice(start, end); // JSON_BEGIN{ ... }}JSON_END
        await this.svc.handleJson(ctx, seg);

        last = end;
      }

      // c) suffixe APRÈS le dernier bloc
      const tail = t.slice(last);
      const tailLines = tail.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of tailLines) {
        await this.svc.handleLogLine(ctx, line);
      }
    } else {
      // ===== 8) NDJSON vs lignes simples =====
      // [MOD] si NDJSON, chaque ligne est une "entrée" (1 log par ligne)
      //       sinon, fallback: on traite comme lignes simples (ta logique actuelle)
      const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        await this.svc.handleLogLine(ctx, line);
      }
    }

    return { ok: true };
  }

  /** Détection des blocs round_stats (inchangée) */
  private findRoundStatsBlocks(text: string): Array<{ start: number; end: number }> {
    const res: Array<{ start: number; end: number }> = [];
    let from = 0; const BEGIN = 'JSON_BEGIN{', END = '}}JSON_END';
    while (true) {
      const b = text.indexOf(BEGIN, from);
      if (b === -1) break;
      const e = text.indexOf(END, b);
      if (e === -1) break;
      const seg = text.slice(b, e + END.length);
      if (seg.includes('"name": "round_stats"')) res.push({ start: b, end: e + END.length });
      from = e + END.length;
    }
    return res;
  }
}
