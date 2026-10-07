// modules/notifications/smtp-email-sender.ts
import { createTransport, Transporter } from 'nodemailer';
import { EmailError, type EmailMessage, type EmailSender } from './email-sender';

export class SmtpEmailSender implements EmailSender {
  private readonly transport: Transporter;

  constructor(private readonly cfg: {
    host: string; port: number; secure: boolean;
    user?: string; pass?: string; from: string;
  }) {
    this.transport = createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(m: EmailMessage): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.cfg.from, to: m.to, subject: m.subject, text: m.text });
    } catch (e) {
      const code = (e as { responseCode?: number }).responseCode;
      // 5xx de SMTP = rechazo definitivo (buzón inexistente, credenciales). Lo demás: reintentar.
      const permanent = code !== undefined && code >= 500 && code < 600;
      throw new EmailError(`smtp_failed${code ? `_${code}` : ''}`, !permanent);
    }
  }
}