import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PanelRepository } from '../panel/panel.repository';
import { BASELINE_FIRST_RESPONSE_HOURS, MetricsRepository } from './metrics.repository';

/** Las cuatro preguntas del enunciado. Detrás del login, igual que el resto del panel. */
@Controller('panel/metrics')
@UseGuards(JwtAuthGuard)
export class MetricsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly metrics: MetricsRepository,
    private readonly panel: PanelRepository,
    private readonly audit: AuditService,
  ) {}

  /** 1 · Casos abiertos, en qué día del plazo va cada uno, cuántos en riesgo y cuántos vencidos. */
  @Get('clock')
  async clock() {
    const [summary, claims] = await Promise.all([
      this.metrics.clockSummary(this.db),
      this.panel.listOpenClaims(this.db, 500, 0), // ordenados por urgencia
    ]);
    return { summary, claims };
  }

  /** 2 · De las clasificaciones del modelo, cuántas tuvo que corregir una persona. */
  @Get('model-corrections')
  async modelCorrections() {
    return { subjects: await this.metrics.modelCorrections(this.db) };
  }

  /** 3 · Cuánto se demora el sistema desde que llega la radicación hasta decirle al beneficiario qué le falta. */
  @Get('first-response')
  async firstResponse() {
    return {
      ...(await this.metrics.firstResponse(this.db)),
      baselineHours: BASELINE_FIRST_RESPONSE_HOURS,
    };
  }

  /** 4 · Un caso al azar, de principio a fin. Sin caché: cada llamada escoge otro. */
  @Get('random-timeline')
  @Header('Cache-Control', 'no-store')
  async randomTimeline() {
    const claim = await this.metrics.randomClaim(this.db);
    if (!claim) return { claim: null, timeline: [], claimsWithoutEvents: 0 };
    const [timeline, claimsWithoutEvents] = await Promise.all([
      this.audit.timeline(claim.id),
      this.metrics.claimsWithoutEvents(this.db),
    ]);
    return { claim, timeline, claimsWithoutEvents };
  }
}