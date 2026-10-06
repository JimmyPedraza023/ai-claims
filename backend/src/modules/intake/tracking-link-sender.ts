// backend/src/modules/intake/tracking-link-sender.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';

export const TRACKING_LINK_SENDER = Symbol('TRACKING_LINK_SENDER');

export interface TrackingLink {
  claimId: string;
  referenceCode: string;
  email: string;
  /** El token en claro: solo existe en este momento, en la base queda su hash. */
  token: string;
}

/** Entrega el enlace de seguimiento al beneficiario (en la rama 9: por correo). */
export interface TrackingLinkSender {
  send(link: TrackingLink): Promise<void>;
}

/**
 * Versión provisional: no envía nada. En desarrollo escribe la ruta en el log para
 * poder probar el seguimiento; en producción avisa que no hay proveedor de correo.
 * No registra el correo del beneficiario (dato personal).
 */
@Injectable()
export class DevTrackingLinkSender implements TrackingLinkSender {
  private readonly logger = new Logger(DevTrackingLinkSender.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(link: TrackingLink): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      this.logger.warn(`Sin proveedor de correo: no se envió el enlace de ${link.referenceCode}`);
      return;
    }
    this.logger.log(`[solo desarrollo] ${link.referenceCode}: /seguimiento/${link.token}`);
  }
}