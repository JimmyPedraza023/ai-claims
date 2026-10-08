import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppLoggerModule } from './common/logger/logger.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { ClassificationModule } from './modules/classification/classification.module';
import { ClockWatchModule } from './modules/clock-watch/clock-watch.module';
import { HealthModule } from './modules/health/health.module';
import { IntakeModule } from './modules/intake/intake.module';
import { AuthModule } from './modules/auth/auth.module';
import { DecisionsModule } from './modules/decisions/decisions.module';
import { PanelModule } from './modules/panel/panel.module';

@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    DatabaseModule,
    HealthModule,
    ClassificationModule,
    IntakeModule,
    ClockWatchModule,
    AuthModule,
    DecisionsModule,
    PanelModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}