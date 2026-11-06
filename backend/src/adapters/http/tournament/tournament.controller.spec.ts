import { HEADERS_METADATA } from '@nestjs/common/constants';
import type { Session } from '@app/auth/auth.service';
import { TournamentController } from './tournament.controller';

const captain: Session = { sub: '76561198000000001', role: 'player', name: 'cap', via: 'steam' };
const otherCaptain: Session = { sub: '76561198000000002', role: 'player', name: 'other', via: 'steam' };
const admin: Session = { sub: 'local-admin', role: 'admin', name: 'admin', via: 'password' };

describe('TournamentController JSON veto and connect routes', () => {
  let veto: Record<string, jest.Mock>;
  let launch: Record<string, jest.Mock>;
  let actions: { execute: jest.Mock };
  let gameRounds: { forGame: jest.Mock };
  let controller: TournamentController;

  beforeEach(() => {
    const state = { matchId: 'm1', seq: 4, phase: 'veto' };
    veto = {
      playRps: jest.fn().mockResolvedValue(state),
      chooseStart: jest.fn().mockResolvedValue(state),
      playStep: jest.fn().mockResolvedValue(state),
      undo: jest.fn().mockResolvedValue(state),
      reset: jest.fn().mockResolvedValue(state),
      getState: jest.fn().mockResolvedValue(state),
    };
    launch = { connectInfo: jest.fn().mockResolvedValue([]) };
    actions = {
      execute: jest.fn(async (id, session: Session, action) => {
        await action({ steamId: session.via === 'steam' ? session.sub : undefined, admin: session.role === 'admin', name: session.name });
        return state;
      }),
    };
    gameRounds = { forGame: jest.fn().mockResolvedValue([{ number: 1, winner: 'CT', reason: 'defused', ct: 1, t: 0, at: 5 }]) };
    controller = new TournamentController({} as any, launch as any, veto as any, {} as any, {} as any, actions as any, gameRounds as any);
  });

  it('delegates every action with the same body shapes and returns the caller state', async () => {
    await expect(controller.vetoRps('m1', { choice: 'rock' }, { ggSession: captain } as any)).resolves.toMatchObject({ matchId: 'm1' });
    expect(veto.playRps).toHaveBeenCalledWith('m1', expect.objectContaining({ steamId: captain.sub, admin: false }), 'rock');

    await controller.vetoStart('m1', { first: 'true', teamId: 'team-a' }, { ggSession: captain } as any);
    expect(veto.chooseStart).toHaveBeenCalledWith('m1', expect.anything(), { first: true, teamId: 'team-a' });

    await controller.vetoStep('m1', { map: 'de_nuke', side: 'CT' }, { ggSession: captain } as any);
    expect(veto.playStep).toHaveBeenCalledWith('m1', expect.anything(), { map: 'de_nuke', side: 'CT' });

    await controller.vetoUndo('m1', { ggSession: admin } as any);
    expect(veto.undo).toHaveBeenCalledWith('m1', expect.objectContaining({ admin: true }));

    await controller.vetoReset('m1', { ggSession: admin } as any);
    expect(veto.reset).toHaveBeenCalledWith('m1', expect.objectContaining({ admin: true }));
    expect(actions.execute).toHaveBeenCalledTimes(5);
  });

  it('passes visitor and other-captain sessions to the shared authority', async () => {
    actions.execute.mockRejectedValueOnce(new Error('visitor rejected'));
    await expect(controller.vetoRps('m1', { choice: 'rock' }, { ggSession: null } as any)).rejects.toThrow('visitor rejected');
    actions.execute.mockRejectedValueOnce(new Error('other captain rejected'));
    await expect(controller.vetoRps('m1', { choice: 'rock' }, { ggSession: otherCaptain } as any)).rejects.toThrow('other captain rejected');
  });

  it('lets an admin actor reach admin actions', async () => {
    await controller.vetoUndo('m1', { ggSession: admin } as any);
    expect(veto.undo).toHaveBeenCalledWith('m1', expect.objectContaining({ admin: true, name: 'admin' }));
  });

  it('gives the rounds of a game under its id (public, nothing of the event log but the rounds)', async () => {
    await expect(controller.rounds('g1')).resolves.toEqual({ gameId: 'g1', rounds: [{ number: 1, winner: 'CT', reason: 'defused', ct: 1, t: 0, at: 5 }] });
    expect(gameRounds.forGame).toHaveBeenCalledWith('g1');
  });

  it('delegates connect with the backend session and declares private no-store', async () => {
    launch.connectInfo.mockResolvedValueOnce([{ order: 1, watch: 'host:27020' }]);
    await expect(controller.connect('m1', { ggSession: captain } as any)).resolves.toEqual([{ order: 1, watch: 'host:27020' }]);
    expect(launch.connectInfo).toHaveBeenCalledWith('m1', captain);
    expect(Reflect.getMetadata(HEADERS_METADATA, controller.connect)).toEqual([{ name: 'Cache-Control', value: 'private, no-store' }]);
  });
});
