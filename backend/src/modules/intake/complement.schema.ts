// backend/src/modules/intake/complement.schema.ts
import { z } from 'zod';

/** Subir documentos desde el seguimiento: no hay datos personales que repetir, solo la llave de reintento. */
export const complementSchema = z.strictObject({
  idempotencyKey: z.uuid('Identificador de envío inválido.'),
});