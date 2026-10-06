// backend/src/modules/intake/tracking.messages.ts
import type { DocumentIssue, DocumentType } from '../../common/domain/enums';

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  formato_reclamacion: 'Formato de reclamación diligenciado',
  registro_civil_defuncion: 'Registro civil de defunción',
  certificado_medico_defuncion: 'Certificado médico de defunción',
  documento_identidad_asegurado: 'Documento de identidad de la persona asegurada',
  documento_identidad_beneficiario: 'Tu documento de identidad (beneficiario)',
  formulario_sarlaft: 'Formulario SARLAFT firmado',
  certificacion_bancaria: 'Certificación bancaria',
  informe_autoridad: 'Informe de la autoridad competente (policía o fiscalía)',
  dictamen_perdida_capacidad_laboral: 'Dictamen de pérdida de capacidad laboral',
  historia_clinica_resumida: 'Historia clínica resumida',
  otro: 'Otro documento',
  no_identificado: 'Documento sin identificar',
};

/** Qué pasó con un documento que llegó pero no sirve, y qué hacer. */
export const ISSUE_MESSAGES: Record<DocumentIssue, string> = {
  sin_firma: 'Llegó, pero le falta la firma. Envíalo de nuevo, firmado.',
  ilegible: 'Llegó, pero no se alcanza a leer. Toma una foto más clara o envíalo de nuevo.',
  no_corresponde_asegurado:
    'Llegó, pero no parece ser el de la persona asegurada. Revisa que sea el documento correcto.',
  no_corresponde_beneficiario:
    'Llegó, pero no parece ser el tuyo. Revisa que sea el documento correcto.',
  tipo_no_reconocido:
    'No logramos identificar este documento. Revisa que sea el correcto y envíalo de nuevo.',
  incompleto: 'Llegó incompleto (faltan páginas o partes). Envíalo completo.',
  archivo_danado: 'No pudimos abrir el archivo. Envíalo de nuevo.',
  otro: 'Llegó, pero tiene un problema. Envíalo de nuevo o escríbenos si tienes dudas.',
};

export const HEADLINES = {
  revisando:
    'Recibimos tu solicitud y estamos revisando tus documentos. Te escribiremos al correo que nos diste en cuanto sepamos si necesitamos algo más.',
  faltan:
    'Para continuar con tu reclamación necesitamos que nos envíes lo que aparece pendiente más abajo.',
  completa:
    'Tu expediente está completo. Un analista lo está revisando y la compañía te comunicará la decisión.',
  cerrada:
    'Tu reclamación ya fue resuelta. La compañía te comunicará la decisión por sus medios formales.',
} as const;