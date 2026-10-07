import { decideStatusChange } from './completeness.transition';

describe('decideStatusChange', () => {
  it.each([
    ['recibida', true, 'iniciar_reloj'],
    ['incompleta', true, 'iniciar_reloj'],
    ['recibida', false, 'marcar_incompleta'],
    ['incompleta', false, 'sin_cambio'],
    ['completa', true, 'sin_cambio'],
    ['completa', false, 'sin_cambio'], // el reloj no se deshace
    ['pagada', true, 'sin_cambio'],
    ['objetada', false, 'sin_cambio'],
  ] as const)('%s con completo=%s → %s', (status, complete, expected) => {
    expect(decideStatusChange(status, complete)).toBe(expected);
  });
});