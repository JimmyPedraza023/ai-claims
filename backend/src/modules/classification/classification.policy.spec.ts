import {
  decideClaimType, evaluateDocument, THRESHOLDS,
  type ExistingClaimType,
} from './classification.policy.js';
import type {
  ClaimClassification, ClaimType, DocumentAnalysis, DocumentType,
} from './classification.schemas.js';

import { validityConfidence } from './classification.policy.js';

const f = <T>(value: T, confidence = 0.95) => ({ value, confidence });

function doc(over: Partial<DocumentAnalysis> = {}): DocumentAnalysis {
  return {
    documentType: f<DocumentType>('certificacion_bancaria'),
    legible: f(true),
    signed: f<boolean | null>(null),
    matchesInsured: f<boolean | null>(null),
    reason: 'texto interno del modelo',
    ...over,
  };
}

const formularioSarlaft = (over: Partial<DocumentAnalysis> = {}) =>
  doc({ documentType: f<DocumentType>('formulario_sarlaft'), signed: f<boolean | null>(true), ...over });

const cedulaAsegurado = (over: Partial<DocumentAnalysis> = {}) =>
  doc({ documentType: f<DocumentType>('documento_identidad_asegurado'), matchesInsured: f<boolean | null>(true), ...over });

describe('evaluateDocument', () => {
  it('un documento claro, sin reglas especiales, es válido', () => {
    expect(evaluateDocument(doc())).toEqual({ status: 'valido', documentType: 'certificacion_bancaria', reason: null });
  });

  it('tipo incierto: en revisión y sin tipo, para que no cuente en ningún requisito', () => {
    const v = evaluateDocument(doc({ documentType: f<DocumentType>('formulario_sarlaft', 0.5) }));
    expect(v).toEqual({ status: 'en_revision', documentType: null, reason: 'tipo_incierto' });
  });

  it('un documento "otro" no corresponde a ningún requisito', () => {
    const v = evaluateDocument(doc({ documentType: f<DocumentType>('otro') }));
    expect(v.status).toBe('no_corresponde');
  });

  it('ilegible con confianza: inválido', () => {
    expect(evaluateDocument(doc({ legible: f(false, 0.95) }))).toMatchObject({ status: 'invalido', reason: 'ilegible' });
  });

  it('ilegible con poca confianza: nunca inválido, va a revisión', () => {
    expect(evaluateDocument(doc({ legible: f(false, 0.4) }))).toMatchObject({
      status: 'en_revision', reason: 'legibilidad_incierta',
    });
  });

  it('FORMULARIO_SARLAFT firmado es válido', () => {
    expect(evaluateDocument(formularioSarlaft()).status).toBe('valido');
  });

  it('FORMULARIO_SARLAFT sin firma, con confianza: inválido por falta de firma', () => {
    expect(evaluateDocument(formularioSarlaft({ signed: f<boolean | null>(false) }))).toMatchObject({
      status: 'invalido', reason: 'sin_firma',
    });
  });

  it('FORMULARIO_SARLAFT con firma dudosa o sin dato de firma: revisión humana', () => {
    expect(evaluateDocument(formularioSarlaft({ signed: f<boolean | null>(false, 0.5) }))).toMatchObject({
      status: 'en_revision', reason: 'firma_incierta',
    });
    expect(evaluateDocument(formularioSarlaft({ signed: f<boolean | null>(null) }))).toMatchObject({
      status: 'en_revision', reason: 'firma_incierta',
    });
  });

  it('la firma solo se exige donde corresponde', () => {
    const v = evaluateDocument(doc({ signed: f<boolean | null>(false) })); // certificación bancaria
    expect(v.status).toBe('valido');
  });

  it('si no se lee, ese es el motivo: no se juzga la firma', () => {
    const v = evaluateDocument(formularioSarlaft({ legible: f(false), signed: f<boolean | null>(false) }));
    expect(v.reason).toBe('ilegible');
  });

  it('cédula del asegurado que coincide: válida', () => {
    expect(evaluateDocument(cedulaAsegurado()).status).toBe('valido');
  });

  it('cédula que no corresponde al asegurado, con confianza: inválida', () => {
    expect(evaluateDocument(cedulaAsegurado({ matchesInsured: f<boolean | null>(false) }))).toMatchObject({
      status: 'invalido', reason: 'no_corresponde_asegurado',
    });
  });

  it('cédula con coincidencia dudosa o desconocida: revisión humana', () => {
    expect(evaluateDocument(cedulaAsegurado({ matchesInsured: f<boolean | null>(true, 0.5) }))).toMatchObject({
      status: 'en_revision', reason: 'asegurado_incierto',
    });
    expect(evaluateDocument(cedulaAsegurado({ matchesInsured: f<boolean | null>(null) }))).toMatchObject({
      status: 'en_revision', reason: 'asegurado_incierto',
    });
  });

  it('el umbral es inclusivo: confianza igual al umbral se acepta', () => {
    const v = evaluateDocument(doc({ legible: f(true, THRESHOLDS.legible) }));
    expect(v.status).toBe('valido');
  });

  it('invariante: con cualquier confianza bajo su umbral, nunca sale "valido"', () => {
    const casos = [
      formularioSarlaft({ documentType: f<DocumentType>('formulario_sarlaft', THRESHOLDS.documentType - 0.01) }),
      formularioSarlaft({ legible: f(true, THRESHOLDS.legible - 0.01) }),
      formularioSarlaft({ signed: f<boolean | null>(true, THRESHOLDS.signed - 0.01) }),
      cedulaAsegurado({ matchesInsured: f<boolean | null>(true, THRESHOLDS.matchesInsured - 0.01) }),
    ];
    for (const caso of casos) expect(evaluateDocument(caso).status).not.toBe('valido');
  });

  it('"no_identificado" va a revisión aunque el modelo esté seguro', () => {
    const v = evaluateDocument(doc({ documentType: f<DocumentType>('no_identificado', 0.99) }));
    expect(v).toEqual({ status: 'en_revision', documentType: null, reason: 'tipo_incierto' });
  });
});

describe('decideClaimType', () => {
  const clasif = (value: ClaimType | 'indeterminado', confidence = 0.95): ClaimClassification => ({
    claimType: f(value, confidence), evidence: 'texto interno',
  });
  const vacio: ExistingClaimType = { claimType: null, source: null };

  it('confianza alta y sin tipo previo: lo asigna el modelo', () => {
    expect(decideClaimType(clasif('muerte_natural'), vacio)).toEqual({
      claimType: 'muerte_natural', source: 'modelo', shouldWrite: true, reviewRequired: false, reason: 'asignado_por_modelo',
    });
  });

  it('"indeterminado": no se escribe nada y se pide revisión', () => {
    expect(decideClaimType(clasif('indeterminado'), vacio)).toMatchObject({
      claimType: null, shouldWrite: false, reviewRequired: true, reason: 'tipo_indeterminado',
    });
  });

  it('baja confianza: no se escribe y se pide revisión', () => {
    expect(decideClaimType(clasif('muerte_accidental', 0.6), vacio)).toMatchObject({
      claimType: null, shouldWrite: false, reviewRequired: true, reason: 'baja_confianza',
    });
  });

  it('lo que fijó una persona no lo cambia el modelo', () => {
    const existing: ExistingClaimType = { claimType: 'muerte_natural', source: 'persona' };
    expect(decideClaimType(clasif('muerte_accidental'), existing)).toMatchObject({
      claimType: 'muerte_natural', source: 'persona', shouldWrite: false, reviewRequired: false,
    });
  });

  it('si el modelo coincide con lo guardado, no hay escritura ni revisión', () => {
    const existing: ExistingClaimType = { claimType: 'muerte_natural', source: 'modelo' };
    expect(decideClaimType(clasif('muerte_natural'), existing)).toMatchObject({
      shouldWrite: false, reviewRequired: false, reason: 'mantenido',
    });
  });

  it('si el modelo propone otro tipo, se conserva el guardado y se pide revisión', () => {
    const existing: ExistingClaimType = { claimType: 'muerte_natural', source: 'modelo' };
    expect(decideClaimType(clasif('muerte_accidental'), existing)).toMatchObject({
      claimType: 'muerte_natural', shouldWrite: false, reviewRequired: true, reason: 'cambio_de_tipo',
    });
  });

  it('con duda en una re-evaluación, no se borra el tipo ya guardado', () => {
    const existing: ExistingClaimType = { claimType: 'muerte_natural', source: 'modelo' };
    expect(decideClaimType(clasif('indeterminado'), existing)).toMatchObject({
      claimType: 'muerte_natural', shouldWrite: false, reviewRequired: true,
    });
  });
});

describe('validityConfidence', () => {
  it('toma la confianza más baja de las comprobaciones que le aplican', () => {
    expect(validityConfidence(formularioSarlaft({ signed: f<boolean | null>(true, 0.82), legible: f(true, 0.9) }))).toBe(0.82);
  });

  it('ignora la firma en documentos que no la exigen', () => {
    expect(validityConfidence(doc({ signed: f<boolean | null>(false, 0.1) }))).toBe(0.95);
  });

  it('en la cédula del asegurado cuenta la coincidencia', () => {
    expect(validityConfidence(cedulaAsegurado({ matchesInsured: f<boolean | null>(true, 0.81) }))).toBe(0.81);
  });
});

describe('evaluateDocument con páginas omitidas', () => {
  it('un válido pasa a revisión', () => {
    expect(evaluateDocument(formularioSarlaft(), { partial: true })).toMatchObject({ status: 'en_revision', reason: 'paginas_omitidas' });
  });
  it('un inválido también: la firma podría estar en una página que no se vio', () => {
    expect(evaluateDocument(formularioSarlaft({ signed: f<boolean | null>(false) }), { partial: true }))
      .toMatchObject({ status: 'en_revision', reason: 'paginas_omitidas' });
  });
  it('lo que ya iba a revisión o no corresponde a nada no cambia', () => {
    expect(evaluateDocument(doc({ documentType: f<DocumentType>('otro') }), { partial: true }).status).toBe('no_corresponde');
    expect(evaluateDocument(doc({ documentType: f<DocumentType>('formulario_sarlaft', 0.4) }), { partial: true }).reason).toBe('tipo_incierto');
  });
});