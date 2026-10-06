// backend/src/modules/intake/tracking.view.spec.ts
import type { DocumentIssue, DocumentStatus, DocumentType } from '../../common/domain/enums';
import type { DocumentInput } from '../completeness/completeness';
import { buildTrackingView } from './tracking.view';
import type { TrackingClaim } from './tracking.view';

let counter = 0;
const doc = (
  type: DocumentType | null,
  status: DocumentStatus,
  issue: DocumentIssue | null = null,
): DocumentInput => ({
  id: `doc-${++counter}`,
  type,
  status,
  issue,
  uploadedAt: new Date('2026-10-02T10:00:00Z'),
});

const claim = (overrides: Partial<TrackingClaim> = {}): TrackingClaim => ({
  referenceCode: 'RC-2026-000001',
  status: 'recibida',
  claimType: null,
  receivedAt: new Date('2026-10-02T10:00:00Z'),
  ...overrides,
});

const NATURAL: DocumentType[] = [
  'formato_reclamacion',
  'registro_civil_defuncion',
  'certificado_medico_defuncion',
  'documento_identidad_asegurado',
  'documento_identidad_beneficiario',
  'formulario_sarlaft',
  'certificacion_bancaria',
];

describe('buildTrackingView', () => {
  it('sin tipo de reclamación: "revisando", sin lista inventada', () => {
    const view = buildTrackingView(claim(), [doc(null, 'pendiente_analisis')]);
    expect(view.stage).toBe('revisando');
    expect(view.checklist).toEqual([]);
    expect(view.documentsReceived).toBe(1);
  });

  it('con el tipo conocido separa lo que está listo de lo que falta', () => {
    const view = buildTrackingView(claim({ status: 'incompleta', claimType: 'muerte_natural' }), [
      doc('formato_reclamacion', 'valido'),
      doc('registro_civil_defuncion', 'valido'),
    ]);
    const state = (t: DocumentType) => view.checklist.find((i) => i.documentType === t)?.state;

    expect(view.stage).toBe('faltan_documentos');
    expect(view.checklist).toHaveLength(7);
    expect(state('formato_reclamacion')).toBe('listo');
    expect(state('certificacion_bancaria')).toBe('falta');
  });

  it('un documento que llegó pero no sirve se explica distinto de uno que falta', () => {
    const view = buildTrackingView(claim({ status: 'incompleta', claimType: 'muerte_natural' }), [
      doc('formulario_sarlaft', 'invalido', 'sin_firma'),
    ]);
    const sarlaft = view.checklist.find((i) => i.documentType === 'formulario_sarlaft');
    const bank = view.checklist.find((i) => i.documentType === 'certificacion_bancaria');

    expect(sarlaft?.state).toBe('no_sirve');
    expect(sarlaft?.message).toContain('firma');
    expect(bank?.state).toBe('falta');
    expect(bank?.message).toBeNull();
  });

  it('con archivos sin analizar no afirma que algo falta todavía', () => {
    const view = buildTrackingView(claim({ claimType: 'muerte_natural' }), [
      doc(null, 'pendiente_analisis'),
    ]);
    expect(view.stage).toBe('revisando');
    expect(view.checklist.some((i) => i.state === 'falta')).toBe(false);
  });

  it('nunca dice "completa" antes de que la base lo registre', () => {
    const allValid = NATURAL.map((t) => doc(t, 'valido'));

    const lagging = buildTrackingView(
      claim({ status: 'incompleta', claimType: 'muerte_natural' }),
      allValid,
    );
    expect(lagging.stage).toBe('revisando');

    const recorded = buildTrackingView(
      claim({ status: 'completa', claimType: 'muerte_natural' }),
      allValid,
    );
    expect(recorded.stage).toBe('completa');
  });

  it('un caso cerrado no revela si se pagó o se objetó', () => {
    for (const status of ['pagada', 'objetada'] as const) {
      const view = buildTrackingView(claim({ status, claimType: 'muerte_natural' }), []);
      expect(view.stage).toBe('cerrada');
      expect(JSON.stringify(view)).not.toMatch(/pagad|objet/i);
    }
  });

  it('no expone ids internos de documentos', () => {
    const view = buildTrackingView(claim({ claimType: 'muerte_natural' }), [
      doc('formato_reclamacion', 'valido'),
    ]);
    expect(JSON.stringify(view)).not.toContain('doc-');
  });
});