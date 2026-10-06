import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { AiRunsRepository } from './ai-runs.repository';
import { AnalysisRecorder } from './analysis-recorder';
import { ClassificationsRepository } from './classifications.repository';

@Module({
  imports: [DocumentsModule],
  providers: [AiRunsRepository, ClassificationsRepository, AnalysisRecorder],
  exports: [AnalysisRecorder],
})
export class ClassificationModule {}