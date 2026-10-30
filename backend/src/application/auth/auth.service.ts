// src/application/auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { createHash, timingSafeEqual } from 'crypto';
import { PrismaService } from '@adapters/database/prisma.service';
import { steam64ToSteam3 } from './steam-openid';

export type Role = 'admin' | 'player' | 'visitor';

export interface Session {
  /** SteamID64, or "local-admin" for the offline password login */
  sub: string;
  role: Role;
  name: string;
  via: 'steam' | 'password' | 'token';
}

export const SESSION_COOKIE = 'gg_session';
const SESSION_HOURS = 24;

const secretEq = (a: string, b: string) => {
  // constant time, whatever the lengths
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
};

/**
 * Who is calling and with which role. V1 (decided with the user): "Sign in through Steam", role from the
 * SteamID — admin if listed in GG_ADMIN_STEAMIDS, player if the SteamID is a known player, visitor otherwise.
 * LAN-first fallbacks without Internet: a local admin password (GG_ADMIN_PASSWORD) and, for scripts / curl,
 * an admin token (GG_ADMIN_TOKEN, "Authorization: Bearer …"). Sessions: signed JWT in an HttpOnly cookie.
 */
@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Auth can be turned off for a throwaway dev setup (AUTH_DISABLED=1) — never at the LAN. */
  get disabled(): boolean {
    return process.env.AUTH_DISABLED === '1';
  }

  /** Role of a Steam account. */
  async roleForSteamId(steam64: string): Promise<{ role: Role; name: string }> {
    const admins = (process.env.GG_ADMIN_STEAMIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const player = await this.prisma.player
      .findFirst({ where: { steamId: { in: [steam64, steam64ToSteam3(steam64)] } }, select: { username: true } })
      .catch(() => null);
    const name = player?.username ?? steam64;
    if (admins.includes(steam64)) return { role: 'admin', name };
    return { role: player ? 'player' : 'visitor', name };
  }

  /** Offline admin login: the local password (works without Internet). */
  checkAdminPassword(password: string): boolean {
    const expected = process.env.GG_ADMIN_PASSWORD;
    return !!expected && !!password && secretEq(password, expected);
  }

  /** Scripts / curl: "Authorization: Bearer <GG_ADMIN_TOKEN>". */
  sessionFromBearer(authorization: string | undefined): Session | null {
    const expected = process.env.GG_ADMIN_TOKEN;
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    return expected && token && secretEq(token, expected) ? { sub: 'admin-token', role: 'admin', name: 'admin (token)', via: 'token' } : null;
  }

  sign(session: Session): string {
    return jwt.sign(session, this.secret(), { expiresIn: `${SESSION_HOURS}h` });
  }

  /** Session from the cookie, or null when absent / invalid / expired. */
  sessionFromCookie(cookieHeader: string | undefined): Session | null {
    const raw = (cookieHeader ?? '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    if (!raw) return null;
    try {
      const p = jwt.verify(decodeURIComponent(raw), this.secret()) as jwt.JwtPayload & Session;
      return { sub: p.sub!, role: p.role, name: p.name, via: p.via };
    } catch {
      return null;
    }
  }

  cookie(token: string | null): string {
    return token
      ? `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`
      : `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  private secret(): string {
    const s = process.env.JWT_SECRET;
    if (!s) throw new Error('JWT_SECRET is not set');
    return s;
  }
}
