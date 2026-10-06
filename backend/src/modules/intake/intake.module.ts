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

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    ClaimsModule,
    DocumentsModule,
    JobsModule,
    ThrottlerModule.forRoot(intakeThrottlerOptions),
  ],
  controllers: [IntakeController, TrackingController],
  providers: [
    IntakeService,
    SubmissionProcessor,
    TrackingService,
    TurnstileService,
    { provide: TRACKING_LINK_SENDER, useClass: DevTrackingLinkSender },
  ],
  exports: [IntakeService],
})
export class IntakeModule {}