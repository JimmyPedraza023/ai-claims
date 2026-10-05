import { normalizeDocumentNumber, normalizeEmail, normalizeName } from './claim-normalization';

describe('normalizeDocumentNumber', () => {
  it.each([
    ['1.234.567', '1234567'],
    ['1 234 567', '1234567'],
    ['1-234-567', '1234567'],
    ['  1234567 ', '1234567'],
    ['ab-123', 'AB123'],
    ['1234567', '1234567'],
  ])('%s -> %s', (entrada, esperado) => {
    expect(normalizeDocumentNumber(entrada)).toBe(esperado);
  });

  it('formatos distintos del mismo documento quedan idénticos', () => {
    expect(normalizeDocumentNumber('79.123.456')).toBe(normalizeDocumentNumber('79123456'));
  });
});

describe('normalizeEmail y normalizeName', () => {
  it('correo en minúsculas y sin espacios', () => {
    expect(normalizeEmail('  Maria.Perez@Correo.COM ')).toBe('maria.perez@correo.com');
  });

  it('nombre sin espacios repetidos', () => {
    expect(normalizeName('  María   del  Pilar  Pérez ')).toBe('María del Pilar Pérez');
  });
});