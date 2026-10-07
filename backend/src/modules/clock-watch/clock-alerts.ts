// modules/clock-watch/clock-alerts.ts
export interface ClockAlertInput {
  referenceCode: string;
  deadlineDate: string;   // 'YYYY-MM-DD'
  daysRemaining: number;
  daysElapsed: number;
  daysTotal: number;
}

export function draftClockAlert(kind: 'alerta_riesgo' | 'alerta_vencido', claimId: string, c: ClockAlertInput) {
  const risk = kind === 'alerta_riesgo';
  return {
    kind,
    dedupeKey: `${risk ? 'riesgo' : 'vencido'}:${claimId}`,
    subject: risk
      ? `[Plazo en riesgo] ${c.referenceCode}: quedan ${c.daysRemaining} días`
      : `[Plazo vencido] ${c.referenceCode}`,
    body: [
      risk
        ? `El caso ${c.referenceCode} lleva ${c.daysElapsed} de ${c.daysTotal} días de plazo y vence el ${c.deadlineDate} (quedan ${c.daysRemaining}).`
        : `El plazo del caso ${c.referenceCode} venció el ${c.deadlineDate} sin pago ni objeción registrados.`,
      'Falta la decisión de una persona: pagar, objetar o pedir más documentos.',
    ].join('\n'),
  };
}