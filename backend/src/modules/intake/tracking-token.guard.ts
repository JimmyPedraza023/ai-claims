// backend/src/modules/intake/tracking-token.guard.ts
import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { DatabaseService } from '../../database/database.service';
import { ClaimsService } from '../claims/claims.service';
import { isWellFormedTrackingToken } from '../claims/tracking-token';
import { TRACKING_NOT_FOUND_MESSAGE } from './tracking.messages';

/**
 * Exige un token de seguimiento válido ANTES de leer la subida de archivos: sin credencial
 * no se carga nada en memoria. La verificación que cuenta se repite dentro de la transacción.
 */
@Injectable()
export class TrackingTokenGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly claims: ClaimsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-tracking-token'];
    const token = typeof header === 'string' ? header : '';

    if (!isWellFormedTrackingToken(token) || !(await this.claims.findByTrackingToken(this.db, token))) {
      throw new NotFoundException(TRACKING_NOT_FOUND_MESSAGE);
    }
    return true;
  }
}