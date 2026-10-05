/** Ya existe un caso abierto para ese beneficiario y ese asegurado. */
export class OpenClaimAlreadyExistsError extends Error {
  constructor() {
    super('Ya existe una reclamación abierta para este beneficiario y este asegurado');
    this.name = 'OpenClaimAlreadyExistsError';
  }
}

/** La misma llave de idempotencia se usó para otra reclamación distinta. */
export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super('La llave de idempotencia ya fue usada en otra reclamación');
    this.name = 'IdempotencyKeyConflictError';
  }
}