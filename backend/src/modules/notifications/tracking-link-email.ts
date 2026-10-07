// modules/notifications/tracking-link-email.ts
export function buildTrackingLinkEmail(referenceCode: string, trackingUrl: string) {
  return {
    subject: `Recibimos tu solicitud (${referenceCode})`,
    text: [
      'Hola, lamentamos mucho tu pérdida.',
      '',
      `Recibimos tu solicitud. Tu código de referencia es ${referenceCode}.`,
      '',
      'Con este enlace puedes ver en qué va tu reclamación, qué documentos necesitamos y subirlos:',
      trackingUrl,
      '',
      'Este enlace es personal: no lo compartas. Guarda este correo, porque es la única forma de volver a tu solicitud.',
      'Te escribiremos en cuanto revisemos tus documentos.',
    ].join('\n'),
  };
}