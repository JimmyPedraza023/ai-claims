import { decisionSchema } from './decisions.schema';

const base = { kind: 'objetar', reason: 'Documento adulterado según el peritaje.' };

describe('decisionSchema', () => {
  it('acepta pagar y objetar con motivo', () => {
    expect(decisionSchema.safeParse({ ...base, kind: 'pagar' }).success).toBe(true);
    expect(decisionSchema.safeParse(base).success).toBe(true);
  });

  it('rechaza cualquier campo de monto', () => {
    expect(decisionSchema.safeParse({ ...base, amount: 1000 }).success).toBe(false);
  });

  it('exige motivo de al menos 10 caracteres', () => {
    expect(decisionSchema.safeParse({ ...base, reason: '   corto  ' }).success).toBe(false);
    expect(decisionSchema.safeParse({ kind: 'pagar' }).success).toBe(false);
  });

  it('pedir documentos exige documentos, y los demás no los admiten', () => {
    expect(decisionSchema.safeParse({ ...base, kind: 'pedir_documentos' }).success).toBe(false);
    expect(
      decisionSchema.safeParse({ ...base, kind: 'pedir_documentos', requestedDocuments: ['formulario_sarlaft'] }).success,
    ).toBe(true);
    expect(decisionSchema.safeParse({ ...base, requestedDocuments: ['formulario_sarlaft'] }).success).toBe(false);
  });

  it('no deja pedir "otro" ni "no_identificado"', () => {
    for (const t of ['otro', 'no_identificado']) {
      expect(decisionSchema.safeParse({ ...base, kind: 'pedir_documentos', requestedDocuments: [t] }).success).toBe(false);
    }
  });
});