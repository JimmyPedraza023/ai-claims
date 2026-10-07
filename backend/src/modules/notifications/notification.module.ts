import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { NotificationsRepository } from './notifications.repository';
import { SendNotificationHandler } from './send-notification.handler';
import { EMAIL_SENDER } from './email-sender';
import type { EmailSender } from './email-sender';
import { LogEmailSender } from './log-email-sender';
import { SmtpEmailSender } from './smtp-email-sender';

@Module({
  imports: [AuditModule],
  providers: [
    NotificationsRepository,
    SendNotificationHandler,
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): EmailSender => {
        const host = config.get('SMTP_HOST', { infer: true });
        if (host) {
          const from = config.get('MAIL_FROM', { infer: true });
          if (!from) throw new Error('MAIL_FROM es obligatorio cuando hay SMTP_HOST');
          return new SmtpEmailSender({
            host,
            port: config.get('SMTP_PORT', { infer: true }),
            secure: config.get('SMTP_SECURE', { infer: true }),
            user: config.get('SMTP_USER', { infer: true }),
            pass: config.get('SMTP_PASS', { infer: true }),
            from,
          });
        }
        if (config.get('NODE_ENV', { infer: true }) === 'production') {
          throw new Error('SMTP_HOST es obligatorio en producción');
        }
        return new LogEmailSender(); // solo registra asunto y tipo, nunca el cuerpo ni el destinatario
      },
    },
  ],
  exports: [NotificationsRepository, SendNotificationHandler, EMAIL_SENDER],
})
export class NotificationsModule {}