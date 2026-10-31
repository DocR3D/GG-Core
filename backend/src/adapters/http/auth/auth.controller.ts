// src/adapters/http/auth/auth.controller.ts
import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, Session } from '@app/auth/auth.service';
import { steamLoginUrl, verifySteamAssertion } from '@app/auth/steam-openid';
import { LoginThrottle } from '@app/auth/login-throttle';
import { htmlPage } from '@app/shared/html-page';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Only local paths: never redirect to another site after login (open redirect). */
const safeNext = (next: unknown) => (typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : '/view');
const page = (title: string, body: string) => htmlPage({ title, body: `<h1>${esc(title)}</h1>\n${body}` });

/**
 * Login pages (plain HTML, outside /api): "Sign in through Steam" (needs Internet) and the local admin
 * password (works offline). The session is a signed cookie; role from the SteamID (see AuthService).
 */
@Controller()
export class AuthController {
  /** 10 wrong offline admin passwords within a minute from one address → refused until the minute passes */
  private readonly throttle = new LoginThrottle();

  constructor(private readonly auth: AuthService) {}

  /**
   * Login page - only for someone not logged in: a logged-in visitor goes on to where it was heading (a page it
   * may not open shows "admin only" instead of sending it back here, see AuthMiddleware). To change account:
   * log out, then log in again.
   */
  @Get('login')
  login(@Req() req: Request & { ggSession?: Session | null }, @Query('next') next: string, @Query('error') error: string, @Res() res: Response) {
    const to = safeNext(next);
    if (req.ggSession) return res.redirect(302, to);
    const err = error ? `<p><b>${esc(error)}</b></p>` : '';
    res.type('html').send(
      page(
        'Connexion',
        `${err}
<p><a href="/auth/steam?next=${encodeURIComponent(to)}" role="button">Se connecter avec Steam</a></p>
<details>
<summary>Connexion admin sans Internet</summary>
<form method="post" action="/auth/local">
<label>Mot de passe admin <input type="password" name="password" autocomplete="current-password" required></label>
<input type="hidden" name="next" value="${esc(to)}">
<button>Se connecter</button>
</form>
</details>
<p><a href="/view">Voir les tournois sans se connecter</a></p>`,
      ),
    );
  }

  @Get('auth/steam')
  steam(@Req() req: Request, @Query('next') next: string, @Res() res: Response) {
    const base = publicBase(req);
    res.redirect(302, steamLoginUrl(`${base}/auth/steam/return?next=${encodeURIComponent(safeNext(next))}`, base));
  }

  @Get('auth/steam/return')
  async steamReturn(@Req() req: Request, @Query() query: Record<string, unknown>, @Res() res: Response) {
    const next = safeNext(query.next);
    let steam64: string | null = null;
    try {
      steam64 = await verifySteamAssertion(query, `${publicBase(req)}/auth/steam/return`);
    } catch {
      return res.redirect(302, `/login?error=${encodeURIComponent('Steam injoignable : utiliser la connexion hors ligne')}&next=${encodeURIComponent(next)}`);
    }
    if (!steam64) return res.redirect(302, `/login?error=${encodeURIComponent('Connexion Steam refusée')}&next=${encodeURIComponent(next)}`);
    const { role, name } = await this.auth.roleForSteamId(steam64);
    res.setHeader('Set-Cookie', this.auth.cookie(this.auth.sign({ sub: steam64, role, name, via: 'steam' })));
    res.redirect(302, role === 'admin' ? next : '/login');
  }

  @Post('auth/local')
  local(@Body() body: { password?: string; next?: string }, @Req() req: Request, @Res() res: Response) {
    const next = safeNext(body?.next);
    const address = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const wait = this.throttle.retryAfterSec(address);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      return res.redirect(303, `/login?error=${encodeURIComponent(`Trop d’essais : réessaie dans ${wait} s`)}&next=${encodeURIComponent(next)}`);
    }
    if (!this.auth.checkAdminPassword(body?.password ?? '')) {
      this.throttle.failed(address);
      return res.redirect(303, `/login?error=${encodeURIComponent('Mot de passe incorrect')}&next=${encodeURIComponent(next)}`);
    }
    this.throttle.succeeded(address);
    res.setHeader('Set-Cookie', this.auth.cookie(this.auth.sign({ sub: 'local-admin', role: 'admin', name: 'admin (hors ligne)', via: 'password' })));
    res.redirect(303, next);
  }

  @Get('auth/logout')
  logout(@Res() res: Response) {
    res.setHeader('Set-Cookie', this.auth.cookie(null));
    res.redirect(302, '/login');
  }

  /** Current session (JSON), e.g. for the future frontend. */
  @Get('auth/me')
  me(@Req() req: Request & { ggSession?: Session | null }) {
    return req.ggSession ?? { role: 'visitor' };
  }
}

/** Public base URL (Steam sends the browser back to it): AUTH_PUBLIC_URL, else the request's own host. */
function publicBase(req: Request): string {
  if (process.env.AUTH_PUBLIC_URL) return process.env.AUTH_PUBLIC_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol;
  return `${proto}://${req.get('host')}`;
}
