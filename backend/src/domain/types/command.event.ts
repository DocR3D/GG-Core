// event.command.ts
import type { BaseEvent } from './base.event';
import { EventTypes } from './event.types';

export type CommandEvent = BaseEvent<typeof EventTypes.COMMAND, {
  command: string;
  parameters: string[];
  sender: {
    name: string;
    steamId: string | null;
    team: 'T' | 'CT' | 'SPECTATOR' | 'Unassigned';
    channel: 'say' | 'say_team';
  };
}>;