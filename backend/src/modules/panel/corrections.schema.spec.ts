import { claimTypeCorrectionSchema, documentCorrectionSchema } from './corrections.schema';

describe('claimTypeCorrectionSchema', () => {
  it('acepta los tres tipos y rechaza otros o campos extra', () => {
    for (const t of ['muerte_natural', 'muerte_accidental', 'incapacidad_total_permanente']) {
      expect(claimTypeCorrectionSchema.safeParse({ claimType: t }).success).toBe(true);
    }
    expect(claimTypeCorrectionSchema.safeParse({ claimType: 'otro' }).success).toBe(false);
    expect(claimTypeCorrectionSchema.safeParse({ claimType: 'muerte_natural', amount: 1 }).success).toBe(false);
  });
});

describe('documentCorrectionSchema', () => {
  const valid = { documentType: 'formulario_sarlaft', status: 'valido' };

  it('acepta un válido con tipo concreto y sin motivo', () => {
    expect(documentCorrectionSchema.safeParse(valid).success).toBe(true);
  });
  it('un válido no lleva motivo ni tipo "otro" o "no_identificado"', () => {
    expect(documentCorrectionSchema.safeParse({ ...valid, issue: 'sin_firma' }).success).toBe(false);
    expect(documentCorrectionSchema.safeParse({ ...valid, documentType: 'otro' }).success).toBe(false);
    expect(documentCorrectionSchema.safeParse({ ...valid, documentType: 'no_identificado' }).success).toBe(false);
  });
  it('un inválido exige motivo', () => {
    expect(documentCorrectionSchema.safeParse({ ...valid, status: 'invalido' }).success).toBe(false);
    expect(documentCorrectionSchema.safeParse({ ...valid, status: 'invalido', issue: 'sin_firma' }).success).toBe(true);
  });
  it('permite descartar un documento: otro + inválido + tipo_no_reconocido', () => {
    expect(
      documentCorrectionSchema.safeParse({ documentType: 'otro', status: 'invalido', issue: 'tipo_no_reconocido' }).success,
    ).toBe(true);
  });
  it('rechaza estados que no son una decisión humana', () => {
    expect(documentCorrectionSchema.safeParse({ ...valid, status: 'requiere_revision' }).success).toBe(false);
    expect(documentCorrectionSchema.safeParse({ ...valid, status: 'pendiente_analisis' }).success).toBe(false);
  });
});