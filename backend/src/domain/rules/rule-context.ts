// src/domain/rules/rule-context.ts
import type { MatchStateService } from '@app/match/state/match-state.service';
import type { MatchOrchestrator } from '@app/match/match-orchestrator.service';

export type RuleContext = {
  matchId: string;
  serverId?: string;

  // write
  orch: MatchOrchestrator;

  // read-only
  state: Pick<
    MatchStateService,
    | 'getSnapshot'
    | 'getScore'
    | 'getServerIdFromMatchId'
    | 'getMatchIdFromServerId'
    | 'getPlayers'              // 👈 ajoute ceci
  >;

  // helpers conservés
  say: (msg: string) => Promise<void>;
  pubEvent: (type: string, payload: any) => Promise<void>;
};
