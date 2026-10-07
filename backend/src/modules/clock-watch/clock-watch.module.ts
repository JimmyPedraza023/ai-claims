// modules/clock-watch/clock-watch.module.ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationsModule } from '../notifications/notification.module';
import { ClockWatchController } from './clock-watch.controller';
import { ClockWatchGuard } from './clock-watch.guard';
import { ClockWatchService } from './clock-watch.service';

/** Vigila el reloj legal: endpoint interno protegido por secreto (lo dispara un workflow programado). */
@Module({
  imports: [NotificationsModule, JobsModule, AuditModule],
  controllers: [ClockWatchController],
  providers: [ClockWatchService, ClockWatchGuard],
})
export class ClockWatchModule {}