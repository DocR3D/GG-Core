// src/domain/rules/base.rule.spec.ts
import { BaseRule } from './base.rule';
import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from './rule-context';

class TestRule extends BaseRule {
  name = 'test_rule' as const;
  public handlerCalled = false;
  public lastCmd: CommandEvent | null = null;

  constructor() {
    super();
    this.commands.set('ready', this.handleReady.bind(this));
    this.commands.set('stay', this.handleStay.bind(this));
  }

  private async handleReady(cmd: CommandEvent) {
    this.handlerCalled = true;
    this.lastCmd = cmd;
  }

  private async handleStay(cmd: CommandEvent) {
    this.handlerCalled = true;
    this.lastCmd = cmd;
  }
}

describe('BaseRule - Command Dispatch & Prefix Stripping', () => {
  let rule: TestRule;
  let mockCtx: RuleContext;

  beforeEach(() => {
    rule = new TestRule();
    mockCtx = {} as any;
  });

  it('canHandleCommand doit accepter les commandes avec ou sans préfixe (!, .)', () => {
    expect(rule.canHandleCommand('ready')).toBe(true);
    expect(rule.canHandleCommand('!ready')).toBe(true);
    expect(rule.canHandleCommand('.ready')).toBe(true);
    expect(rule.canHandleCommand('!stay')).toBe(true);
    expect(rule.canHandleCommand('unknown')).toBe(false);
  });

  it('handleCommand doit exécuter le handler enregistré même si le payload contient !ready', async () => {
    const cmdEvent: CommandEvent = {
      type: 'command',
      matchId: 'm-1',
      serverId: 'srv-a',
      timestamp: Date.now(),
      payload: {
        command: '!ready',
        parameters: [],
        sender: { name: 'Player1', steamId: '76561198000000001', team: 'CT' },
      },
    };

    await rule.handleCommand(cmdEvent, mockCtx);

    expect(rule.handlerCalled).toBe(true);
    expect(rule.lastCmd).toBe(cmdEvent);
  });

  it('handleCommand doit exécuter le handler enregistré si le payload contient stay ou !stay', async () => {
    const cmdEvent: CommandEvent = {
      type: 'command',
      matchId: 'm-1',
      serverId: 'srv-a',
      timestamp: Date.now(),
      payload: {
        command: '!stay',
        parameters: [],
        sender: { name: 'Player1', steamId: '76561198000000001', team: 'CT' },
      },
    };

    await rule.handleCommand(cmdEvent, mockCtx);

    expect(rule.handlerCalled).toBe(true);
  });
});
