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