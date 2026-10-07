import { aiRunStatusFor } from './ai-run-status';

describe('aiRunStatusFor', () => {
  it.each([
    ['timeout', 'timeout'],
    ['invalid_output', 'salida_invalida'],
    ['rate_limited', 'error'],
    ['unavailable', 'error'],
    ['refused', 'error'],
    ['bad_request', 'error'],
    ['inesperado', 'error'],
  ] as const)('%s → %s', (kind, expected) => {
    expect(aiRunStatusFor(kind)).toBe(expected);
  });
});