import { z } from 'zod';

export const CLAIM_TYPES = ['muerte_natural', 'muerte_accidental', 'incapacidad_total_permanente'] as const;

export const DOCUMENT_TYPES = [
  'formato_reclamacion', 'registro_civil_defuncion', 'certificado_medico_defuncion',
  'identidad_asegurado', 'identidad_beneficiario', 'sarlaft', 'certificacion_bancaria',
  'informe_autoridad', 'dictamen_perdida_capacidad', 'historia_clinica',
  'otro', // lo que no corresponde a ningún requisito (supuesto #11)
] as const;

export type ClaimType = (typeof CLAIM_TYPES)[number];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

const confidence = z.number().min(0).max(1);
const field = <T extends z.ZodType>(value: T) => z.object({ value, confidence });

export const DocumentAnalysisSchema = z.object({
  documentType: field(z.enum(DOCUMENT_TYPES)),
  legible: field(z.boolean()),
  signed: field(z.boolean().nullable()),          // null = el documento no lleva firma
  matchesInsured: field(z.boolean().nullable()),  // null = no aplica o no se puede saber
  reason: z.string().max(300),
});

export const ClaimClassificationSchema = z.object({
  claimType: field(z.enum([...CLAIM_TYPES, 'indeterminado'])),
  evidence: z.string().max(500),
});

export type DocumentAnalysis = z.infer<typeof DocumentAnalysisSchema>;
export type ClaimClassification = z.infer<typeof ClaimClassificationSchema>;