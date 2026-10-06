// backend/src/modules/intake/intake.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Logger,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Env } from '../../config/env.schema';
import { normalizeEmail } from '../claims/claim-normalization';
import { MAX_FILES_PER_SUBMISSION } from '../documents/documents.service';
import { hashClientIp } from './client-ip';
import { toHttpError, UPLOAD_LIMITS } from './intake.http';
import { intakeSchema } from './intake.schema';
import { IntakeService } from './intake.service';
import type { IntakeResult } from './intake.service';
import { TRACKING_LINK_SENDER } from './tracking-link-sender';
import type { TrackingLinkSender } from './tracking-link-sender';
import { TurnstileGuard } from './turnstile.guard';

/**
 * Misma respuesta para caso nuevo, anexado y duplicado: no se puede averiguar
 * si ya existe una reclamación con esos documentos de identidad.
 */
const RECEIVED_MESSAGE =
  'Recibimos tu solicitud. Te escribiremos al correo que nos diste para contarte ' +
  'cómo va y qué documentos faltan, si falta alguno.';

@Controller('intake')
@UseGuards(ThrottlerGuard, TurnstileGuard)
export class IntakeController {
  private readonly logger = new Logger(IntakeController.name);

  constructor(
    private readonly intake: IntakeService,
    @Inject(TRACKING_LINK_SENDER) private readonly trackingLinks: TrackingLinkSender,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  // Memoria: los archivos son pequeños (máx. 10 MB) y se validan antes de guardarse.
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_SUBMISSION, { limits: UPLOAD_LIMITS }))
  async receive(
    @Body() body: unknown,
    @UploadedFiles() files: Express.Multer.File[] = [],
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ message: string }> {
    const parsed = intakeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Revisa los datos del formulario.',
        // Solo el campo y el motivo, nunca el valor que escribió la persona.
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    const form = parsed.data;

    let result: IntakeResult;
    try {
      result = await this.intake.receive({
        channel: 'web', // lo fija el servidor, nunca el cliente
        form,
        files: files.map((f) => ({ originalname: f.originalname, buffer: f.buffer })),
        clientIpHash: hashClientIp(ip, this.config.get('IP_HASH_SECRET', { infer: true })),
        userAgent: userAgent?.slice(0, 200) ?? null,
      });
    } catch (err) {
      throw toHttpError(err);
    }

    // El enlace solo existe cuando el caso es nuevo. Si falla la entrega, la
    // radicación ya está guardada: se registra el error (sin el token) y se responde igual.
    if (result.outcome === 'created') {
      try {
        await this.trackingLinks.send({
          claimId: result.claimId,
          referenceCode: result.referenceCode,
          email: normalizeEmail(form.beneficiaryEmail),
          token: result.trackingToken,
        });
      } catch (err) {
        this.logger.error(
          `No se pudo entregar el enlace de ${result.referenceCode}: ${err instanceof Error ? err.message : 'error desconocido'}`,
        );
      }
    }

    return { message: RECEIVED_MESSAGE };
  }
}