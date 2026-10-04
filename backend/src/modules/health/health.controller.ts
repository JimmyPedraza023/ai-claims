import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly db: DatabaseService) {}

  /** Liveness: el proceso está vivo. No toca la base de datos. */
  @Get()
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: la API puede atender. Verifica la base de datos y que las
   * migraciones estén aplicadas. Responde 503 si algo falla, para que el
   * monitor externo (UptimeRobot, Render) lo detecte antes que un usuario.
   */
  @Get('ready')
  async ready() {
    try {
      const { rows } = await this.db.query<{ applied: number; last: string | null }>(
        `SELECT count(*)::int AS applied, max(name) AS last FROM schema_migrations`,
      );
      const { applied, last } = rows[0];
      if (applied === 0) throw new Error('No hay migraciones aplicadas');
      return { status: 'ok', checks: { database: 'up', migrations: { applied, last } } };
    } catch (err) {
      this.logger.error(`Readiness falló: ${(err as Error).message}`);
      throw new ServiceUnavailableException({ status: 'error', checks: { database: 'down' } });
    }
  }
}