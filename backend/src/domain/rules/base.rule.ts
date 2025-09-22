import { AnyEvent } from '@domain/events/match.event';
import { CommandEvent } from '@domain/events/command.event';
import { EventType } from '@domain/events/event.types';
import { RuleContext } from './rule-context';
import { SaySpec } from '@app/match/messages/messages.types';

export interface PhaseRule {
  say?(rct: RuleContext): Promise<SaySpec>;
  canHandle(t: EventType): boolean;
  handle(ev: AnyEvent, ctx: RuleContext): Promise<void>;
  canHandleCommand?(cmd: string): boolean;
  handleCommand?(cmd: CommandEvent, ctx: RuleContext): Promise<void>;
  publicTypes?: ReadonlySet<EventType>;
  onEnter?(ctx: RuleContext): Promise<void>;
  onExit?(ctx: RuleContext): Promise<void>;
}

export abstract class BaseRule implements PhaseRule {
  protected readonly events = new Map<EventType, (ev: AnyEvent, ctx: RuleContext) => Promise<void>>();
  protected readonly commands = new Map<string, (cmd: CommandEvent, ctx: RuleContext) => Promise<void>>();
  async say?(rct: RuleContext): Promise<SaySpec>;
  canHandle(t: EventType) { return this.events.has(t); }
  async handle(ev: AnyEvent, ctx: RuleContext) { const f = this.events.get(ev.type); if (f) await f(ev as any, ctx); }
  canHandleCommand(cmd: string) { return this.commands.has(cmd); }
  async handleCommand(cmd: CommandEvent, ctx: RuleContext) { const f = this.commands.get(cmd.payload.command); if (f) await f(cmd, ctx); }

  async onEnter(_: RuleContext) {}
  async onExit(_: RuleContext) {}
  // + helpers say/broadcast/pubEvent… ici
}
