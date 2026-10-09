import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { AuditModule } from '../audit/audit.module';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { FILE_STORAGE } from './file-storage';
import { LocalFileStorage } from './local-file-storage';
import { S3FileStorage } from './s3-file-storage';

@Module({
  imports: [AuditModule],
  providers: [
    DocumentsRepository,
    DocumentsService,
    {
      provide: FILE_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const backend = config.get('STORAGE_BACKEND', { infer: true });
        return backend === 's3'
          ? new S3FileStorage(config.get('AWS_S3_BUCKET', { infer: true }), {
              region: config.get('AWS_REGION', { infer: true }),
            })
          : new LocalFileStorage(config.get('STORAGE_DIR', { infer: true }));
      },
    },
  ],
  exports: [DocumentsService, DocumentsRepository, FILE_STORAGE],
})
export class DocumentsModule {}