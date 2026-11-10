/**
 * ChatCommandHandler : what the bot does with a line typed in the game chat. Spectators and players without a team are
 * ignored in silence (nothing done, nothing said, so the players are never disturbed), a player cannot flood the bot,
 * the command goes to the rule of the current phase, and !init (start a match from the chat, outside a tournament) is
 * a development tool: it works only in the dev mode (GG_ENV=dev).
 */
import { Logger } from '@nestjs/common';
import { ChatCommandHandler } from './chat-commands.handler';

const M = 'm-1';
const SERVER = 'srv-a';

type Team = 'CT' | 'T' | 'SPECTATOR' | 'Unassigned';

function event(command: string, over: { team?: Team; steamId?: string | null; name?: string; parameters?: string[]; matchId?: string | null; kind?: string } = {}) {
  return {
    type: 'command',
    matchId: over.matchId === undefined ? M : over.matchId,
    serverId: SERVER,
    ...(over.kind ? { kind: over.kind } : {}),
    payload: {
      command,
      parameters: over.parameters ?? [],
      sender: { name: over.name ?? 'Garitos', steamId: over.steamId === undefined ? '[U:1:1]' : over.steamId, team: over.team ?? 'CT', channel: 'say' },
    },
  } as never;
}

function setup(opts: { handles?: boolean; config?: { resolveCommand: jest.Mock } } = {}) {
  const rule = { canHandleCommand: jest.fn().mockReturnValue(opts.handles ?? true), handleCommand: jest.fn().mockResolvedValue(undefined) };
  const registry = { getRule: jest.fn().mockReturnValue(rule) };
  const ctx = { say: jest.fn() };
  const ctxFactory = { make: jest.fn().mockReturnValue(ctx) };
  const phase = { getPhase: jest.fn().mockResolvedValue('live_main') };
  const matchCmds = {
    ensureInitMatch: jest.fn().mockResolvedValue({ matchId: 'm-new' }),
    changeLevel: jest.fn().mockResolvedValue(undefined),
  };
  const handler = new ChatCommandHandler(registry as never, ctxFactory as never, phase as never, matchCmds as never, opts.config as never);
  return { handler, rule, registry, ctx, ctxFactory, phase, matchCmds };
}

describe('ChatCommandHandler', () => {
  let warn: jest.SpyInstance;
  let envBefore: string | undefined;
  beforeEach(() => {
    envBefore = process.env.GG_ENV;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (envBefore === undefined) delete process.env.GG_ENV;
    else process.env.GG_ENV = envBefore;
  });

  describe('a command from a player', () => {
    it('goes to the rule of the current phase, with the context of the match, when the rule handles it', async () => {
      const { handler, rule, registry, phase, ctxFactory, ctx } = setup();
      const ev = event('ready');

      await handler.handle(ev);

      expect(phase.getPhase).toHaveBeenCalledWith(M);
      expect(registry.getRule).toHaveBeenCalledWith('live_main');
      expect(rule.canHandleCommand).toHaveBeenCalledWith('ready');
      expect(ctxFactory.make).toHaveBeenCalledWith({ matchId: M, serverId: SERVER });
      expect(rule.handleCommand).toHaveBeenCalledWith(ev, ctx);
    });

    it.each(['!ready', '.READY', '/Ready', '  ready '])('is read without its prefix, its case or its spaces: "%s"', async (typed) => {
      const { handler, rule } = setup();

      await handler.handle(event(typed));

      expect(rule.canHandleCommand).toHaveBeenCalledWith('ready');
    });

    it('does nothing when no rule of the phase and no global command knows it', async () => {
      const { handler, rule, matchCmds } = setup({ handles: false });

      await handler.handle(event('dance'));

      expect(rule.handleCommand).not.toHaveBeenCalled();
      expect(matchCmds.ensureInitMatch).not.toHaveBeenCalled();
    });
  });

  describe('a line from somebody who is not playing', () => {
    it.each<Team>(['SPECTATOR', 'Unassigned'])('is ignored in silence when he is "%s": nothing done, nothing said', async (team) => {
      const { handler, rule, registry, ctxFactory, ctx, matchCmds } = setup();

      await handler.handle(event('pause', { team }));
      await handler.handle(event('ready', { team, steamId: '[U:1:2]' }));
      await handler.handle(event('restore', { team, steamId: '[U:1:3]', parameters: ['3'] }));

      expect(rule.handleCommand).not.toHaveBeenCalled();
      expect(registry.getRule).not.toHaveBeenCalled();
      expect(ctxFactory.make).not.toHaveBeenCalled();
      expect(ctx.say).not.toHaveBeenCalled();
      expect(matchCmds.ensureInitMatch).not.toHaveBeenCalled();
    });

    it('is ignored even with a command that is not known, and a command that is only the prefix', async () => {
      const { handler, rule } = setup();

      await handler.handle(event('dance', { team: 'SPECTATOR' }));
      await handler.handle(event('!', { team: 'SPECTATOR', steamId: '[U:1:9]' }));

      expect(rule.handleCommand).not.toHaveBeenCalled();
    });
  });

  describe('!init, a development tool', () => {
    it('starts a match from the chat in dev mode, with the match, the map and the team names it was given', async () => {
      process.env.GG_ENV = 'dev';
      const { handler, matchCmds } = setup({ handles: false }); // no rule of a phase handles !init: it is a global command

      await handler.handle(event('init', { parameters: ['m-9', 'de_nuke', 'Démo Rouge', 'Démo Bleue'] }));

      expect(matchCmds.ensureInitMatch).toHaveBeenCalledWith(SERVER, 'm-9', 'de_nuke', 'Démo Rouge', 'Démo Bleue', {});
      expect(matchCmds.changeLevel).toHaveBeenCalledWith({ serverId: SERVER, map: 'de_nuke' });
    });

    it.each([
      [[], undefined, undefined, undefined, undefined],
      [['de_nuke'], undefined, 'de_nuke', undefined, undefined],
      [['de_nuke', 'Rouge'], undefined, 'de_nuke', 'Rouge', undefined],
      [['de_nuke', 'Rouge', 'Bleue'], undefined, 'de_nuke', 'Rouge', 'Bleue'],
    ])('reads %j as map, home and away when there is no match id, and falls back to the match of the event', async (parameters, matchIdParam, map, home, away) => {
      process.env.GG_ENV = 'dev';
      const { handler, matchCmds } = setup({ handles: false }); // no rule of a phase handles !init: it is a global command

      await handler.handle(event('init', { parameters }));

      expect(matchCmds.ensureInitMatch).toHaveBeenCalledWith(SERVER, matchIdParam ?? M, map, home, away, {});
      if (map) expect(matchCmds.changeLevel).toHaveBeenCalledWith({ serverId: SERVER, map });
      else expect(matchCmds.changeLevel).not.toHaveBeenCalled();
    });

    it('ignores empty parameters', async () => {
      process.env.GG_ENV = 'dev';
      const { handler, matchCmds } = setup({ handles: false }); // no rule of a phase handles !init: it is a global command

      await handler.handle(event('init', { parameters: ['  ', 'de_nuke', ''] }));

      expect(matchCmds.ensureInitMatch).toHaveBeenCalledWith(SERVER, M, 'de_nuke', undefined, undefined, {});
    });

    it.each<Team>(['SPECTATOR', 'Unassigned'])('is the one command still accepted from somebody who is "%s", for the first line typed on a new server', async (team) => {
      process.env.GG_ENV = 'dev';
      const { handler, matchCmds } = setup({ handles: false }); // no rule of a phase handles !init: it is a global command

      await handler.handle(event('init', { team, parameters: ['de_nuke'] }));

      expect(matchCmds.ensureInitMatch).toHaveBeenCalledTimes(1);
    });

    it.each(['prod', 'rec', '', 'development', undefined])('does nothing, for anybody, when GG_ENV is %j', async (value) => {
      if (value === undefined) delete process.env.GG_ENV;
      else process.env.GG_ENV = value;
      const { handler, matchCmds, rule } = setup();

      await handler.handle(event('init', { parameters: ['de_nuke'] }));
      await handler.handle(event('init', { team: 'SPECTATOR', steamId: '[U:1:2]', parameters: ['de_nuke'] }));

      expect(matchCmds.ensureInitMatch).not.toHaveBeenCalled();
      expect(matchCmds.changeLevel).not.toHaveBeenCalled();
      expect(rule.handleCommand).not.toHaveBeenCalled();
    });

    it('is closed too when the tournament renames it: the alias leads to the same command', async () => {
      process.env.GG_ENV = 'prod';
      const config = { resolveCommand: jest.fn().mockResolvedValue({ canonical: 'init', isAllowed: true }) };
      const { handler, matchCmds } = setup({ config });

      await handler.handle(event('demarrer', { parameters: ['de_nuke'] }));

      expect(config.resolveCommand).toHaveBeenCalledWith(M, 'demarrer');
      expect(matchCmds.ensureInitMatch).not.toHaveBeenCalled();
    });
  });

  describe('what is thrown away before anything else', () => {
    it('a line with no match is dropped with a warning that names the server', async () => {
      const { handler, rule } = setup();

      await handler.handle(event('ready', { matchId: null }));

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(SERVER));
      expect(rule.handleCommand).not.toHaveBeenCalled();
    });

    it.each([
      ['no sender', { type: 'command', matchId: M, serverId: SERVER, payload: { command: 'ready', parameters: [] } }],
      ['no command', { type: 'command', matchId: M, serverId: SERVER, payload: { command: '', parameters: [], sender: { name: 'n', steamId: 's', team: 'CT' } } }],
      ['no payload', { type: 'command', matchId: M, serverId: SERVER }],
    ])('a line with %s is dropped with a warning', async (_label, ev) => {
      const { handler, rule } = setup();

      await handler.handle(ev as never);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad payload'));
      expect(rule.handleCommand).not.toHaveBeenCalled();
    });

    it('a line that is not of the primary flow is dropped without a warning', async () => {
      const { handler, rule } = setup();

      await handler.handle(event('ready', { kind: 'telemetry' }));

      expect(warn).not.toHaveBeenCalled();
      expect(rule.handleCommand).not.toHaveBeenCalled();
    });
  });

  describe('the tournament configuration', () => {
    it('lets the tournament rename a command: the rule gets the canonical name', async () => {
      const config = { resolveCommand: jest.fn().mockResolvedValue({ canonical: 'ready', isAllowed: true }) };
      const { handler, rule } = setup({ config });
      const ev = event('rdy');

      await handler.handle(ev);

      expect(config.resolveCommand).toHaveBeenCalledWith(M, 'rdy');
      expect(rule.canHandleCommand).toHaveBeenCalledWith('ready');
      expect((ev as { payload: { command: string } }).payload.command).toBe('ready');
    });

    it('drops a command the tournament switched off', async () => {
      const config = { resolveCommand: jest.fn().mockResolvedValue({ canonical: 'pause', isAllowed: false }) };
      const { handler, rule } = setup({ config });

      await handler.handle(event('pause'));

      expect(rule.handleCommand).not.toHaveBeenCalled();
    });

    it('keeps the command as typed when the tournament does not know it', async () => {
      const config = { resolveCommand: jest.fn().mockResolvedValue(null) };
      const { handler, rule } = setup({ config });

      await handler.handle(event('ready'));

      expect(rule.canHandleCommand).toHaveBeenCalledWith('ready');
    });
  });

  describe('flooding', () => {
    it('answers a player at most once every 0.8 s, and again after that', async () => {
      jest.useFakeTimers({ now: 1_000_000 });
      const { handler, rule } = setup();

      await handler.handle(event('ready'));
      jest.setSystemTime(1_000_500);
      await handler.handle(event('ready'));
      jest.setSystemTime(1_000_900);
      await handler.handle(event('ready'));

      expect(rule.handleCommand).toHaveBeenCalledTimes(2);
    });

    it('counts each player, and each match, on his own', async () => {
      jest.useFakeTimers({ now: 1_000_000 });
      const { handler, rule } = setup();

      await handler.handle(event('ready', { steamId: '[U:1:1]' }));
      await handler.handle(event('ready', { steamId: '[U:1:2]' }));
      await handler.handle(event('ready', { steamId: '[U:1:1]', matchId: 'm-2' }));

      expect(rule.handleCommand).toHaveBeenCalledTimes(3);
    });

    it('tells players apart by name when there is no Steam id (a bot, a test)', async () => {
      jest.useFakeTimers({ now: 1_000_000 });
      const { handler, rule } = setup();

      await handler.handle(event('ready', { steamId: null, name: 'Bot1' }));
      await handler.handle(event('ready', { steamId: null, name: 'Bot2' }));
      await handler.handle(event('ready', { steamId: null, name: 'Bot1' }));

      expect(rule.handleCommand).toHaveBeenCalledTimes(2);
    });
  });
});
