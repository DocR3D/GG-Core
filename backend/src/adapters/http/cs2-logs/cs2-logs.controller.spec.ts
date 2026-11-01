import { BadRequestException } from '@nestjs/common';
import { Cs2LogsController } from './cs2-logs.controller';

/** main.ts reads /cs2/logs as raw text for every content type: the body always arrives as a string. */
describe('Cs2LogsController', () => {
  const handleEvents = jest.fn().mockResolvedValue(undefined);
  const controller = new Cs2LogsController(
    { handleEvents } as any,
    { getMatchIdFromServerId: jest.fn().mockResolvedValue('m-1') } as any,
  );
  const req = (contentType: string) => ({ header: () => undefined, query: {}, headers: { 'content-type': contentType }, ip: '127.0.0.1' }) as any;

  beforeEach(() => handleEvents.mockClear());

  it('parses a JSON array sent as text and adds the server / match hints', async () => {
    const body = JSON.stringify([{ type: 'kill', payload: {} }, { type: 'assist', payload: {}, matchId: 'm-own' }]);
    const res = await controller.receive(req('application/json'), body, 'srv-a');
    expect(res).toEqual({ ok: true, n: 2 });
    expect(handleEvents).toHaveBeenCalledWith([
      { type: 'kill', payload: {}, serverId: 'srv-a', matchId: 'm-1' },
      { type: 'assist', payload: {}, matchId: 'm-own', serverId: 'srv-a' },
    ]);
  });

  it('accepts { events: [...] } and a single event', async () => {
    await controller.receive(req('application/json'), JSON.stringify({ events: [{ type: 'kill', payload: {} }] }));
    await controller.receive(req('application/json'), JSON.stringify({ type: 'kill', payload: {} }));
    expect(handleEvents).toHaveBeenCalledTimes(2);
  });

  it('reads NDJSON line by line and drops the broken lines', async () => {
    const body = '{"type":"kill","payload":{}}\nnot json\n{"type":"assist","payload":{}}\n';
    const res = await controller.receive(req('application/x-ndjson'), body);
    expect(res).toEqual({ ok: true, n: 2 });
  });

  it('refuses a body that is not JSON', async () => {
    await expect(controller.receive(req('application/json'), 'not json')).rejects.toThrow(BadRequestException);
  });
});
