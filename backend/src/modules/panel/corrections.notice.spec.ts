import { buildCorrectionNotice } from './corrections.notice';

const summary = (over = {}) => ({ isComplete: false, missing: [], invalid: [], inReview: [], ...over });

describe('buildCorrectionNotice', () => {
  it('sin resumen (caso sin reloj) no hay aviso', () => {
    expect(buildCorrectionNotice(null)).toBeNull();
  });
  it('si sigue completo, lo dice y recuerda que el plazo no cambia', () => {
    const n = buildCorrectionNotice(summary({ isComplete: true }))!;
    expect(n).toContain('el plazo no cambia');
    expect(n).toContain('sigue completo');
  });
  it('lista lo que faltaría con las etiquetas legibles', () => {
    const n = buildCorrectionNotice(summary({ missing: ['informe_autoridad'] }))!;
    expect(n).toContain('Informe de la autoridad competente');
    expect(n).toContain('pedir documentos');
  });
  it('lista lo que dejaría de servir y lo que quedaría en revisión', () => {
    const n = buildCorrectionNotice(
      summary({ invalid: [{ documentType: 'formulario_sarlaft', issue: 'sin_firma' }], inReview: ['certificacion_bancaria'] }),
    )!;
    expect(n).toContain('no servirían: Formulario SARLAFT firmado');
    expect(n).toContain('quedarían en revisión: Certificación bancaria');
  });
});