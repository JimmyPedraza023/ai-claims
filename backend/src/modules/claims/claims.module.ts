import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ClaimsRepository } from './claims.repository';
import { ClaimsService } from './claims.service';

@Module({
  imports: [AuditModule],
  providers: [ClaimsRepository, ClaimsService],
  exports: [ClaimsRepository, ClaimsService],
})
export class ClaimsModule {}