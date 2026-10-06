import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { ClaimsModule } from '../claims/claims.module';
import { DocumentsModule } from '../documents/documents.module';
import { JobsModule } from '../jobs/jobs.module';
import { IntakeController } from './intake.controller';
import { IntakeService } from './intake.service';
import { DevTrackingLinkSender, TRACKING_LINK_SENDER } from './tracking-link-sender';
import { ThrottlerModule } from '@nestjs/throttler';
import { intakeThrottlerOptions } from './intake.throttle';

@Module({
  imports: [DatabaseModule, AuditModule, ClaimsModule, DocumentsModule, JobsModule, ThrottlerModule.forRoot(intakeThrottlerOptions)],
  controllers: [IntakeController],
  providers: [IntakeService, { provide: TRACKING_LINK_SENDER, useClass: DevTrackingLinkSender }],
  exports: [IntakeService],
})
export class IntakeModule {}