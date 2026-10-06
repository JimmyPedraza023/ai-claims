// backend/src/modules/intake/intake.http.ts
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { IdempotencyKeyConflictError } from '../claims/claims.errors';
import { InvalidFileError, TooManyFilesError } from '../documents/documents.errors';
import { MAX_FILE_BYTES, MAX_FILES_PER_SUBMISSION } from '../documents/documents.service';
import {
  ClaimNotAcceptingDocumentsError,
  OpenClaimChangedError,
  TrackingTokenNotFoundError,
} from './intake.errors';
import {
  TRACKING_NOT_FOUND_MESSAGE,
  UPLOAD_REJECTED_CLOSED,
  UPLOAD_REJECTED_COMPLETE,
} from './tracking.messages';

/** Límites de multer para toda subida de archivos del canal público. */
export const UPLOAD_LIMITS = {
  fileSize: MAX_FILE_BYTES,
  files: MAX_FILES_PER_SUBMISSION,
  fields: 20,
  fieldSize: 64 * 1024,
  parts: 40,
};

/** Traduce errores del dominio a respuestas HTTP con mensajes claros. */
export function toHttpError(err: unknown): unknown {
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
    return new ConflictException(
      'Tu solicitud cambió mientras la procesábamos. Inténtalo de nuevo en un momento.',
    );
  }
  if (err instanceof TrackingTokenNotFoundError) {
    return new NotFoundException(TRACKING_NOT_FOUND_MESSAGE);
  }
  if (err instanceof ClaimNotAcceptingDocumentsError) {
    return new ConflictException(
      err.reason === 'cerrada' ? UPLOAD_REJECTED_CLOSED : UPLOAD_REJECTED_COMPLETE,
    );
  }
  return err; // lo demás lo maneja el filtro global (500 sin detalles internos)
}