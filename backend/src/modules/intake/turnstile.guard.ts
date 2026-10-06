// backend/src/modules/intake/turnstile.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TurnstileService } from './turnstile.service';

export const CAPTCHA_MESSAGE =
  'No pudimos comprobar que eres una persona. Recarga la página e inténtalo de nuevo.';

const MAX_TOKEN_LENGTH = 2048;

/**
 * Exige un token de captcha válido ANTES de leer la subida de archivos. El token llega
 * en la cabecera x-turnstile-token: un guard corre antes de que se lea el cuerpo multipart.
 */
@Injectable()
export class TurnstileGuard implements CanActivate {
  constructor(private readonly turnstile: TurnstileService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.turnstile.enabled) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-turnstile-token'];
    const token = typeof header === 'string' ? header : undefined;
    if (!token || token.length > MAX_TOKEN_LENGTH) throw new ForbiddenException(CAPTCHA_MESSAGE);

    const outcome = await this.turnstile.verify(token, req.ip);
    if (outcome === 'rejected') throw new ForbiddenException(CAPTCHA_MESSAGE);

    // 'unavailable': decisión de diseño, se deja pasar (el servicio ya registró el error).
    // Es una sola línea: para bloquear en ese caso, lanzar la excepción también aquí.
    return true;
  }
}