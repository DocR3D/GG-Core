// src/adapters/postgres/match.repository.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from './postgres.module';

export type MatchStatus = 'pending' | 'live' | 'finished';

export type MatchInsert = {
  match_redis_id: string;
  id_tournoi?: number | null;
  series_id?: number | null;
  map_number?: number;
  equipe1: string;
  equipe2: string;
};

export type MatchRow = {
  id: number;
  match_redis_id: string;
  id_tournoi: number | null;
  equipe1: string;
  equipe2: string;
  score_equipe1: number;
  score_equipe2: number;
  status: MatchStatus;
};

export type PaginatedMatches = {
  data: MatchRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

@Injectable()
export class MatchRepository {
  private readonly logger = new Logger(MatchRepository.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async insert(row: MatchInsert): Promise<number> {
    const result = await this.pool.query<{ id: number }>(
      `INSERT INTO "Match"
         (match_redis_id, id_tournoi, series_id, map_number, equipe1, equipe2, score_equipe1, score_equipe2)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0)
       RETURNING id`,
      [
        row.match_redis_id,
        row.id_tournoi  ?? null,
        row.series_id   ?? null,
        row.map_number  ?? 1,
        row.equipe1,
        row.equipe2,
      ],
    );
    const id = result.rows[0].id;
    this.logger.debug(`Match inserted: db_id=${id} redis_id=${row.match_redis_id}`);
    return id;
  }

  async updateScore(dbId: number, scoreEquipe1: number, scoreEquipe2: number): Promise<void> {
    await this.pool.query(
      `UPDATE "Match" SET score_equipe1 = $2, score_equipe2 = $3 WHERE id = $1`,
      [dbId, scoreEquipe1, scoreEquipe2],
    );
  }

  async updateStatus(dbId: number, status: MatchStatus): Promise<void> {
    await this.pool.query(
      `UPDATE "Match" SET status = $2 WHERE id = $1`,
      [dbId, status],
    );
  }

  async findDbIdByRedisId(matchRedisId: string): Promise<number | null> {
    const result = await this.pool.query<{ id: number }>(
      `SELECT id FROM "Match" WHERE match_redis_id = $1 ORDER BY id DESC LIMIT 1`,
      [matchRedisId],
    );
    return result.rows[0]?.id ?? null;
  }

  async findAllPaginated(
    page: number,
    limit: number,
    status?: MatchStatus,
  ): Promise<PaginatedMatches> {
    const offset = (page - 1) * limit;
    const params: (string | number)[] = [];
    let where = '';

    if (status) {
      params.push(status);
      where = `WHERE status = $${params.length}`;
    }

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM "Match" ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const dataResult = await this.pool.query<MatchRow>(
      `SELECT id, match_redis_id, id_tournoi, equipe1, equipe2, score_equipe1, score_equipe2, status
       FROM "Match" ${where}
       ORDER BY id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      data: dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: number): Promise<MatchRow | null> {
    const result = await this.pool.query<MatchRow>(
      `SELECT id, match_redis_id, id_tournoi, equipe1, equipe2, score_equipe1, score_equipe2, status
       FROM "Match" WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findByTournoiId(tournoiId: number): Promise<MatchRow[]> {
    const result = await this.pool.query<MatchRow>(
      `SELECT id, match_redis_id, id_tournoi, equipe1, equipe2, score_equipe1, score_equipe2, status
       FROM "Match" WHERE id_tournoi = $1 ORDER BY id DESC`,
      [tournoiId],
    );
    return result.rows;
  }

  async delete(dbId: number): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM "Match" WHERE id = $1`,
      [dbId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
