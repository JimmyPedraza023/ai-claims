import { z } from 'zod';
import { normalizeDocumentNumber } from '../claims/claim-normalization';

/** Versión del texto de consentimiento que ve el beneficiario. Se guarda con cada caso. */
export const CONSENT_VERSION = '2026-10-v1';

/** Supuesto: tipos de documento más comunes en Colombia (se documenta en ASSUMPTIONS.md). */
export const DOCUMENT_TYPES = ['CC', 'CE', 'PA', 'PEP', 'PPT'] as const;

/** Número de documento: se mide ya normalizado (sin puntos, espacios ni guiones). */
const documentNumber = z
  .string()
  .trim()
  .refine((v) => {
    const length = normalizeDocumentNumber(v).length;
    return length >= 5 && length <= 15;
  }, 'Revisa el número de documento: debe tener entre 5 y 15 caracteres.');

const fullName = z
  .string()
  .trim()
  .min(3, 'Escribe el nombre completo.')
  .max(120, 'El nombre es demasiado largo.');

/** En multipart un campo vacío llega como '' : se trata como "no enviado". */
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const intakeSchema = z.strictObject({
  idempotencyKey: z.uuid('Identificador de envío inválido.'),

  narrative: z
    .string()
    .trim()
    .min(10, 'Cuéntanos con un poco más de detalle qué ocurrió.')
    .max(5000, 'El relato es demasiado largo (máximo 5.000 caracteres).'),

  beneficiaryDocumentType: z.enum(DOCUMENT_TYPES, 'Selecciona un tipo de documento válido.'),
  beneficiaryDocumentNumber: documentNumber,
  beneficiaryFullName: fullName,
  beneficiaryEmail: z
    .string()
    .trim()
    .max(254, 'El correo es demasiado largo.')
    .pipe(z.email('Revisa el correo electrónico.')),
  beneficiaryPhone: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, 'Revisa el número de teléfono.')
      .optional(),
  ),

  insuredDocumentNumber: documentNumber,
  insuredFullName: fullName,

  consentAccepted: z
    .stringbool()
    .refine((v) => v === true, 'Debes aceptar el tratamiento de tus datos para continuar.'),
});

export type IntakeInput = z.infer<typeof intakeSchema>;