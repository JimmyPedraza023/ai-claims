import { Module } from '@nestjs/common';
import { JobsRepository } from './jobs.repository';

@Module({
  providers: [JobsRepository],
  exports: [JobsRepository],
})
export class JobsModule {}