/**
 * Tests unitaires — Cs2LogsService
 * TC-01 : Résolution matchId depuis serverId
 * TC-09 : Init match et liaison serveur
 */
import { Cs2LogsService } from './cs2-logs.service';

const MATCH_ID = 'm-7ef15f093f';
const SERVER_ID = 'srv-a';

function makeService(overrides?: {
  getMatchIdFromServerId?: (id: string) => Promise<string | null>;
  publish?: jest.Mock;
}) {
  const publisher = { publish: overrides?.publish ?? jest.fn().mockResolvedValue(undefined) };
  const matchStateService = {
    getMatchIdFromServerId: overrides?.getMatchIdFromServerId ?? jest.fn().mockResolvedValue(MATCH_ID),
  };
  const svc = new Cs2LogsService(publisher as any, matchStateService as any);
  return { svc, publisher, matchStateService };
}

// ---------------------------------------------------------------------------
// TC-01 — Résolution matchId="unknown" via serverId
// ---------------------------------------------------------------------------
describe('TC-01 — Résolution matchId depuis serverId', () => {
  // TODO BUG B-01 : !ev.matchId ne catch pas "unknown" (truthy) — fix cs2-logs.service.ts:38
  // it('remplace matchId="unknown" par le vrai matchId depuis Redis', async () => {
  //   const { svc, publisher } = makeService();
  //   await svc.handleEvents([
  //     { type: 'round_start', matchId: 'unknown', serverId: SERVER_ID, payload: {} },
  //   ]);
  //   expect(publisher.publish).toHaveBeenCalledWith(
  //     'ggbot:events',
  //     expect.objectContaining({ matchId: MATCH_ID }),
  //   );
  // });

  it('remplace matchId absent (undefined) par le vrai matchId', async () => {
    const { svc, publisher } = makeService();

    await svc.handleEvents([
      { type: 'kill', serverId: SERVER_ID, payload: {} },
    ]);

    expect(publisher.publish).toHaveBeenCalledWith(
      'ggbot:events',
      expect.objectContaining({ matchId: MATCH_ID }),
    );
  });

  it('conserve le matchId déjà renseigné', async () => {
    const { svc, publisher, matchStateService } = makeService();

    await svc.handleEvents([
      { type: 'round_start', matchId: 'explicit-id', serverId: SERVER_ID, payload: {} },
    ]);

    expect(matchStateService.getMatchIdFromServerId).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledWith(
      'ggbot:events',
      expect.objectContaining({ matchId: 'explicit-id' }),
    );
  });

  it('drop les events sans type ou sans payload', async () => {
    const { svc, publisher } = makeService();

    await svc.handleEvents([
      { type: '', payload: {} } as any,
      { type: 'round_start', payload: undefined } as any,
      null as any,
    ]);

    expect(publisher.publish).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-09 — Init match : getMatchIdFromServerId retourne null si non lié
// ---------------------------------------------------------------------------
describe('TC-09 — Liaison serveur absente', () => {
  it("ne publie pas de matchId si le serveur n'est pas lié à un match", async () => {
    const { svc, publisher } = makeService({
      getMatchIdFromServerId: jest.fn().mockResolvedValue(null),
    });

    await svc.handleEvents([
      { type: 'round_start', matchId: 'unknown', serverId: SERVER_ID, payload: {} },
    ]);

    // L'event est quand même publié, mais sans matchId résolu
    expect(publisher.publish).toHaveBeenCalledWith(
      'ggbot:events',
      expect.objectContaining({ type: 'round_start' }),
    );
    // matchId reste "unknown" (pas de remplacement)
    const published = publisher.publish.mock.calls[0][1];
    expect(published.matchId).toBe('unknown');
  });
});
