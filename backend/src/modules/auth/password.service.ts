// modules/auth/password.service.ts
import { Injectable } from '@nestjs/common/decorators/core/index.js';
import { hash, verify } from '@node-rs/argon2';

@Injectable()
export class PasswordService {
  /** Para gastar el mismo tiempo cuando el correo no existe (no delatar qué cuentas hay). */
  private readonly dummyHash = hash('relleno-sin-uso');

  hash(plain: string): Promise<string> { return hash(plain); }

  async verify(storedHash: string | null, plain: string): Promise<boolean> {
    try { return await verify(storedHash ?? (await this.dummyHash), plain) && storedHash !== null; }
    catch { return false; }
  }
}