import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

import type { Env } from '../../config/env.schema';

@Injectable()
export class ClockWatchGuard implements CanActivate {
  private readonly expected: Buffer | null;

  constructor(config: ConfigService<Env, true>) {
    const secret = config.get('CLOCK_WATCH_SECRET', { infer: true });

    this.expected = secret
      ? createHash('sha256').update(secret).digest()
      : null;
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.expected) {
      throw new NotFoundException();
    }

    const header = ctx
      .switchToHttp()
      .getRequest<Request>()
      .headers['x-clock-watch-secret'];

    const given =
      typeof header === 'string'
        ? createHash('sha256').update(header).digest()
        : null;

    if (!given || !timingSafeEqual(given, this.expected)) {
      throw new UnauthorizedException();
    }

    return true;
  }
}