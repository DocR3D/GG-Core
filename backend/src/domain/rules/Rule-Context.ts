// src/domain/rules/rule-context.ts
import type { MatchStateService } from '@app/state/match-state.service';
import type { MatchPhaseService } from '@app/phase/match-phase.service';
import type { MatchCommandsService } from '@app/commands/match-commands.service';
import type { WsBroadcaster } from '@adapters/ws/ws-broadcaster.service';

export type RuleContext = {
  matchId: string;
  serverId: string; // utile pour say()

  // Services
  matchStateService: MatchStateService;
  phase: MatchPhaseService;
  commands: MatchCommandsService;
  ws: WsBroadcaster;

  // Helpers “opinionated”
  say: (msg: string) => Promise<void>;
  pubEvent: (type: string, payload: any) => Promise<void>;
};
