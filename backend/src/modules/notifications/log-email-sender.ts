// log-email-sender.ts
import { Logger } from '@nestjs/common';
import type { EmailMessage, EmailSender } from './email-sender';

/**
 * En desarrollo no hay correo: solo registra asunto y referencia.
 * Nunca registra destinatario ni cuerpo (dato personal del beneficiario).
 */
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger(LogEmailSender.name);

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(`[solo desarrollo] aviso ${message.messageId ?? 'sin id'}: ${message.subject}`);
  }
}