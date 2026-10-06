import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { AuditModule } from '../audit/audit.module';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { FILE_STORAGE } from './file-storage';
import { LocalFileStorage } from './local-file-storage';

@Module({
  imports: [AuditModule],
  providers: [
    DocumentsRepository,
    DocumentsService,
    {
      provide: FILE_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new LocalFileStorage(config.get('STORAGE_DIR', { infer: true })),
    },
  ],
  exports: [DocumentsService, DocumentsRepository],
})
export class DocumentsModule {}