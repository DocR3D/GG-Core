import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from './postgres.module';

export type SeriesStatus = 'active' | 'finished';

export type SeriesInsert = {
  id_tournoi?: number | null;
  home_id: string;
  away_id: string;
  bo: 1 | 3 | 5;
};

export type SeriesRow = {
  id: number;
  id_tournoi: number | null;
  home_id: string;
  away_id: string;
  bo: number;
  score_home: number;
  score_away: number;
  status: SeriesStatus;
  winner: string | null;
  created_at: Date;
};

@Injectable()
export class SeriesRepository {
  private readonly logger = new Logger(SeriesRepository.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async insert(row: SeriesInsert): Promise<number> {
    const result = await this.pool.query<{ id: number }>(
      `INSERT INTO "Series" (id_tournoi, home_id, away_id, bo)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [row.id_tournoi ?? null, row.home_id, row.away_id, row.bo],
    );
    const id = result.rows[0].id;
    this.logger.debug(`Series inserted: id=${id} bo=${row.bo}`);
    return id;
  }

  async updateScores(id: number, scoreHome: number, scoreAway: number): Promise<void> {
    await this.pool.query(
      `UPDATE "Series" SET score_home = $2, score_away = $3 WHERE id = $1`,
      [id, scoreHome, scoreAway],
    );
  }

  async updateStatus(id: number, status: SeriesStatus, winner?: string | null): Promise<void> {
    await this.pool.query(
      `UPDATE "Series" SET status = $2, winner = $3 WHERE id = $1`,
      [id, status, winner ?? null],
    );
  }

  async findById(id: number): Promise<SeriesRow | null> {
    const result = await this.pool.query<SeriesRow>(
      `SELECT id, id_tournoi, home_id, away_id, bo, score_home, score_away, status, winner, created_at
       FROM "Series" WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findByTournoiId(tournoiId: number): Promise<SeriesRow[]> {
    const result = await this.pool.query<SeriesRow>(
      `SELECT id, id_tournoi, home_id, away_id, bo, score_home, score_away, status, winner, created_at
       FROM "Series" WHERE id_tournoi = $1 ORDER BY id DESC`,
      [tournoiId],
    );
    return result.rows;
  }
}
