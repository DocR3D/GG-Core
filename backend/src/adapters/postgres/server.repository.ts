// src/adapters/postgres/server.repository.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from './postgres.module';
import type { ServerRow } from '@domain/server.types';

const SELECT_COLS = `id, server_id, name, ip, port, agent_port, agent_host, agent_token, created_at`;

@Injectable()
export class ServerRepository {
  private readonly logger = new Logger(ServerRepository.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findAll(): Promise<ServerRow[]> {
    const result = await this.pool.query<ServerRow>(
      `SELECT ${SELECT_COLS} FROM "Server" ORDER BY id ASC`,
    );
    return result.rows;
  }

  async findById(id: number): Promise<ServerRow | null> {
    const result = await this.pool.query<ServerRow>(
      `SELECT ${SELECT_COLS} FROM "Server" WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findByServerId(serverId: string): Promise<ServerRow | null> {
    const result = await this.pool.query<ServerRow>(
      `SELECT ${SELECT_COLS} FROM "Server" WHERE server_id = $1`,
      [serverId],
    );
    return result.rows[0] ?? null;
  }

  async create(data: {
    name: string;
    ip: string;
    port: number;
    server_id?: string;
    agent_port: number;
    agent_host?: string;
    agent_token?: string;
  }): Promise<ServerRow> {
    const result = await this.pool.query<ServerRow>(
      `INSERT INTO "Server" (name, ip, port, server_id, agent_port, agent_host, agent_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SELECT_COLS}`,
      [data.name, data.ip, data.port, data.server_id ?? '', data.agent_port, data.agent_host ?? '', data.agent_token ?? ''],
    );
    const row = result.rows[0];
    this.logger.debug(`Server created: id=${row.id} server_id=${row.server_id} name=${row.name}`);
    return row;
  }

  async update(
    id: number,
    data: Partial<{ name: string; ip: string; port: number; server_id: string; agent_port: number; agent_host: string; agent_token: string }>,
  ): Promise<ServerRow | null> {
    const fields: string[] = [];
    const values: (string | number)[] = [];
    let idx = 1;

    if (data.name        !== undefined) { fields.push(`name = $${idx++}`);        values.push(data.name); }
    if (data.ip          !== undefined) { fields.push(`ip = $${idx++}`);           values.push(data.ip); }
    if (data.port        !== undefined) { fields.push(`port = $${idx++}`);         values.push(data.port); }
    if (data.server_id   !== undefined) { fields.push(`server_id = $${idx++}`);    values.push(data.server_id); }
    if (data.agent_port  !== undefined) { fields.push(`agent_port = $${idx++}`);   values.push(data.agent_port); }
    if (data.agent_host  !== undefined) { fields.push(`agent_host = $${idx++}`);   values.push(data.agent_host); }
    if (data.agent_token !== undefined) { fields.push(`agent_token = $${idx++}`);  values.push(data.agent_token); }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    const result = await this.pool.query<ServerRow>(
      `UPDATE "Server" SET ${fields.join(', ')} WHERE id = $${idx} RETURNING ${SELECT_COLS}`,
      values as (string | number)[],
    );
    return result.rows[0] ?? null;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM "Server" WHERE id = $1`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
