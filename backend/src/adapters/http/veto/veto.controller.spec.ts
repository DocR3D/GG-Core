import { ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import type { Session } from '@app/auth/auth.service';
import { VetoController } from './veto.controller';

const captain: Session = { sub: '76561198000000001', role: 'player', name: 'cap', via: 'steam' };

describe('VetoController HTML forms', () => {
  const response = () => ({ redirect: jest.fn() }) as unknown as Response & { redirect: jest.Mock };

  it('redirects 303 to the veto page after success', async () => {
    const actions = { execute: jest.fn().mockResolvedValue({ matchId: 'm1' }) };
    const controller = new VetoController({ playRps: jest.fn() } as any, actions as any);
    const res = response();
    await controller.rps('m1', { _form: '1', choice: 'rock' }, { ggSession: captain } as any, res);
    expect(actions.execute).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenCalledWith(303, '/veto/m1');
  });

  it('redirects 303 with the refusal on the requested admin page', async () => {
    const actions = { execute: jest.fn().mockRejectedValue(new ForbiddenException('not your turn')) };
    const controller = new VetoController({ playStep: jest.fn() } as any, actions as any);
    const res = response();
    await controller.step('m1', { _form: '1', _page: 'admin', map: 'de_nuke' }, { ggSession: captain } as any, res);
    expect(actions.execute).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenCalledWith(303, '/veto/m1/admin?error=not%20your%20turn');
  });
});
