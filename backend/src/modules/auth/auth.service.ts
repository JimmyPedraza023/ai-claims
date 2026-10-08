// modules/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PasswordService } from './password.service';
import { UsersRepository } from './users.repository';
import { DatabaseService } from '../../database/database.service';
import { z } from 'zod';
import type { Env } from '../../config/env.schema.js';

export const loginSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(emailRaw: string, password: string) {
    const user = await this.users.findByEmail(this.db, emailRaw.trim().toLowerCase());
    const ok = await this.passwords.verify(user?.passwordHash ?? null, password);
    // Mismo mensaje para "no existe", "clave mala" y "cuenta inactiva".
    if (!user || !ok || !user.isActive) throw new UnauthorizedException('Correo o contraseña incorrectos');
    await this.users.touchLogin(this.db, user.id);
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id }),
      expiresInSeconds: this.config.get('JWT_TTL_SECONDS', { infer: true }),
      user: { id: user.id, fullName: user.fullName, role: user.role },
    };
  }
}