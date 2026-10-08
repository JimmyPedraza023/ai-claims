import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env.schema';
import { DatabaseModule } from '../../database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { UsersRepository } from './users.repository';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const secret = config.get('JWT_SECRET', { infer: true });
        // Solo la API carga este módulo: el worker no necesita el secreto.
        if (!secret) throw new Error('JWT_SECRET es obligatoria para el panel');
        return {
          secret,
          signOptions: { algorithm: 'HS256' as const, expiresIn: config.get('JWT_TTL_SECONDS', { infer: true }) },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, UsersRepository, JwtAuthGuard],
  exports: [JwtModule, JwtAuthGuard, UsersRepository],
})
export class AuthModule {}