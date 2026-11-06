import { Injectable } from '@nestjs/common';
import { PrismaService } from '@adapters/database/prisma.service';
import { EventTypes } from '@domain/events/event.types';

/** How one round of a game ended: who won it and how, with the score after it. */
export interface GameRound {
  number: number;
  winner: 'CT' | 'T' | 'none';
  /** elim, bomb_exploded, defused, time or draw (null when the log did not say) */
  reason: string | null;
  /** score after the round (null when the event carried none) */
  ct: number | null;
  t: number | null;
  at: number;
}

interface RoundWinRow {
  timestamp: bigint | number;
  payload: unknown;
}

type RoundWinPayload = { winner?: string; reason?: string; score?: { ct?: unknown; t?: unknown } };

const asScore = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The rounds of a game from its `team_round_win` events (oldest first).
 *
 * A round's number is the sum of the two scores after it (the server's own count), so it stays right across a backup
 * restore: when the game goes back to round N and replays, the events of the rounds after N are dropped and the
 * replayed ones take their place. Without a score on the event, the order of arrival numbers the round.
 */
export function roundsFromEvents(rows: RoundWinRow[]): GameRound[] {
  const byNumber = new Map<number, GameRound>();
  let sequence = 0;
  for (const row of rows) {
    sequence += 1;
    const p = (row.payload ?? {}) as RoundWinPayload;
    const ct = asScore(p.score?.ct);
    const t = asScore(p.score?.t);
    const number = ct !== null && t !== null ? ct + t : sequence;
    for (const n of [...byNumber.keys()]) if (n > number) byNumber.delete(n);
    byNumber.set(number, {
      number,
      winner: p.winner === 'CT' || p.winner === 'T' ? p.winner : 'none',
      reason: typeof p.reason === 'string' ? p.reason : null,
      ct,
      t,
      at: Number(row.timestamp),
    });
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/** Public read of a game's rounds (who won each one and how: nothing else of the event log is exposed). */
@Injectable()
export class GameRoundsService {
  constructor(private readonly prisma: PrismaService) {}

  async forGame(gameId: string): Promise<GameRound[]> {
    const rows = await this.prisma.eventPrimary.findMany({
      where: { matchId: gameId, type: EventTypes.TEAM_ROUND_WIN },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true, payload: true },
    });
    return roundsFromEvents(rows);
  }
}
