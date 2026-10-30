import { steam64ToSteam3, steamLoginUrl, verifySteamAssertion, STEAM_OPENID_ENDPOINT } from './steam-openid';

const RETURN = 'http://lan.local:8081/auth/steam/return';
const STEAM64 = '76561198000000042';
const NOW = Date.parse('2026-10-30T12:03:00Z');
let n = 0;
const assertion = (over: Record<string, string> = {}) => ({
  'openid.ns': 'http://specs.openid.net/auth/2.0',
  'openid.mode': 'id_res',
  'openid.op_endpoint': STEAM_OPENID_ENDPOINT,
  'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM64}`,
  'openid.identity': `https://steamcommunity.com/openid/id/${STEAM64}`,
  'openid.return_to': `${RETURN}?next=%2Fsandbox`,
  'openid.response_nonce': `2026-10-30T12:00:00Z${++n}`, // unique per assertion (single use)
  'openid.assoc_handle': '1234567890',
  'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
  'openid.sig': 'c2lnbmF0dXJl',
  ...over,
});

describe('Steam OpenID', () => {
  it('construit l’URL de connexion Steam (identifier_select, retour, realm)', () => {
    const url = new URL(steamLoginUrl(RETURN, 'http://lan.local:8081'));
    expect(url.origin + url.pathname).toBe(STEAM_OPENID_ENDPOINT);
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup');
    expect(url.searchParams.get('openid.return_to')).toBe(RETURN);
    expect(url.searchParams.get('openid.claimed_id')).toBe('http://specs.openid.net/auth/2.0/identifier_select');
  });

  it('accepte une assertion signée par Steam et renvoie le SteamID64 (vérifiée auprès de Steam)', async () => {
    const check = jest.fn().mockResolvedValue('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n');
    await expect(verifySteamAssertion(assertion(), RETURN, check, NOW)).resolves.toBe(STEAM64);
    const sent: URLSearchParams = check.mock.calls[0][0];
    expect(sent.get('openid.mode')).toBe('check_authentication');
    expect(sent.get('openid.sig')).toBe('c2lnbmF0dXJl');
  });

  it.each([
    ['Steam répond is_valid:false', {}, 'is_valid:false'],
    ['mode différent de id_res', { 'openid.mode': 'cancel' }, 'is_valid:true'],
    ['autre fournisseur OpenID', { 'openid.op_endpoint': 'https://evil.example/openid' }, 'is_valid:true'],
    ['retour vers une autre adresse', { 'openid.return_to': 'https://evil.example/auth/steam/return' }, 'is_valid:true'],
    ['identifiant qui n’est pas un compte Steam', { 'openid.claimed_id': 'https://evil.example/id/1', 'openid.identity': 'https://evil.example/id/1' }, 'is_valid:true'],
  ])('refuse : %s', async (_label, over, answer) => {
    await expect(verifySteamAssertion(assertion(over), RETURN, jest.fn().mockResolvedValue(answer), NOW)).resolves.toBeNull();
  });

  it('refuse un champ important non signé par Steam (return_to modifiable sans casser la signature)', async () => {
    const check = jest.fn().mockResolvedValue('is_valid:true');
    const a = assertion({ 'openid.signed': 'signed,op_endpoint,claimed_id,identity,response_nonce,assoc_handle' });
    await expect(verifySteamAssertion(a, RETURN, check, NOW)).resolves.toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it('refuse une réponse de plus de 5 minutes', async () => {
    const check = jest.fn().mockResolvedValue('is_valid:true');
    await expect(verifySteamAssertion(assertion(), RETURN, check, NOW + 10 * 60_000)).resolves.toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it('refuse le rejeu d’une réponse valide déjà utilisée', async () => {
    const check = jest.fn().mockResolvedValue('is_valid:true');
    const a = assertion();
    await expect(verifySteamAssertion(a, RETURN, check, NOW)).resolves.toBe(STEAM64);
    await expect(verifySteamAssertion(a, RETURN, check, NOW + 1000)).resolves.toBeNull();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('convertit un SteamID64 au format des logs CS2', () => {
    expect(steam64ToSteam3('76561197960265729')).toBe('[U:1:1]');
    expect(steam64ToSteam3(STEAM64)).toBe('[U:1:39734314]');
  });
});
