import type { BaseEvent } from './base.event';
import { EventTypes } from './event.types';


export type ChatEvent = BaseEvent<typeof EventTypes.CHAT_MESSAGE,{
  channel: 'say' | 'say_team';
  player: {
    name: string;
    userId: number | null;
    steamId: string | null;   // peut être STEAM_X:Y:Z ou un autre format
    team: string; // as logged: CT, TERRORIST, Spectator, Unassigned
  };
  message: string;
}>;