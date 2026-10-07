// backend/src/modules/intake/intake.module.ts
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { ClaimsModule } from '../claims/claims.module';
import { DocumentsModule } from '../documents/documents.module';
import { JobsModule } from '../jobs/jobs.module';
import { IntakeController } from './intake.controller';
import { intakeThrottlerOptions } from './intake.throttle';
import { IntakeService } from './intake.service';
import { SubmissionProcessor } from './submission-processor';
import { DevTrackingLinkSender, TRACKING_LINK_SENDER } from './tracking-link-sender';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { TurnstileService } from './turnstile.service';
import { ComplementController } from './complement.controller';
import { ComplementService } from './complement.service';

import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';

import { NotificationsModule } from '../notifications/notification.module';
import { EMAIL_SENDER } from '../notifications/email-sender';
import type { EmailSender } from '../notifications/email-sender';
import { EmailTrackingLinkSender } from '../notifications/email-tracking-link-sender';

import type { TrackingLinkSender } from './tracking-link-sender';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    ClaimsModule,
    DocumentsModule,
    JobsModule,
    ThrottlerModule.forRoot(intakeThrottlerOptions),
    NotificationsModule,
  ],
  controllers: [IntakeController, TrackingController, ComplementController],
  providers: [
    IntakeService,
    ComplementService,
    SubmissionProcessor,
    TrackingService,
    TurnstileService,
    {
      provide: TRACKING_LINK_SENDER,
      inject: [ConfigService, EMAIL_SENDER],
      useFactory: (
        config: ConfigService<Env, true>,
        email: EmailSender,
      ): TrackingLinkSender => {
        if (!config.get('SMTP_HOST', { infer: true })) {
          return new DevTrackingLinkSender(config);
        }

        const frontendUrl = config.get('FRONTEND_URL', { infer: true });

        if (!frontendUrl) {
          throw new Error(
            'FRONTEND_URL es obligatoria para enviar el enlace de seguimiento',
          );
        }

        return new EmailTrackingLinkSender(email, frontendUrl);
      },
    },
  ],
  exports: [IntakeService],
})
export class IntakeModule {}