import { z } from 'zod';
import { CLAIM_TYPES, DOCUMENT_TYPES } from '../../common/domain/enums.js';

// Se re-exportan para no tocar los demás imports del módulo.
export type { ClaimType, DocumentType } from '../../common/domain/enums.js';

const confidence = z.number().min(0).max(1);
const field = <T extends z.ZodType>(value: T) => z.object({ value, confidence });

const shortText = (max: number) => z.string().transform((s) => s.slice(0, max));

export const DocumentAnalysisSchema = z.object({
  documentType: field(z.enum(DOCUMENT_TYPES)),   // incluye 'otro' y 'no_identificado'
  legible: field(z.boolean()),
  signed: field(z.boolean().nullable()),          // null = no se puede saber / no aplica
  matchesInsured: field(z.boolean().nullable()),
  reason: shortText(300),
});

export const ClaimClassificationSchema = z.object({
  claimType: field(z.enum([...CLAIM_TYPES, 'indeterminado'])),
  evidence: shortText(500),
});

export type DocumentAnalysis = z.infer<typeof DocumentAnalysisSchema>;
export type ClaimClassification = z.infer<typeof ClaimClassificationSchema>;