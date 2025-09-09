// event.command.ts
import type { BaseEvent } from './base.event';
import { EventTypes } from './event.types';


export type CommandEvent = BaseEvent<typeof EventTypes.COMMAND, {
  command: string;
  parameters: string[];
  sender: { name: string; steamId: string | null; team: string; channel: 'say' | 'say_team' };
}>;