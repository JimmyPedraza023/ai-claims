// backend/src/modules/intake/turnstile.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 3_000;

export type TurnstileOutcome = 'passed' | 'rejected' | 'unavailable';

/** Errores que no son culpa de quien radica: nuestra configuración o Cloudflare. */
const NOT_THE_USERS_FAULT = new Set(['missing-input-secret', 'invalid-input-secret', 'internal-error']);

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/** Pregunta a Cloudflare si el token del captcha es válido. Nunca registra el token ni la clave. */
@Injectable()
export class TurnstileService implements OnModuleInit {
  private readonly logger = new Logger(TurnstileService.name);
  private readonly secret: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.secret = config.get('TURNSTILE_SECRET_KEY', { infer: true });
  }

  get enabled(): boolean {
    return Boolean(this.secret);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn('TURNSTILE_SECRET_KEY no está definida: el captcha está DESACTIVADO');
    }
  }

  async verify(token: string, ip?: string): Promise<TurnstileOutcome> {
    if (!this.secret) return 'passed';

    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (ip) body.set('remoteip', ip);

    let data: SiteverifyResponse;
    try {
      const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.error(`Turnstile respondió HTTP ${res.status}`);
        return 'unavailable';
      }
      data = (await res.json()) as SiteverifyResponse;
    } catch (err) {
      this.logger.error(
        `No se pudo consultar Turnstile: ${err instanceof Error ? err.message : 'error desconocido'}`,
      );
      return 'unavailable';
    }

    if (data.success) return 'passed';

    const codes = data['error-codes'] ?? [];
    if (codes.some((c) => NOT_THE_USERS_FAULT.has(c))) {
      this.logger.error(`Turnstile no pudo validar: ${codes.join(', ')}`);
      return 'unavailable';
    }
    return 'rejected';
  }
}