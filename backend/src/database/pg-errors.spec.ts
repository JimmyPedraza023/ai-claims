import { isUniqueViolation } from './pg-errors';

describe('isUniqueViolation', () => {
  it('reconoce el código 23505', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'x' })).toBe(true);
  });

  it('filtra por nombre de restricción cuando se indica', () => {
    const err = { code: '23505', constraint: 'claims_one_open_per_beneficiary_insured' };
    expect(isUniqueViolation(err, 'claims_one_open_per_beneficiary_insured')).toBe(true);
    expect(isUniqueViolation(err, 'otro_indice')).toBe(false);
  });

  it('ignora otros errores y valores raros', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});