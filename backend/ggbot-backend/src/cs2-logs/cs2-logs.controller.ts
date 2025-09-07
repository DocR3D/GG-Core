import { Controller, Post, Body, Req, UnauthorizedException, ForbiddenException, HttpCode, Query } from '@nestjs/common';
import type { Request } from 'express';
import { Cs2LogsService } from './cs2-logs.service';

function normalizeIpv4(ip: string): string {
  // transforme "::ffff:192.168.1.23" -> "192.168.1.23"
  const m = ip.match(/(\d{1,3}\.){3}\d{1,3}$/);
  return m ? m[0] : ip;
}

function ipInCidr(ip: string, cidr: string): boolean {
  // Support IPv4 simple CIDR (x.y.z.w/n)
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
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  constructor(private readonly svc: Cs2LogsService) {}

  @Post()
  @HttpCode(200)
async receive(@Req() req: Request, @Body() body: any) {
  
  // 1) Auth token (tel quel)
  const token = req.header('x-cs2-token')
    || (typeof req.query.token === 'string' ? req.query.token : undefined);
  if (process.env.CS2_TOKEN) {
    if (!token || token !== process.env.CS2_TOKEN) {
      throw new UnauthorizedException('bad token');
    }
  }

  // 2) Filtrage IP (tel quel)
  if (this.allowed.length > 0) {
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.ip || '0.0.0.0';
    if (!isIpAllowed(clientIp, this.allowed)) {
      throw new ForbiddenException(`ip not allowed: ${clientIp}`);
    }
  }

  // 3) Identification serveur (tel quel)
  const serverId =
    req.header('x-cs2-server')
    || (typeof req.query.server === 'string' ? req.query.server : undefined)
    || `${req.ip}`;



  const text =
    typeof body === 'string' ? body :
    Buffer.isBuffer(body) ? body.toString('utf8') :
    JSON.stringify(body ?? '');

  let t = text.replace(/\0/g, ''); // nettoyage léger
  const blocks = this.findRoundStatsBlocks(t);

  if (blocks.length) {
    let last = 0;

    for (const { start, end } of blocks) {
      // 1) Traite les lignes AVANT ce bloc (ordre chronologique)
      const before = t.slice(last, start);
      const beforeLines = before.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of beforeLines) {
        await this.svc.handleLogLine(serverId, line);
      }

      // 2) Traite le bloc JSON lui-même
      const seg = t.slice(start, end); // JSON_BEGIN{ ... }}JSON_END
      await this.svc.handleJson(serverId, seg);

      last = end;
    }

    // 3) Traite le "suffixe" après le dernier bloc
    const tail = t.slice(last);
    const tailLines = tail.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of tailLines) {
      await this.svc.handleLogLine(serverId, line);
    }
  } else {
    // Pas de bloc JSON : traitement ligne par ligne classique
    const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    console.log('[receive]', {
      server: serverId,
      len: t.length,
      lines: lines.length,
      preview: t.slice(0, 100),
    });

    for (const line of lines) {
      await this.svc.handleLogLine(serverId, line);
    }
  }
}

private findRoundStatsBlocks(text: string): Array<{start:number,end:number}> {
  const res: Array<{start:number,end:number}> = [];
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
