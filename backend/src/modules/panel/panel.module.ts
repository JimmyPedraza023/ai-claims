import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ClaimsRepository } from '../claims/claims.repository';
import { ClassificationsRepository } from '../classification/classifications.repository';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentsRepository } from '../documents/documents.repository';
import { JobsRepository } from '../jobs/jobs.repository';
import { CorrectionsController } from './corrections.controller';
import { CorrectionsService } from './corrections.service';
import { PanelController } from './panel.controller';
import { PanelRepository } from './panel.repository';

@Module({
  // DocumentsModule: de ahí viene FILE_STORAGE. Verifica que lo exporte.
  imports: [DatabaseModule, AuthModule, AuditModule, DocumentsModule],
  controllers: [PanelController, CorrectionsController],
  // Repositorios sin dependencias: se declaran aquí, igual que haces en WorkerModule. Así la API
  // no arrastra ClassificationModule (que podría pedir la clave del modelo).
  providers: [
    PanelRepository, CorrectionsService,
    ClaimsRepository, ClassificationsRepository, DocumentsRepository, JobsRepository,
  ],
  exports: [PanelRepository], // la rama 11 (métricas) lo reutiliza
})
export class PanelModule {}