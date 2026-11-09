import { ReadyCommand } from './ready.command';

const MATCH_ID = 'm-ready';

function makeEvent(command: string, team: string = 'CT', name = 'Garitos') {
  return {
    type: 'command',
    matchId: MATCH_ID,
    serverId: 'srv-1',
    payload: { command, parameters: [], sender: { name, steamId: 'STEAM_1', team } },
  } as never;
}

function makeCtx(logical: 'home' | 'away' | null = 'home') {
  return {
    matchId: MATCH_ID,
    say: jest.fn().mockResolvedValue(undefined),
    orch: {
      sideToLogical: jest.fn().mockResolvedValue(logical),
      setReady: jest.fn().mockResolvedValue(undefined),
    },
  } as never as {
    say: jest.Mock;
    orch: { sideToLogical: jest.Mock; setReady: jest.Mock };
  } & Record<string, unknown>;
}

describe('ReadyCommand : canHandle', () => {
  it.each(['ready', '!ready', '.READY', 'unready', '!notready'])('accepts "%s" from a player whose side is known', async (command) => {
    const ctx = makeCtx('home');

    expect(await new ReadyCommand().canHandle(makeEvent(command), ctx as never)).toBe(true);
    expect(ctx.orch.sideToLogical).toHaveBeenCalledWith(MATCH_ID, 'CT');
  });

  it('ignores any other command, without answering in the chat', async () => {
    const ctx = makeCtx();

    expect(await new ReadyCommand().canHandle(makeEvent('pause'), ctx as never)).toBe(false);
    expect(ctx.say).not.toHaveBeenCalled();
  });

  it.each(['SPECTATOR', 'UNASSIGNED'])('tells a player who is not in a team to join one (%s)', async (team) => {
    const ctx = makeCtx();

    expect(await new ReadyCommand().canHandle(makeEvent('ready', team), ctx as never)).toBe(false);
    expect(ctx.say).toHaveBeenCalledWith('Vous devez être dans une équipe pour utiliser cette commande.');
    expect(ctx.orch.sideToLogical).not.toHaveBeenCalled();
  });

  it('refuses when the side of the player maps to no team', async () => {
    expect(await new ReadyCommand().canHandle(makeEvent('ready'), makeCtx(null) as never)).toBe(false);
  });
});

describe('ReadyCommand : handle', () => {
  it('marks the team of the player ready and says who is ready', async () => {
    const ctx = makeCtx('away');

    expect(await new ReadyCommand().handle(makeEvent('!ready', 'T'), ctx as never)).toBe(true);

    expect(ctx.orch.sideToLogical).toHaveBeenCalledWith(MATCH_ID, 'T');
    expect(ctx.orch.setReady).toHaveBeenCalledWith(MATCH_ID, 'away', true);
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining('Garitos est maintenant prêt'));
  });

  it.each(['unready', '!unready', 'notready'])('"%s" marks the team not ready and says so', async (command) => {
    const ctx = makeCtx('home');

    expect(await new ReadyCommand().handle(makeEvent(command), ctx as never)).toBe(true);

    expect(ctx.orch.setReady).toHaveBeenCalledWith(MATCH_ID, 'home', false);
    expect(ctx.say).toHaveBeenCalledWith(expect.stringContaining("Garitos n'est plus prêt"));
  });

  it('does nothing for a player who is not in a team', async () => {
    const ctx = makeCtx();

    expect(await new ReadyCommand().handle(makeEvent('ready', 'SPECTATOR'), ctx as never)).toBe(false);
    expect(ctx.orch.setReady).not.toHaveBeenCalled();
    expect(ctx.say).not.toHaveBeenCalled();
  });

  it('does nothing when the side of the player maps to no team', async () => {
    const ctx = makeCtx(null);

    expect(await new ReadyCommand().handle(makeEvent('ready'), ctx as never)).toBe(false);
    expect(ctx.orch.setReady).not.toHaveBeenCalled();
    expect(ctx.say).not.toHaveBeenCalled();
  });
});
