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

function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    tokens.push(
      m[1] !== undefined ? m[1] :
      m[2] !== undefined ? m[2] :
      m[3] !== undefined ? m[3] : ''
    );
  }
  return tokens;
}

export function buildCommandEvent(opts: {
  rawMessage: string;
  matchId: string;
  serverId: string;
  sender: { name: string; steamId: string | null; team: 'T'|'CT'|'SPECTATOR'|'Unassigned'; channel: 'say'|'say_team' };
  id: string;             // UUID fourni par l’appelant
  timestamp?: number;     // ms; défaut: Date.now()
  source?: 'logs'|'cstv'|'manual';
  kind?: 'primary'|'telemetry';
}): CommandEvent {
  const tokens = tokenize(opts.rawMessage.trim());
  const command = tokens.shift() ?? '';         // aucun contrôle ici
  const parameters = tokens;
  return {
    v: 1,
    id: opts.id,
    timestamp: opts.timestamp ?? Date.now(),
    type: EventTypes.COMMAND,
    matchId: opts.matchId,
    serverId: opts.serverId,
    source: opts.source ?? 'logs',
    kind: opts.kind ?? 'primary',
    payload: {
      command,          // ex: "!init"
      parameters,       // ex: ["de_inferno","CT","T"]
      sender: opts.sender,
    },
  };
}