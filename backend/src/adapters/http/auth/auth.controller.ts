// src/adapters/http/auth/auth.controller.ts
import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, Session } from '@app/auth/auth.service';
import { steamLoginUrl, verifySteamAssertion } from '@app/auth/steam-openid';
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
  constructor(private readonly auth: AuthService) {}

  @Get('login')
  login(@Req() req: Request & { ggSession?: Session | null }, @Query('next') next: string, @Query('error') error: string, @Res() res: Response) {
    const s = req.ggSession;
    const to = safeNext(next);
    const who = s
      ? `<p>Connecté : <b>${esc(s.name)}</b> (${s.role}${s.via === 'steam' ? `, Steam ${esc(s.sub)}` : ''}) · <a href="/auth/logout">se déconnecter</a></p>
${s.role === 'admin' ? '' : '<p>Ce compte n’a pas les droits d’administration.</p>'}`
      : '';
    const err = error ? `<p><b>${esc(error)}</b></p>` : '';
    res.type('html').send(
      page(
        'GG-Core — connexion',
        `${who}${err}
<p><a href="/auth/steam?next=${encodeURIComponent(to)}" role="button">Se connecter avec Steam</a></p>
<details>
<summary>Connexion admin hors ligne (sans Internet)</summary>
<form method="post" action="/auth/local">
<label>Mot de passe admin <input type="password" name="password" autocomplete="current-password" required></label>
<input type="hidden" name="next" value="${esc(to)}">
<button>Se connecter</button>
</form>
</details>
<p><a href="/view">Tournois (accès public)</a></p>`,
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
  local(@Body() body: { password?: string; next?: string }, @Res() res: Response) {
    const next = safeNext(body?.next);
    if (!this.auth.checkAdminPassword(body?.password ?? '')) {
      return res.redirect(303, `/login?error=${encodeURIComponent('Mot de passe incorrect')}&next=${encodeURIComponent(next)}`);
    }
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
