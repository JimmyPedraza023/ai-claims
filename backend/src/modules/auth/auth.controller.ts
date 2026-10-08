// modules/auth/auth.controller.ts
import { Controller } from "@nestjs/common/decorators/core/index.js";
import { Body, HttpCode, Post } from "@nestjs/common/decorators/http/index.js";
import { AuthService, loginSchema } from "./auth.service";
import { BadRequestException } from "@nestjs/common/exceptions/index.js";
import { Throttle } from "@nestjs/throttler";

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login') @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // sigue el patrón de intake.throttle.ts
  login(@Body() body: unknown) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Revisa el correo y la contraseña');
    return this.auth.login(parsed.data.email, parsed.data.password);
  }
}