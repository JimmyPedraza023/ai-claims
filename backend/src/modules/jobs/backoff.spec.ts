import { backoffSeconds } from './backoff';

describe('backoffSeconds', () => {
  it('crece al doble en cada intento', () => {
    expect([1, 2, 3, 4, 5].map((n) => backoffSeconds(n))).toEqual([30, 60, 120, 240, 480]);
  });
  it('tiene un tope', () => {
    expect(backoffSeconds(10)).toBe(900);
    expect(backoffSeconds(1000)).toBe(900);
  });
  it('respeta un mínimo (por ejemplo, tras un 429)', () => {
    expect(backoffSeconds(1, 60)).toBe(60);
    expect(backoffSeconds(5, 60)).toBe(480);
  });
  it('trata un intento 0 o negativo como el primero', () => {
    expect(backoffSeconds(0)).toBe(30);
    expect(backoffSeconds(-3)).toBe(30);
  });
});