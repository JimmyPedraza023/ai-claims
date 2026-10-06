import { parseModelOutput } from './parse-model-output.js';
import { LlmError } from './llm-provider.js';
import { ClaimClassificationSchema, DocumentAnalysisSchema } from './classification.schemas.js';

const analysis = {
  documentType: { value: 'sarlaft', confidence: 0.9 },
  legible: { value: true, confidence: 0.95 },
  signed: { value: false, confidence: 0.8 },
  matchesInsured: { value: null, confidence: 1 },
  reason: 'No se ve firma en el recuadro correspondiente',
};

function kindOf(fn: () => unknown): string | undefined {
  try { fn(); } catch (e) { return (e as LlmError).kind; }
  return undefined;
}

describe('parseModelOutput', () => {
  it('acepta JSON limpio', () => {
    expect(parseModelOutput(JSON.stringify(analysis), DocumentAnalysisSchema).documentType.value).toBe('sarlaft');
  });

  it('acepta JSON dentro de un bloque de código', () => {
    const raw = '```json\n' + JSON.stringify(analysis) + '\n```';
    expect(parseModelOutput(raw, DocumentAnalysisSchema).signed.value).toBe(false);
  });

  it('acepta JSON rodeado de texto', () => {
    const raw = 'Claro, aquí está: ' + JSON.stringify(analysis) + ' Espero que sirva.';
    expect(parseModelOutput(raw, DocumentAnalysisSchema).legible.value).toBe(true);
  });

  it('ignora claves extra', () => {
    const raw = JSON.stringify({ ...analysis, comentario: 'extra' });
    expect(parseModelOutput(raw, DocumentAnalysisSchema).reason).toContain('firma');
  });

  it('rechaza respuesta vacía o nula', () => {
    expect(kindOf(() => parseModelOutput('', DocumentAnalysisSchema))).toBe('invalid_output');
    expect(kindOf(() => parseModelOutput(null, DocumentAnalysisSchema))).toBe('invalid_output');
  });

  it('rechaza texto que no es JSON', () => {
    expect(kindOf(() => parseModelOutput('no sé qué responder', DocumentAnalysisSchema))).toBe('invalid_output');
  });

  it('rechaza un tipo de documento que no está en la lista', () => {
    const raw = JSON.stringify({ ...analysis, documentType: { value: 'pasaporte', confidence: 0.9 } });
    expect(kindOf(() => parseModelOutput(raw, DocumentAnalysisSchema))).toBe('invalid_output');
  });

  it('rechaza una confianza fuera de rango', () => {
    const raw = JSON.stringify({ ...analysis, legible: { value: true, confidence: 1.7 } });
    expect(kindOf(() => parseModelOutput(raw, DocumentAnalysisSchema))).toBe('invalid_output');
  });

  it('rechaza si falta un campo obligatorio', () => {
    const { reason: _omit, ...sinMotivo } = analysis;
    expect(kindOf(() => parseModelOutput(JSON.stringify(sinMotivo), DocumentAnalysisSchema))).toBe('invalid_output');
  });

  it('el mensaje de error no filtra el contenido que devolvió el modelo', () => {
    const raw = JSON.stringify({ ...analysis, documentType: { value: 'CEDULA-1234567-ANA PEREZ', confidence: 0.9 } });
    try {
      parseModelOutput(raw, DocumentAnalysisSchema);
      throw new Error('debía fallar');
    } catch (e) {
      expect((e as Error).message).not.toContain('1234567');
      expect((e as Error).message).not.toContain('ANA PEREZ');
    }
  });

  it('el esquema de clasificación admite "indeterminado"', () => {
    const raw = JSON.stringify({ claimType: { value: 'indeterminado', confidence: 0.4 }, evidence: 'texto ambiguo' });
    expect(parseModelOutput(raw, ClaimClassificationSchema).claimType.value).toBe('indeterminado');
  });
});