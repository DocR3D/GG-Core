import type { BaseEvent } from './base.event';
import { EventTypes } from './event.types';


export type RawLogEvent = BaseEvent<typeof EventTypes.LOG, {
  line: string;
}>;
