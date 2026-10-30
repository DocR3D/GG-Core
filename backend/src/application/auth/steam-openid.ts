// src/application/auth/steam-openid.ts
// "Sign in through Steam" = OpenID 2.0 with steamcommunity.com as provider. No Steam Web API key needed: Steam
// sends the browser back with a signed assertion, which is checked by posting it back to Steam
// (check_authentication). Steam must be reachable (Internet) — the offline fallback is the local admin password.

export const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
const CLAIMED_ID = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const STEAM64_BASE = 76561197960265728n;

/** URL of Steam's login page; Steam sends the browser back to `returnTo` (which must start with `realm`). */
export function steamLoginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

export type CheckAuthentication = (body: URLSearchParams) => Promise<string>;

/** Posts the assertion back to Steam (real network call). */
export const checkWithSteam: CheckAuthentication = async (body) => {
  const res = await fetch(STEAM_OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  });
  return res.text();
};

/** Fields Steam must have signed: otherwise one of them could be changed without breaking the signature. */
const MUST_BE_SIGNED = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce'];
const NONCE_MAX_AGE_MS = 5 * 60_000;
const NONCE_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/;

/** Nonces already presented (in memory, single backend): an assertion is accepted once. */
const usedNonces = new Map<string, number>();
export function nonceAlreadyUsed(nonce: string, now = Date.now()): boolean {
  for (const [n, exp] of usedNonces) if (exp < now) usedNonces.delete(n);
  if (usedNonces.has(nonce)) return true;
  usedNonces.set(nonce, now + 2 * NONCE_MAX_AGE_MS);
  return false;
}

/**
 * Checks the assertion Steam sent back (query of the return URL) and returns the SteamID64, or null when it is
 * not a valid, Steam-signed login for this return URL: wrong provider / return URL / id, a field that matters
 * not signed, a nonce older than 5 minutes or already used (replay), or Steam answering is_valid:false.
 */
export async function verifySteamAssertion(
  query: Record<string, unknown>,
  expectedReturnTo: string,
  check: CheckAuthentication = checkWithSteam,
  now = Date.now(),
): Promise<string | null> {
  const get = (k: string) => (typeof query[k] === 'string' ? (query[k] as string) : '');
  if (get('openid.mode') !== 'id_res') return null;
  if (get('openid.op_endpoint') !== STEAM_OPENID_ENDPOINT) return null;
  if (!get('openid.return_to').startsWith(expectedReturnTo)) return null;
  const match = CLAIMED_ID.exec(get('openid.claimed_id'));
  if (!match || get('openid.identity') !== get('openid.claimed_id')) return null;
  const signed = get('openid.signed').split(',');
  if (!MUST_BE_SIGNED.every((f) => signed.includes(f))) return null;

  // Replay protection: fresh nonce, used once (checked before asking Steam, so concurrent replays lose too)
  const nonce = get('openid.response_nonce');
  const issued = NONCE_TIME.exec(nonce)?.[1];
  const age = issued ? now - Date.parse(issued) : NaN;
  if (!(age >= -60_000 && age <= NONCE_MAX_AGE_MS)) return null;
  if (nonceAlreadyUsed(nonce, now)) return null;

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (k.startsWith('openid.') && typeof v === 'string') body.set(k, v);
  body.set('openid.mode', 'check_authentication');
  const answer = await check(body);
  return /is_valid\s*:\s*true/.test(answer) ? match[1] : null;
}

/** SteamID64 (76561198000000001) → Steam3 as written in CS2 logs ([U:1:39734273]). */
export function steam64ToSteam3(steam64: string): string {
  return `[U:1:${(BigInt(steam64) - STEAM64_BASE).toString()}]`;
}
