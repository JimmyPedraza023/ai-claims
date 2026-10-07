import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerModule } from '../common/logger/logger.module';
import { AppConfigModule } from '../config/app-config.module';
import type { Env } from '../config/env.schema';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../modules/audit/audit.module';
import { AnalyzeDocumentHandler } from '../modules/classification/analyze-document.handler';
import { ClassificationModule } from '../modules/classification/classification.module';
import { ClassifyClaimHandler } from '../modules/classification/classify-claim.handler';
import { LLM_PROVIDER } from '../modules/classification/llm-provider';
import { NvidiaLlmProvider } from '../modules/classification/nvidia-llm-provider';
import { DefaultDocumentPreparer, DOCUMENT_PREPARER } from '../modules/classification/preparation/document-preparer';
import { ClaimsRepository } from '../modules/claims/claims.repository';
import { DocumentsModule } from '../modules/documents/documents.module';
import { JobsModule } from '../modules/jobs/jobs.module';
import { WorkerService } from './worker.service';

/** Todo lo que necesita el proceso del worker. La API no lo carga, así que no necesita la clave del modelo. */
@Module({
  imports: [AppConfigModule, AppLoggerModule, DatabaseModule, AuditModule, DocumentsModule, JobsModule, ClassificationModule],
  providers: [
    ClaimsRepository,
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const apiKey = config.get('NVIDIA_API_KEY', { infer: true });
        if (!apiKey) throw new Error('NVIDIA_API_KEY es obligatoria para correr el worker');
        return new NvidiaLlmProvider({
          apiKey,
          model: config.get('LLM_MODEL', { infer: true }),
          timeoutMs: config.get('LLM_TIMEOUT_MS', { infer: true }),
          maxTokens: config.get('LLM_MAX_TOKENS', { infer: true }),
        });
      },
    },
    { provide: DOCUMENT_PREPARER, useFactory: () => new DefaultDocumentPreparer() },
    AnalyzeDocumentHandler,
    ClassifyClaimHandler,
    WorkerService,
  ],
})
export class WorkerModule {}