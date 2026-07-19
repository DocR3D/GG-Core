// src/adapters/postgres/postgres.module.ts
import { Module, Global } from '@nestjs/common';
import { Pool } from 'pg';

export const PG_POOL = 'PG_POOL';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () =>
        new Pool({ connectionString: process.env.DATABASE_URL }),
    },
  ],
  exports: [PG_POOL],
})
export class PostgresModule {}
