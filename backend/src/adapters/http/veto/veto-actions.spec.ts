import { ForbiddenException, HttpException } from '@nestjs/common';
import type { Session } from '@app/auth/auth.service';
import { TournamentError } from '@app/tournament/tournament-stages.service';
import { Test } from '@nestjs/testing';
import { VetoService } from '@app/tournament/veto.service';
import { RealtimeEmitter } from '@adapters/ws/ws-emitter.internal';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { HttpModule } from '../http.module';
import { VetoActions, vetoFirst } from './veto-actions';

const captain: Session = { sub: '76561198000000001', role: 'player', name: 'cap', via: 'steam' };
const admin: Session = { sub: 'local-admin', role: 'admin', name: 'admin', via: 'password' };

describe('VetoActions', () => {
  const setup = () => {
    const caller = { matchId: 'm1', seq: 2, viewer: { teamId: 'home' } };
    const publicState = { matchId: 'm1', seq: 2, viewer: { teamId: null } };
    const veto = { getState: jest.fn().mockResolvedValueOnce(publicState).mockResolvedValueOnce(caller) };
    const realtime = { emitPublic: jest.fn() };
    return { actions: new VetoActions(veto as any, realtime as any), veto, realtime, caller, publicState };
  };

  it('is constructible by Nest with its registered dependency tokens', async () => {
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, HttpModule)).toContain(VetoActions);
    const module = await Test.createTestingModule({
      providers: [
        VetoActions,
        { provide: VetoService, useValue: { getState: jest.fn() } },
        { provide: RealtimeEmitter, useValue: { emitPublic: jest.fn() } },
      ],
    }).compile();
    expect(module.get(VetoActions)).toBeInstanceOf(VetoActions);
  });

  it('requires an actor', async () => {
    const { actions, realtime } = setup();
    await expect(actions.execute('m1', null, jest.fn())).rejects.toBeInstanceOf(HttpException);
    expect(realtime.emitPublic).not.toHaveBeenCalled();
  });

  it('executes, emits the public state once, and returns the caller state', async () => {
    const { actions, realtime, caller, publicState } = setup();
    const mutation = jest.fn().mockResolvedValue(undefined);
    await expect(actions.execute('m1', captain, mutation)).resolves.toBe(caller);
    expect(mutation).toHaveBeenCalledWith(expect.objectContaining({ steamId: captain.sub, admin: false }));
    expect(realtime.emitPublic).toHaveBeenCalledTimes(1);
    expect(realtime.emitPublic).toHaveBeenCalledWith('m1', 'veto:updated', expect.objectContaining({ matchId: 'm1', seq: 2, payload: publicState }));
  });

  it('does not emit when the mutation fails and maps domain errors', async () => {
    const { actions, realtime } = setup();
    await expect(actions.execute('m1', captain, jest.fn().mockRejectedValue(new TournamentError('forbidden', 'wrong team')))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(realtime.emitPublic).not.toHaveBeenCalled();
  });

  it('does not fail a successful mutation when emitPublic throws', async () => {
    const { actions, realtime, caller } = setup();
    realtime.emitPublic.mockImplementation(() => {
      throw new Error('socket down');
    });
    await expect(actions.execute('m1', admin, jest.fn().mockResolvedValue(undefined))).resolves.toBe(caller);
    expect(realtime.emitPublic).toHaveBeenCalledTimes(1);
  });

  it('coerces first in one shared place', () => {
    expect(vetoFirst(undefined)).toBeUndefined();
    expect(vetoFirst(true)).toBe(true);
    expect(vetoFirst('true')).toBe(true);
    expect(vetoFirst(false)).toBe(false);
    expect(vetoFirst('false')).toBe(false);
  });
});
