// notification-drafts.spec.ts
import { evaluateCompleteness, type DocumentInput } from '../completeness/completeness';
import { REQUIRED_DOCUMENTS } from '../completeness/completeness.rules';
import { draftBeneficiaryNotice } from './notification-drafts';

const doc = (id: string, type: DocumentInput['type'], status: DocumentInput['status'] = 'valido',
             issue: DocumentInput['issue'] = null): DocumentInput =>
  ({ id, type, status, issue, uploadedAt: new Date('2026-10-01') });

const all = REQUIRED_DOCUMENTS.muerte_natural.map((t, i) => doc(`d${i}`, t));
const CLAIM = 'c1';

describe('draftBeneficiaryNotice', () => {
  it('expediente completo -> aviso de completo, sin hablar de plazo', () => {
    const d = draftBeneficiaryNotice(CLAIM, evaluateCompleteness('muerte_natural', all))!;
    expect(d.kind).toBe('expediente_completo');
    expect(d.dedupeKey).toBe('completo:c1');
    expect(d.body.toLowerCase()).not.toContain('plazo');
  });

  it('falta un documento -> faltantes con su etiqueta', () => {
    const d = draftBeneficiaryNotice(CLAIM, evaluateCompleteness('muerte_natural', all.slice(1)))!;
    expect(d.kind).toBe('faltantes');
    expect(d.body).toContain('aún no nos han llegado');
    expect(d.body).toContain('Formato de reclamación diligenciado');
  });

  it('documento que llega pero no sirve -> documento_invalido, distinto de "falta"', () => {
    const docs = all.map((x) => x.type === 'formulario_sarlaft' ? doc(x.id, x.type, 'invalido', 'sin_firma') : x);
    const d = draftBeneficiaryNotice(CLAIM, evaluateCompleteness('muerte_natural', docs))!;
    expect(d.kind).toBe('documento_invalido');
    expect(d.body).toContain('le falta la firma');
    expect(d.body).not.toContain('aún no nos han llegado');
  });

  it('mismo estado -> misma clave; otro faltante -> otra clave', () => {
    const a = draftBeneficiaryNotice(CLAIM, evaluateCompleteness('muerte_natural', all.slice(1)))!;
    const b = draftBeneficiaryNotice(CLAIM, evaluateCompleteness('muerte_natural', all.slice(1)))!;
    const c = draftBeneficiaryNotice(CLAIM, evaluateCompleteness('muerte_natural', all.slice(2)))!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.dedupeKey).not.toBe(c.dedupeKey);
  });

  it('no avisa con análisis pendiente ni con un documento sin requisito en revisión', () => {
    const pending = [...all.slice(1), doc('p', 'otro', 'pendiente_analisis')];
    expect(draftBeneficiaryNotice(CLAIM, evaluateCompleteness('muerte_natural', pending))).toBeNull();
    const review = [...all.slice(1), doc('r', 'otro', 'requiere_revision')];
    expect(draftBeneficiaryNotice(CLAIM, evaluateCompleteness('muerte_natural', review))).toBeNull();
  });

  it('si lo único pendiente está en revisión humana, no avisa', () => {
    const docs = all.map((x) => x.type === 'certificacion_bancaria' ? doc(x.id, x.type, 'requiere_revision') : x);
    expect(draftBeneficiaryNotice(CLAIM, evaluateCompleteness('muerte_natural', docs))).toBeNull();
  });
});