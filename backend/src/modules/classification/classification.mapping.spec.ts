import { evaluateDocument } from './classification.policy.js';
import { verdictToDocumentFields } from './classification.mapping.js';
import { evaluateCompleteness, type DocumentInput } from '../completeness/completeness.js';
import type { DocumentAnalysis, DocumentType } from './classification.schemas.js';

const f = <T>(value: T, confidence = 0.95) => ({ value, confidence });

function analysis(over: Partial<DocumentAnalysis> = {}): DocumentAnalysis {
  return {
    documentType: f<DocumentType>('formulario_sarlaft'),
    legible: f(true),
    signed: f<boolean | null>(true),
    matchesInsured: f<boolean | null>(null),
    reason: 'interno',
    ...over,
  };
}

function asInput(id: string, a: DocumentAnalysis): DocumentInput {
  const fields = verdictToDocumentFields(evaluateDocument(a));
  return { id, type: fields.type, status: fields.status, issue: fields.issue, uploadedAt: new Date('2026-10-01T10:00:00Z') };
}

describe('verdictToDocumentFields', () => {
  it('válido', () => {
    expect(verdictToDocumentFields(evaluateDocument(analysis()))).toEqual({
      type: 'formulario_sarlaft', status: 'valido', issue: null,
    });
  });

  it('inválido por falta de firma', () => {
    expect(verdictToDocumentFields(evaluateDocument(analysis({ signed: f<boolean | null>(false) })))).toEqual({
      type: 'formulario_sarlaft', status: 'invalido', issue: 'sin_firma',
    });
  });

  it('tipo incierto: queda sin identificar y para revisión', () => {
    const fields = verdictToDocumentFields(evaluateDocument(analysis({ documentType: f<DocumentType>('formulario_sarlaft', 0.4) })));
    expect(fields).toEqual({ type: 'no_identificado', status: 'requiere_revision', issue: 'tipo_no_reconocido' });
  });

  it('"otro" va a revisión, nunca a válido', () => {
    const fields = verdictToDocumentFields(evaluateDocument(analysis({ documentType: f<DocumentType>('otro') })));
    expect(fields.status).toBe('requiere_revision');
  });
});

describe('veredicto + completitud', () => {
  it('SARLAFT sin firma: el requisito queda inválido, con su motivo, y no "faltante"', () => {
    const r = evaluateCompleteness('muerte_natural', [asInput('d1', analysis({ signed: f<boolean | null>(false) }))]);
    expect(r.invalid).toEqual([{ documentType: 'formulario_sarlaft', issue: 'sin_firma', documentId: 'd1' }]);
    expect(r.missing).not.toContain('formulario_sarlaft');
    expect(r.isComplete).toBe(false);
  });

  it('firma dudosa: el requisito queda en revisión', () => {
    const r = evaluateCompleteness('muerte_natural', [asInput('d1', analysis({ signed: f<boolean | null>(true, 0.5) }))]);
    expect(r.inReview).toContain('formulario_sarlaft');
  });

  it('un documento "otro" no satisface ningún requisito', () => {
    const r = evaluateCompleteness('muerte_natural', [asInput('d1', analysis({ documentType: f<DocumentType>('otro') }))]);
    expect(r.isComplete).toBe(false);
    expect(r.unmatchedDocumentIds).toEqual(['d1']);
  });
});