import { Logger } from '@nestjs/common';
import { MessageService } from './message.service';
import { MessageMode, type SaySpec } from './messages.types';

const M = 'm-1';
const SERVER = 'srv-a';

function setup() {
  const cmds = { say: jest.fn().mockResolvedValue(undefined) };
  return { cmds, svc: new MessageService(cmds as never) };
}

describe('MessageService : repeated chat messages of a phase', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rotates through the messages in order and starts over, one every interval', () => {
    const { svc, cmds } = setup();
    svc.startPhase(M, 'warmup', SERVER, { mode: MessageMode.Rotate, intervalMs: 5000, items: ['a', 'b'] });

    jest.advanceTimersByTime(5000 * 3);

    expect(cmds.say.mock.calls).toEqual([[SERVER, 'a'], [SERVER, 'b'], [SERVER, 'a']]);
    svc.stop(M, 'warmup');
  });

  it('runs every message of a chain on its own interval', () => {
    const { svc, cmds } = setup();
    svc.startPhase(M, 'warmup', SERVER, {
      mode: MessageMode.Chain,
      items: [
        { text: 'fast', intervalMs: 2000 },
        { text: 'slow', intervalMs: 5000 },
      ],
    });

    jest.advanceTimersByTime(10000);

    const said = cmds.say.mock.calls.map((c) => c[1] as string);
    expect(said.filter((t) => t === 'fast')).toHaveLength(5);
    expect(said.filter((t) => t === 'slow')).toHaveLength(2);
    svc.stop(M, 'warmup');
  });

  it('picks the messages at random among the list', () => {
    const { svc, cmds } = setup();
    jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.99);
    svc.startPhase(M, 'warmup', SERVER, { mode: MessageMode.Random, intervalMs: 3000, items: ['a', 'b', 'c'] });

    jest.advanceTimersByTime(6000);

    expect(cmds.say.mock.calls).toEqual([[SERVER, 'a'], [SERVER, 'c']]);
    svc.stop(M, 'warmup');
  });

  it('starts several units together, and says nothing for a rotation or a draw with no message', () => {
    const { svc, cmds } = setup();
    svc.startPhase(M, 'warmup', SERVER, [
      { mode: MessageMode.Rotate, intervalMs: 1000, items: [] },
      { mode: MessageMode.Random, intervalMs: 1000, items: [] },
      { mode: MessageMode.Rotate, intervalMs: 1000, items: ['only'] },
    ]);

    jest.advanceTimersByTime(2000);

    expect(cmds.say.mock.calls).toEqual([[SERVER, 'only'], [SERVER, 'only']]);
    svc.stop(M, 'warmup');
  });

  it('never repeats faster than once a second, whatever the interval asked', () => {
    const { svc, cmds } = setup();
    svc.startPhase(M, 'warmup', SERVER, { mode: MessageMode.Rotate, intervalMs: 10, items: ['a'] });

    jest.advanceTimersByTime(999);
    expect(cmds.say).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(cmds.say).toHaveBeenCalledTimes(1);
    svc.stop(M, 'warmup');
  });

  it('starting a phase again replaces its timers instead of doubling them', () => {
    const { svc, cmds } = setup();
    const spec: SaySpec = { mode: MessageMode.Rotate, intervalMs: 1000, items: ['a'] };
    svc.startPhase(M, 'warmup', SERVER, spec);
    svc.startPhase(M, 'warmup', SERVER, spec);

    jest.advanceTimersByTime(3000);

    expect(cmds.say).toHaveBeenCalledTimes(3);
    svc.stop(M, 'warmup');
  });

  it('stops the messages of one phase and leaves the other phases running', () => {
    const { svc, cmds } = setup();
    svc.startPhase(M, 'warmup', SERVER, { mode: MessageMode.Rotate, intervalMs: 1000, items: ['warm'] });
    svc.startPhase(M, 'knife', SERVER, { mode: MessageMode.Rotate, intervalMs: 1000, items: ['knife'] });

    svc.stop(M, 'warmup');
    jest.advanceTimersByTime(2000);

    expect(cmds.say.mock.calls.map((c) => c[1])).toEqual(['knife', 'knife']);
    svc.stopPhaseGroups(M);
  });

  it('stops every phase of one match, answers how many timers it stopped, and leaves the other matches alone', () => {
    const { svc, cmds } = setup();
    svc.startPhase(M, 'warmup', SERVER, { mode: MessageMode.Rotate, intervalMs: 1000, items: ['a'] });
    svc.startPhase(M, 'knife', SERVER, [
      { mode: MessageMode.Rotate, intervalMs: 1000, items: ['b'] },
      { mode: MessageMode.Random, intervalMs: 1000, items: ['c'] },
    ]);
    svc.startPhase('m-2', 'warmup', 'srv-b', { mode: MessageMode.Rotate, intervalMs: 1000, items: ['other'] });

    expect(svc.stopPhaseGroups(M)).toBe(3);
    jest.advanceTimersByTime(1000);

    expect(cmds.say.mock.calls).toEqual([['srv-b', 'other']]);
    expect(svc.stopPhaseGroups(M)).toBe(0);
    svc.stopPhaseGroups('m-2');
  });

  it('stopping a phase that never started is harmless', () => {
    const { svc } = setup();
    expect(() => svc.stop(M, 'unknown')).not.toThrow();
  });

  it('keeps going when the server does not answer: the failure is logged, the timer stays', async () => {
    const { svc, cmds } = setup();
    cmds.say.mockRejectedValueOnce(new Error('rcon down'));
    svc.startPhase(M, 'warmup', SERVER, { mode: MessageMode.Rotate, intervalMs: 1000, items: ['a'] });

    await jest.advanceTimersByTimeAsync(2000);

    expect(cmds.say).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('rcon down'));
    svc.stop(M, 'warmup');
  });
});
