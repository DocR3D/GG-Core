// src/adapters/postgres/match-history.repository.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from './postgres.module';

export type MatchHistoryRow = {
  id_match: number;
  event_type: string;
  round?: number | null;
  score_equipe1?: number | null;
  score_equipe2?: number | null;
  id_ct?: string | null;
  id_t?: string | null;
  recovery_number?: number | null;
  data?: Record<string, unknown> | null;
};

export type MatchHistoryEntry = {
  id: number;
  id_match: number;
  event_type: string;
  date: Date;
  round: number | null;
  score_equipe1: number | null;
  score_equipe2: number | null;
  id_ct: string | null;
  id_t: string | null;
  recovery_number: number | null;
  data: Record<string, unknown> | null;
};

@Injectable()
export class MatchHistoryRepository {
  private readonly logger = new Logger(MatchHistoryRepository.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async insert(row: MatchHistoryRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO "MatchHistory"
         (id_match, event_type, date, round, score_equipe1, score_equipe2, id_ct, id_t, recovery_number, data)
       VALUES ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.id_match,
        row.event_type,
        row.round ?? null,
        row.score_equipe1 ?? null,
        row.score_equipe2 ?? null,
        row.id_ct ?? null,
        row.id_t ?? null,
        row.recovery_number ?? null,
        row.data ? JSON.stringify(row.data) : null,
      ],
    );
    this.logger.debug(`MatchHistory inserted: match_db_id=${row.id_match} event=${row.event_type}`);
  }

  async findByMatchId(matchDbId: number): Promise<MatchHistoryEntry[]> {
    const result = await this.pool.query<MatchHistoryEntry>(
      `SELECT id, id_match, event_type, date, round, score_equipe1, score_equipe2,
              id_ct, id_t, recovery_number, data
       FROM "MatchHistory"
       WHERE id_match = $1
       ORDER BY date ASC`,
      [matchDbId],
    );
    return result.rows;
  }
}
