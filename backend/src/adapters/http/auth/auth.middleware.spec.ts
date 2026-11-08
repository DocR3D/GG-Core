import { isCaptainAction, isPublic } from './auth.middleware';

describe('auth route classification', () => {
  it.each([
    ['GET', '/socket.io'],
    ['POST', '/socket.io'],
    ['GET', '/socket.io/'],
    ['GET', '/socket.io/?EIO=4&transport=polling'],
  ])('makes Socket.IO public for %s %s', (method, path) => {
    expect(isPublic(method, path)).toBe(true);
  });

  it('allows only reads of the exact connect route shape', () => {
    const path = '/api/tournament/matches/123/connect';
    expect(isPublic('GET', path)).toBe(true);
    expect(isPublic('POST', path)).toBe(false);
    expect(isPublic('GET', `${path}/extra`)).toBe(true); // ordinary public GET, but not the special mutation exception
  });

  it.each(['rps', 'start', 'step'])('allows captains on old and JSON %s actions', (action) => {
    expect(isCaptainAction('POST', `/veto/match/${action}`)).toBe(true);
    expect(isCaptainAction('POST', `/api/tournament/matches/match/veto/${action}`)).toBe(true);
    expect(isCaptainAction('GET', `/api/tournament/matches/match/veto/${action}`)).toBe(false);
  });

  it.each(['undo', 'reset'])('keeps %s admin-only', (action) => {
    expect(isCaptainAction('POST', `/api/tournament/matches/match/veto/${action}`)).toBe(false);
  });
});
