import { z } from 'zod';
import type { DocumentType } from '../../common/domain/enums';

/**
 * Documentos que un analista puede pedir: todos los de DOCUMENT_TYPES salvo
 * 'otro' y 'no_identificado', que no son un requisito que se le pueda pedir
 * a nadie. Tupla explícita (as const) para que z.enum conserve el tipo estricto.
 */
export const REQUESTABLE_DOCUMENT_TYPES = [
  'formato_reclamacion',
  'registro_civil_defuncion',
  'certificado_medico_defuncion',
  'documento_identidad_asegurado',
  'documento_identidad_beneficiario',
  'formulario_sarlaft',
  'certificacion_bancaria',
  'informe_autoridad',
  'dictamen_perdida_capacidad_laboral',
  'historia_clinica_resumida',
] as const satisfies readonly Exclude<DocumentType, 'otro' | 'no_identificado'>[];

export const decisionSchema = z
  .strictObject({
    kind: z.enum(['pagar', 'objetar', 'pedir_documentos']),
    reason: z.string().trim().min(10, 'Explica el motivo (mínimo 10 caracteres)').max(2000),
    requestedDocuments: z.array(z.enum(REQUESTABLE_DOCUMENT_TYPES)).min(1).max(12).optional(),
  })
  .superRefine((d, ctx) => {
    if ((d.kind === 'pedir_documentos') !== (d.requestedDocuments !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['requestedDocuments'],
        message: 'Solo se indican documentos al pedir documentos',
      });
    }
  });

export type DecisionKind = z.infer<typeof decisionSchema>['kind'];

export type DecisionInput = z.infer<typeof decisionSchema>;