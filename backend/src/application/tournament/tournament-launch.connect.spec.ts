import type { Session } from '@app/auth/auth.service';
import { TournamentLaunchService } from './tournament-launch.service';

const matchId = '11111111-1111-4111-8111-111111111111';
const liveMatch = {
  tournamentId: 'tournament',
  teamHomeId: 'home',
  teamAwayId: 'away',
  maps: [{ id: 'game', mapOrder: 1, mapName: 'de_nuke', server: { ip: '10.0.0.2', port: 27015, tvPort: 27020 } }],
};

describe('TournamentLaunchService.connectInfo privacy', () => {
  const session = (sub: string, role: 'player' | 'admin' = 'player'): Session => ({ sub, role, name: sub, via: role === 'admin' ? 'password' : 'steam' });

  function service(rosterSteamIds: string[]) {
    const prisma = {
      match: { findUnique: jest.fn().mockResolvedValue(liveMatch) },
      teamRoster: {
        findMany: jest.fn().mockResolvedValue(rosterSteamIds.map((steamId) => ({ player: { steamId } }))),
      },
    };
    const access = { getPassword: jest.fn().mockResolvedValue('secret') };
    return { service: new TournamentLaunchService(prisma as any, {} as any, {} as any, {} as any, access as any, {} as any), access };
  }

  it('omits play entirely for a visitor', async () => {
    const result = await service([]).service.connectInfo(matchId, null);
    expect(result[0]).toEqual(expect.objectContaining({ watch: '10.0.0.2:27020' }));
    expect(result[0]).not.toHaveProperty('play');
  });

  it('omits play entirely for a player of another team', async () => {
    const result = await service(['76561198000000099']).service.connectInfo(matchId, session('76561198000000001'));
    expect(result[0]).toHaveProperty('watch');
    expect(result[0]).not.toHaveProperty('play');
  });

  it('returns play to a player of the match', async () => {
    const result = await service(['76561198000000001']).service.connectInfo(matchId, session('76561198000000001'));
    expect(result[0]).not.toHaveProperty('watch');
    expect(result[0]).toHaveProperty('play', { address: '10.0.0.2:27015', password: 'secret' });
  });

  it('returns play to an admin', async () => {
    const result = await service([]).service.connectInfo(matchId, session('local-admin', 'admin'));
    expect(result[0]).toHaveProperty('watch', '10.0.0.2:27020');
    expect(result[0]).toHaveProperty('play', { address: '10.0.0.2:27015', password: 'secret' });
  });
});
