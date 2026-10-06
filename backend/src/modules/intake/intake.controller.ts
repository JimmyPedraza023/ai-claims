import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  PayloadTooLargeException,
  Post,
  UnsupportedMediaTypeException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  Ip
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { normalizeEmail } from '../claims/claim-normalization';
import { IdempotencyKeyConflictError } from '../claims/claims.errors';
import { InvalidFileError, TooManyFilesError } from '../documents/documents.errors';
import { MAX_FILE_BYTES, MAX_FILES_PER_SUBMISSION } from '../documents/documents.service';
import { OpenClaimChangedError } from './intake.errors';
import { intakeSchema } from './intake.schema';
import { IntakeService } from './intake.service';
import type { IntakeResult } from './intake.service';
import { TRACKING_LINK_SENDER } from './tracking-link-sender';
import type { TrackingLinkSender } from './tracking-link-sender';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { hashClientIp } from './client-ip';

/**
 * Misma respuesta para caso nuevo, anexado y duplicado: no se puede averiguar
 * si ya existe una reclamación con esos documentos de identidad.
 */
const RECEIVED_MESSAGE =
  'Recibimos tu solicitud. Te escribiremos al correo que nos diste para contarte ' +
  'cómo va y qué documentos faltan, si falta alguno.';

/** Traduce errores del dominio a respuestas HTTP con mensajes claros. */
function toHttpError(err: unknown): unknown {
  if (err instanceof InvalidFileError) {
    if (err.code === 'TOO_LARGE') return new PayloadTooLargeException(err.message);
    if (err.code === 'TYPE_NOT_ALLOWED') return new UnsupportedMediaTypeException(err.message);
    return new BadRequestException(err.message);
  }
  if (err instanceof TooManyFilesError) return new BadRequestException(err.message);
  if (err instanceof IdempotencyKeyConflictError) {
    return new ConflictException('Este envío ya no es válido. Recarga la página e inténtalo de nuevo.');
  }
  if (err instanceof OpenClaimChangedError) {
    return new ConflictException('Tu solicitud cambió mientras la procesábamos. Inténtalo de nuevo en un momento.');
  }
  return err; // lo demás lo maneja el filtro global (500 sin detalles internos)
}

@Controller('intake')
@UseGuards(ThrottlerGuard)
export class IntakeController {
  private readonly logger = new Logger(IntakeController.name);

  constructor(
    private readonly intake: IntakeService,
    @Inject(TRACKING_LINK_SENDER) private readonly trackingLinks: TrackingLinkSender,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_SUBMISSION, {
      // Memoria: los archivos son pequeños (máx. 10 MB) y se validan antes de guardarse.
      limits: {
        fileSize: MAX_FILE_BYTES,
        files: MAX_FILES_PER_SUBMISSION,
        fields: 20,
        fieldSize: 64 * 1024,
        parts: 40,
      },
    }),
  )
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