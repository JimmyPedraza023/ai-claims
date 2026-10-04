import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Env } from '../config/env.schema';

/**
 * Único punto de acceso a PostgreSQL. Envuelve un pool de `pg`.
 *
 * - `query`: consultas sueltas (siempre parametrizadas: $1, $2...).
 * - `withTransaction`: varias operaciones atómicas (BEGIN/COMMIT/ROLLBACK).
 *
 * Compatible con el pooler de Supabase en modo transaction (6543): no se usan
 * sentencias preparadas con nombre ni estado de sesión entre consultas.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService<Env, true>) {
    this.pool = new Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      // Supabase exige SSL. Mejora posible: validar contra el CA de Supabase.
      ssl: config.get('DATABASE_SSL', { infer: true }) ? { rejectUnauthorized: false } : undefined,
      max: config.get('DATABASE_POOL_MAX', { infer: true }),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      application_name: 'aix-claims-api',
    });

    // Un error en una conexión ociosa no debe tumbar el proceso.
    this.pool.on('error', (err) => this.logger.error(`Error en conexión ociosa: ${err.message}`));
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}