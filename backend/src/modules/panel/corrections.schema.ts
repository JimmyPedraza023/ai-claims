import { z } from 'zod';
import type { ClaimType, DocumentIssue, DocumentType } from '../../common/domain/enums';
import { REQUIRED_DOCUMENTS } from '../completeness/completeness.rules';
import { DOCUMENT_LABELS, ISSUE_MESSAGES } from '../intake/tracking.messages';

// Las listas se derivan de los Record que ya existen: no hay un tercer sitio donde desactualizarlas.
const CLAIM_TYPES = Object.keys(REQUIRED_DOCUMENTS) as [ClaimType, ...ClaimType[]];
const DOCUMENT_TYPES = Object.keys(DOCUMENT_LABELS) as [DocumentType, ...DocumentType[]];
const DOCUMENT_ISSUES = Object.keys(ISSUE_MESSAGES) as [DocumentIssue, ...DocumentIssue[]];

export const claimTypeCorrectionSchema = z.strictObject({
  claimType: z.enum(CLAIM_TYPES),
});
export type ClaimTypeCorrectionInput = z.infer<typeof claimTypeCorrectionSchema>;

export const documentCorrectionSchema = z
  .strictObject({
    documentType: z.enum(DOCUMENT_TYPES),
    status: z.enum(['valido', 'invalido']),
    issue: z.enum(DOCUMENT_ISSUES).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.status === 'invalido' && !d.issue) {
      ctx.addIssue({ code: 'custom', path: ['issue'], message: 'Indica por qué no sirve' });
    }
    if (d.status === 'valido' && d.issue) {
      ctx.addIssue({ code: 'custom', path: ['issue'], message: 'Un documento válido no lleva motivo' });
    }
    // Para que valga como requisito, el documento necesita un tipo concreto.
    if (d.status === 'valido' && (d.documentType === 'otro' || d.documentType === 'no_identificado')) {
      ctx.addIssue({
        code: 'custom', path: ['documentType'],
        message: 'Un documento válido debe tener un tipo concreto',
      });
    }
  });
export type DocumentCorrectionInput = z.infer<typeof documentCorrectionSchema>;