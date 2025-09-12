import {
  Controller, Post, Body, Req, UnauthorizedException, ForbiddenException,
  HttpCode, Query, Logger, Headers, BadRequestException
} from '@nestjs/common';
import type { Request } from 'express';
import { Cs2LogsService } from './cs2-logs.service';
import { MatchStateService } from '@app/state/match-state.service';

// ================= Utils IP =================
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

// ================= Types min pour l’API =================
type IncomingEvent = {
  v?: number;
  id?: string;
  ts?: number;
  seq?: number;
  serverId?: string;
  matchId?: string;
  type: string;
  payload: unknown;
};

@Controller('cs2/logs')
export class Cs2LogsController {
  private readonly allowed: string[] = (process.env.ALLOWED_IPS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  private readonly logger = new Logger('CS2-LOGS');

  constructor(
    private readonly svc: Cs2LogsService,
    private readonly matchState: MatchStateService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: Request,
    @Body() body: any,
    @Headers('x-server-id') headerServerId?: string,
    @Query('server') serverQ?: string,
    @Query('serverId') serverIdQ?: string,
    @Query('matchId') matchIdQ?: string,
  ) {
    // ===== 1) Auth token =====
    const token = req.header('x-cs2-token') || (typeof req.query.token === 'string' ? req.query.token : undefined);
    if (process.env.CS2_TOKEN) {
      if (!token || token !== process.env.CS2_TOKEN) {
        throw new UnauthorizedException('bad token');
      }
    }

    // ===== 2) Filtrage IP =====
    if (this.allowed.length > 0) {
      const clientIp =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.ip || '0.0.0.0';
      if (!isIpAllowed(clientIp, this.allowed)) {
        throw new ForbiddenException(`ip not allowed: ${clientIp}`);
      }
    }

    // ===== 3) ServerId / MatchId (fallback si l’agent ne les met pas) =====
    const contentType = (req.headers['content-type'] || '').split(';')[0].toLowerCase();
    const isNdjson = contentType === 'application/x-ndjson';

    const serverIdHint = headerServerId ?? serverIdQ ?? serverQ ?? undefined;
    let matchIdHint = matchIdQ ?? undefined;
    if (!matchIdHint && serverIdHint) {
      // fallback: si on n’a pas matchId dans l’event, on tentera ce hint
      try { matchIdHint = await this.matchState.getServerMatch(serverIdHint) ?? undefined; } catch {}
    }

    // ===== 4) Normalisation input: NDJSON | Array | Single =====
    const events: IncomingEvent[] = [];

    if (isNdjson) {
      const raw = String(body ?? '');
      const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const [i, line] of lines.entries()) {
        try {
          const ev = JSON.parse(line);
          events.push(ev);
        } catch (e) {
          this.logger.warn(`Drop NDJSON line ${i}: invalid JSON`);
        }
      }
    } else {
      // Nest parse déjà le JSON pour application/json
      if (Array.isArray(body)) {
        events.push(...body);
      } else if (body && typeof body === 'object') {
        // accepte aussi { events: [...] }
        if (Array.isArray(body.events)) {
          events.push(...body.events);
        } else {
          events.push(body as IncomingEvent);
        }
      } else {
        throw new BadRequestException('Expected JSON event(s)');
      }
    }

    if (events.length === 0) {
      return { ok: true, n: 0 };
    }

    // ===== 5) Enrichissement minimal (hints) sans re-parsing =====
    const enriched = events.map(ev => {
      // ne pas écraser ce que l’agent a mis
      if (!ev.serverId && serverIdHint) ev.serverId = serverIdHint;
      if (!ev.matchId && matchIdHint) ev.matchId = matchIdHint;
      return ev;
    });

    this.logger.debug(`RX events=${enriched.length} ct=${contentType} sid=${serverIdHint ?? '∅'} mid=${matchIdHint ?? '∅'}`);

    // ===== 6) Délégation au service (pas de regex ici) =====
    await this.svc.handleEvents(enriched);

    return { ok: true, n: enriched.length };
  }
}
