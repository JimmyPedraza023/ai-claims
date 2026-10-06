// backend/src/modules/intake/tracking.controller.ts
import { Controller, Get, Header, Headers, NotFoundException, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { TrackingService } from './tracking.service';
import type { TrackingView } from './tracking.view';
import { TRACKING_NOT_FOUND_MESSAGE } from './tracking.messages';

/**
 * Seguimiento del beneficiario. El token va en una cabecera, nunca en la URL: las URL
 * quedan en los logs y el token es un secreto (en la base solo está su hash).
 */
@Controller('tracking')
@UseGuards(ThrottlerGuard)
// Más holgado que la radicación: la gente recarga la página para ver si hay novedades.
@Throttle({ short: { limit: 30, ttl: 60_000 }, long: { limit: 300, ttl: 3_600_000 } })
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get()
  @Header('Cache-Control', 'no-store') // el contenido es privado: que nadie lo guarde en caché
  async get(@Headers('x-tracking-token') token?: string): Promise<TrackingView> {
    const view = token ? await this.tracking.view(token) : null;
    // Sin token, token mal formado o inexistente: la misma respuesta.
    if (!view) throw new NotFoundException(TRACKING_NOT_FOUND_MESSAGE);
    return view;
  }
}