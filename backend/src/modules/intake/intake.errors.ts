// backend/src/modules/intake/intake.errors.ts

/**
 * El caso abierto que causó el conflicto se cerró justo antes de poder anexar el
 * envío. Es una carrera muy improbable; el beneficiario puede reintentar.
 */
export class OpenClaimChangedError extends Error {
  constructor() {
    super('El estado de la reclamación cambió mientras se procesaba el envío');
    this.name = 'OpenClaimChangedError';
  }
}

/** El token de seguimiento no corresponde a ningún caso (o está mal formado). */
export class TrackingTokenNotFoundError extends Error {
  constructor() {
    super('El token de seguimiento no corresponde a ninguna reclamación');
    this.name = 'TrackingTokenNotFoundError';
  }
}

/** El caso ya no admite documentos del beneficiario: está cerrado o ya quedó completo. */
export class ClaimNotAcceptingDocumentsError extends Error {
  constructor(public readonly reason: 'cerrada' | 'completa') {
    super(`La reclamación no admite más documentos (${reason})`);
    this.name = 'ClaimNotAcceptingDocumentsError';
  }
}