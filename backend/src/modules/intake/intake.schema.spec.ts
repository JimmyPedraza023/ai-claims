import { intakeSchema } from './intake.schema';

const valid = {
  idempotencyKey: '3f2b8c1e-5d4a-4e7b-9a6c-1d2e3f4a5b6c',
  narrative: 'Mi padre falleció el 20 de septiembre en su casa.',
  beneficiaryDocumentType: 'CC',
  beneficiaryDocumentNumber: '1.234.567',
  beneficiaryFullName: '  María  Pérez ',
  beneficiaryEmail: 'maria@example.com',
  beneficiaryPhone: '',
  insuredDocumentNumber: '987654321',
  insuredFullName: 'Juan Pérez',
  consentAccepted: 'true',
};

describe('intakeSchema', () => {
  it('acepta una radicación válida (documento con puntos y teléfono vacío)', () => {
    const result = intakeSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.beneficiaryPhone).toBeUndefined();
      expect(result.data.consentAccepted).toBe(true);
    }
  });

  it('rechaza si no se acepta el consentimiento', () => {
    expect(intakeSchema.safeParse({ ...valid, consentAccepted: 'false' }).success).toBe(false);
  });

  it('rechaza una llave de idempotencia que no es UUID', () => {
    expect(intakeSchema.safeParse({ ...valid, idempotencyKey: 'abc' }).success).toBe(false);
  });

  it('rechaza un correo inválido', () => {
    expect(intakeSchema.safeParse({ ...valid, beneficiaryEmail: 'maria@' }).success).toBe(false);
  });

  it('rechaza un documento demasiado corto', () => {
    expect(intakeSchema.safeParse({ ...valid, insuredDocumentNumber: '123' }).success).toBe(false);
  });

  it('rechaza un relato demasiado corto', () => {
    expect(intakeSchema.safeParse({ ...valid, narrative: 'murió' }).success).toBe(false);
  });

  it('rechaza un tipo de documento desconocido', () => {
    expect(intakeSchema.safeParse({ ...valid, beneficiaryDocumentType: 'XX' }).success).toBe(false);
  });

  it('rechaza campos que no existen en el formulario (no se cuela status ni claimType)', () => {
    expect(intakeSchema.safeParse({ ...valid, status: 'completa' }).success).toBe(false);
    expect(intakeSchema.safeParse({ ...valid, claimType: 'muerte_natural' }).success).toBe(false);
  });
});