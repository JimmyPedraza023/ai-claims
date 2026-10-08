import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ClaimsModule } from '../claims/claims.module';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationsModule } from '../notifications/notification.module';
import { DecisionsController } from './decisions.controller';
import { DecisionsRepository } from './decisions.repository';
import { DecisionsService } from './decisions.service';

@Module({
  // AuthModule: el guard se instancia en el módulo del controlador y necesita JwtService y UsersRepository.
  imports: [DatabaseModule, AuthModule, AuditModule, ClaimsModule, JobsModule, NotificationsModule],
  controllers: [DecisionsController],
  providers: [DecisionsService, DecisionsRepository],
})
export class DecisionsModule {}