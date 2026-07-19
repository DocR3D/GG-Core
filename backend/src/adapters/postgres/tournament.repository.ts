// src/adapters/postgres/tournament.repository.ts
//
// Persiste en base les données issues du sync API externe.
// Toutes les opérations s'exécutent dans une unique transaction PostgreSQL
// pour garantir la cohérence (atomicité tournois + équipes + joueurs + liaisons).

import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from './postgres.module';
import type { SyncResult, Tournament, Team, Player } from '@app/tournaments/tournament.types';

@Injectable()
export class TournamentRepository {
  private readonly logger = new Logger(TournamentRepository.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // -------------------------------------------------------------------------
  // Point d'entrée principal — appelé par TournamentSyncService après le sync
  // -------------------------------------------------------------------------

  async upsertAll(result: SyncResult): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Upsert des tournois
      for (const t of result.tournaments) {
        await client.query(
          `INSERT INTO "Tournoi" (id, nom, date, status, game, end_date)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             nom      = EXCLUDED.nom,
             date     = EXCLUDED.date,
             status   = EXCLUDED.status,
             game     = EXCLUDED.game,
             end_date = EXCLUDED.end_date`,
          [t.id, t.name, t.start_date, t.status, t.game ?? null, t.end_date ?? null],
        );
      }

      // 2. Upsert des équipes + joueurs
      for (const team of result.teams) {
        await this.upsertTeam(client, team);
      }

      // 3. Rafraîchit les liaisons Tournoi ↔ Team
      //    (DELETE + INSERT pour prendre en compte les équipes retirées d'un tournoi)
      for (const t of result.tournaments) {
        await client.query(`DELETE FROM "TournamentTeam" WHERE tournament_id = $1`, [t.id]);
        for (const teamId of t.team_ids) {
          await client.query(
            `INSERT INTO "TournamentTeam" (tournament_id, team_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [t.id, teamId],
          );
        }
      }

      await client.query('COMMIT');
      this.logger.log(
        `DB sync OK — ${result.tournaments.length} tournoi(s), ${result.teams.length} équipe(s)`,
      );
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`DB sync FAILED: ${(err as Error).message}`);
      throw err;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Helpers privés (opèrent sur le client de transaction)
  // -------------------------------------------------------------------------

  private async upsertTeam(client: PoolClient, team: Team) {
    await client.query(
      `INSERT INTO "Team" (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [team.id, team.name],
    );

    for (const p of team.players) {
      await this.upsertPlayer(client, p, team.id);
    }
  }

  private async upsertPlayer(
    client: PoolClient,
    player: Player,
    teamId: number,
  ) {
    await client.query(
      `INSERT INTO "Player" (id, team_id, name, is_captain)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         team_id    = EXCLUDED.team_id,
         name       = EXCLUDED.name,
         is_captain = EXCLUDED.is_captain`,
      [player.id, teamId, player.name, player.isCaptain],
    );
  }
}
