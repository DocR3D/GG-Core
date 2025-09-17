// shared/periodic/job.types.ts
export interface PeriodicMessage {
  id: string;                     // unique par match (ex: `pause:<matchId>`)
  tick: () => Promise<void> | void;
  intervalMs: number;             // ex: 30_000
}
