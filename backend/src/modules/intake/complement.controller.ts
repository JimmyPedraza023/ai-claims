// backend/src/modules/intake/complement.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Env } from '../../config/env.schema';
import { MAX_FILES_PER_SUBMISSION } from '../documents/documents.service';
import { hashClientIp } from './client-ip';
import { complementSchema } from './complement.schema';
import { ComplementService } from './complement.service';
import { toHttpError, UPLOAD_LIMITS } from './intake.http';
import { TrackingTokenGuard } from './tracking-token.guard';
import { UPLOAD_RECEIVED_MESSAGE } from './tracking.messages';
import { TrackingService } from './tracking.service';
import type { TrackingView } from './tracking.view';

/**
 * El beneficiario sube lo que le faltaba desde su seguimiento. El token es la credencial
 * (cabecera x-tracking-token), por eso no hay captcha; sí hay límite de peticiones.
 */
@Controller('tracking/documents')
@UseGuards(ThrottlerGuard, TrackingTokenGuard) // el orden importa: ambos corren antes de leer archivos
@Throttle({ short: { limit: 5, ttl: 60_000 }, long: { limit: 30, ttl: 3_600_000 } })
export class ComplementController {
  constructor(
    private readonly complement: ComplementService,
    private readonly tracking: TrackingService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_SUBMISSION, { limits: UPLOAD_LIMITS }))
  async upload(
    @Headers('x-tracking-token') token: string | undefined,
    @Body() body: unknown,
    @UploadedFiles() files: Express.Multer.File[] = [],
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ message: string; tracking: TrackingView | null }> {
    const parsed = complementSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Revisa el envío.',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    if (files.length === 0) throw new BadRequestException('Adjunta al menos un documento.');

    try {
      await this.complement.receive({
        token: token ?? '',
        idempotencyKey: parsed.data.idempotencyKey,
        files: files.map((f) => ({ originalname: f.originalname, buffer: f.buffer })),
        clientIpHash: hashClientIp(ip, this.config.get('IP_HASH_SECRET', { infer: true })),
        userAgent: userAgent?.slice(0, 200) ?? null,
      });
    } catch (err) {
      throw toHttpError(err);
    }

    // La página redibuja la lista con lo que ya se sabe, sin otra petición.
    return { message: UPLOAD_RECEIVED_MESSAGE, tracking: await this.tracking.view(token ?? '') };
  }
}