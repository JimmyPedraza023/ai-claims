import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PanelModule } from '../panel/panel.module';
import { MetricsController } from './metrics.controller';
import { MetricsRepository } from './metrics.repository';

@Module({
  // PanelModule exporta PanelRepository (la lista de casos por urgencia).
  imports: [DatabaseModule, AuthModule, AuditModule, PanelModule],
  controllers: [MetricsController],
  providers: [MetricsRepository],
})
export class MetricsModule {}