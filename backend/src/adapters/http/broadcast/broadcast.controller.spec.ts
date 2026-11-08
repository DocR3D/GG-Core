// src/adapters/http/broadcast/broadcast.controller.spec.ts
import { BroadcastController } from './broadcast.controller';
import { NotFoundException } from '@nestjs/common';

describe('BroadcastController', () => {
  let service: any;
  let controller: BroadcastController;

  beforeEach(() => {
    service = {
      createBroadcast: jest.fn().mockResolvedValue({ id: 'b-1', message: 'Hello' }),
      listBroadcasts: jest.fn().mockResolvedValue([{ id: 'b-1' }]),
      getBroadcast: jest.fn().mockImplementation((id: string) =>
        id === 'b-1' ? Promise.resolve({ id: 'b-1' }) : Promise.resolve(null),
      ),
      rearmBroadcast: jest.fn().mockResolvedValue({ id: 'b-1', roundsTotal: 4 }),
      cancelBroadcast: jest.fn().mockResolvedValue({ id: 'b-1', cancelled: true }),
    };

    controller = new BroadcastController(service);
  });

  it('createBroadcast delegates to service with session author', async () => {
    const req = { ggSession: { name: 'admin-maxime' } } as any;
    const res = await controller.createBroadcast({ message: 'Hello', roundsCount: 3 }, req);
    expect(res).toEqual({ id: 'b-1', message: 'Hello' });
    expect(service.createBroadcast).toHaveBeenCalledWith(
      { message: 'Hello', roundsCount: 3 },
      'admin-maxime',
    );
  });

  it('listBroadcasts delegates to service', async () => {
    const res = await controller.listBroadcasts();
    expect(res).toEqual([{ id: 'b-1' }]);
  });

  it('getBroadcast returns item or throws NotFoundException', async () => {
    await expect(controller.getBroadcast('b-1')).resolves.toEqual({ id: 'b-1' });
    await expect(controller.getBroadcast('b-unknown')).rejects.toThrow(NotFoundException);
  });

  it('rearmBroadcast delegates to service', async () => {
    const res = await controller.rearmBroadcast('b-1', { additionalRounds: 2 });
    expect(res).toEqual({ id: 'b-1', roundsTotal: 4 });
    expect(service.rearmBroadcast).toHaveBeenCalledWith('b-1', { additionalRounds: 2 });
  });

  it('cancelBroadcast delegates to service', async () => {
    const res = await controller.cancelBroadcast('b-1');
    expect(res).toEqual({ id: 'b-1', cancelled: true });
    expect(service.cancelBroadcast).toHaveBeenCalledWith('b-1');
  });
});
