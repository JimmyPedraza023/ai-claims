import { DocumentIssue, DocumentStatus, DocumentType } from '../../common/domain/enums';
import { REQUIRED_DOCUMENTS, RULES_VERSION } from './completeness.rules';
import { DocumentInput, evaluateCompleteness } from './completeness';

let contador = 0;
/** Crea un documento de prueba. Por defecto: válido. */
function doc(
  type: DocumentType | null,
  status: DocumentStatus = 'valido',
  extra: { issue?: DocumentIssue; uploadedAt?: string } = {},
): DocumentInput {
  contador += 1;
  return {
    id: `doc-${contador}`,
    type,
    status,
    issue: extra.issue ?? null,
    uploadedAt: new Date(extra.uploadedAt ?? `2026-10-0${(contador % 9) + 1}T10:00:00Z`),
  };
}

/** Todos los documentos válidos que exige un tipo de reclamación. */
const expedienteCompleto = (tipo: keyof typeof REQUIRED_DOCUMENTS) =>
  REQUIRED_DOCUMENTS[tipo].map((t) => doc(t));

describe('evaluateCompleteness: reglas por tipo de reclamación', () => {
  it('muerte natural completa: los 7 documentos válidos', () => {
    const r = evaluateCompleteness('muerte_natural', expedienteCompleto('muerte_natural'));
    expect(REQUIRED_DOCUMENTS.muerte_natural).toHaveLength(7);
    expect(r.isComplete).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.rulesVersion).toBe(RULES_VERSION);
  });

  it('muerte accidental exige todo lo de muerte natural más el informe de la autoridad', () => {
    expect(REQUIRED_DOCUMENTS.muerte_accidental).toHaveLength(8);
    const sinInforme = expedienteCompleto('muerte_natural');
    const r1 = evaluateCompleteness('muerte_accidental', sinInforme);
    expect(r1.isComplete).toBe(false);
    expect(r1.missing).toEqual(['informe_autoridad']);

    const r2 = evaluateCompleteness('muerte_accidental', [...sinInforme, doc('informe_autoridad')]);
    expect(r2.isComplete).toBe(true);
  });

  it('incapacidad total y permanente: sus 6 documentos, sin registro civil ni certificado de defunción', () => {
    expect(REQUIRED_DOCUMENTS.incapacidad_total_permanente).toHaveLength(6);
    const r = evaluateCompleteness(
      'incapacidad_total_permanente',
      expedienteCompleto('incapacidad_total_permanente'),
    );
    expect(r.isComplete).toBe(true);
    expect(REQUIRED_DOCUMENTS.incapacidad_total_permanente).not.toContain('registro_civil_defuncion');
  });

  it('sin documentos: todo falta y no está completo', () => {
    const r = evaluateCompleteness('muerte_natural', []);
    expect(r.isComplete).toBe(false);
    expect(r.missing).toHaveLength(7);
  });

  it('si falta uno, lo dice y no está completo', () => {
    const docs = expedienteCompleto('muerte_natural').filter(
      (d) => d.type !== 'certificacion_bancaria',
    );
    const r = evaluateCompleteness('muerte_natural', docs);
    expect(r.isComplete).toBe(false);
    expect(r.missing).toEqual(['certificacion_bancaria']);
  });
});

describe('evaluateCompleteness: un documento puede llegar y aun así no servir', () => {
  it('SARLAFT sin firma: no cuenta como faltante, cuenta como inválido, con su motivo', () => {
    const docs = expedienteCompleto('muerte_natural').map((d) =>
      d.type === 'formulario_sarlaft' ? { ...d, status: 'invalido' as const, issue: 'sin_firma' as const } : d,
    );
    const r = evaluateCompleteness('muerte_natural', docs);
    expect(r.isComplete).toBe(false);
    expect(r.missing).toEqual([]); // no "falta": llegó
    expect(r.invalid).toEqual([
      { documentType: 'formulario_sarlaft', issue: 'sin_firma', documentId: expect.any(String) },
    ]);
  });

  it('distingue los motivos: ilegible vs. cédula que no corresponde al asegurado', () => {
    const docs = [
      doc('registro_civil_defuncion', 'invalido', { issue: 'ilegible' }),
      doc('documento_identidad_asegurado', 'invalido', { issue: 'no_corresponde_asegurado' }),
    ];
    const r = evaluateCompleteness('muerte_natural', docs);
    const motivos = Object.fromEntries(r.invalid.map((i) => [i.documentType, i.issue]));
    expect(motivos).toEqual({
      registro_civil_defuncion: 'ilegible',
      documento_identidad_asegurado: 'no_corresponde_asegurado',
    });
  });

  it('si luego llega uno válido del mismo tipo, el requisito queda cubierto', () => {
    const base = expedienteCompleto('muerte_natural').filter((d) => d.type !== 'formulario_sarlaft');
    const docs = [
      ...base,
      doc('formulario_sarlaft', 'invalido', { issue: 'sin_firma', uploadedAt: '2026-10-05T10:00:00Z' }),
      doc('formulario_sarlaft', 'valido', { uploadedAt: '2026-10-07T10:00:00Z' }),
    ];
    expect(evaluateCompleteness('muerte_natural', docs).isComplete).toBe(true);
  });

  it('con varios inválidos del mismo tipo, manda el motivo del más reciente', () => {
    const docs = [
      doc('formulario_sarlaft', 'invalido', { issue: 'ilegible', uploadedAt: '2026-10-05T10:00:00Z' }),
      doc('formulario_sarlaft', 'invalido', { issue: 'sin_firma', uploadedAt: '2026-10-07T10:00:00Z' }),
    ];
    const r = evaluateCompleteness('muerte_natural', docs);
    expect(r.invalid.find((i) => i.documentType === 'formulario_sarlaft')?.issue).toBe('sin_firma');
  });

  it('un reenvío pendiente de análisis pasa a "en revisión", no se le vuelve a decir que es inválido', () => {
    const docs = [
      doc('formulario_sarlaft', 'invalido', { issue: 'sin_firma' }),
      doc('formulario_sarlaft', 'pendiente_analisis'),
    ];
    const r = evaluateCompleteness('muerte_natural', docs);
    expect(r.inReview).toContain('formulario_sarlaft');
    expect(r.invalid.map((i) => i.documentType)).not.toContain('formulario_sarlaft');
  });

  it('un documento que requiere revisión humana no completa el expediente', () => {
    const docs = expedienteCompleto('muerte_natural').map((d) =>
      d.type === 'registro_civil_defuncion' ? { ...d, status: 'requiere_revision' as const } : d,
    );
    const r = evaluateCompleteness('muerte_natural', docs);
    expect(r.isComplete).toBe(false);
    expect(r.inReview).toEqual(['registro_civil_defuncion']);
  });
});

describe('evaluateCompleteness: otros casos borde', () => {
  it('un mismo documento válido repetido no cambia el resultado', () => {
    const docs = [...expedienteCompleto('muerte_natural'), doc('formulario_sarlaft')];
    expect(evaluateCompleteness('muerte_natural', docs).isComplete).toBe(true);
  });

  it('documentos que no corresponden a ningún requisito se reportan aparte y no completan nada', () => {
    const otro = doc('otro');
    const sinTipo = doc(null, 'pendiente_analisis');
    const informeSobrante = doc('informe_autoridad'); // no se exige en muerte natural
    const r = evaluateCompleteness('muerte_natural', [otro, sinTipo, informeSobrante]);
    expect(r.isComplete).toBe(false);
    expect(r.unmatchedDocumentIds).toEqual([otro.id, sinTipo.id, informeSobrante.id]);
    expect(r.pendingAnalysisCount).toBe(1);
  });

  it('un documento válido de un tipo que no se exige no sustituye a uno que sí', () => {
    const docs = [doc('dictamen_perdida_capacidad_laboral')];
    const r = evaluateCompleteness('muerte_natural', docs);
    expect(r.missing).toHaveLength(7);
  });

  it('deja trazado con qué información se decidió', () => {
    const docs = [doc('formato_reclamacion'), doc('otro', 'invalido', { issue: 'tipo_no_reconocido' })];
    const r = evaluateCompleteness('muerte_natural', docs);
    expect(r.documentsConsidered).toEqual([
      { id: docs[0].id, type: 'formato_reclamacion', status: 'valido' },
      { id: docs[1].id, type: 'otro', status: 'invalido' },
    ]);
  });

  it('no modifica la lista de documentos que recibe', () => {
    const docs = expedienteCompleto('muerte_natural');
    const copia = JSON.stringify(docs);
    evaluateCompleteness('muerte_natural', docs);
    expect(JSON.stringify(docs)).toBe(copia);
  });
});