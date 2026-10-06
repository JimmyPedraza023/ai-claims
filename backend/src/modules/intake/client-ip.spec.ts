// backend/src/modules/intake/client-ip.spec.ts
import { hashClientIp } from './client-ip';

const secret = 'secreto-de-pruebas-0123456789';

describe('hashClientIp', () => {
  it('devuelve 64 caracteres hexadecimales y no contiene la IP', () => {
    const hash = hashClientIp('190.25.10.7', secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('190.25.10.7');
  });

  it('es determinista: la misma IP da el mismo hash', () => {
    expect(hashClientIp('190.25.10.7', secret)).toBe(hashClientIp('190.25.10.7', secret));
  });

  it('otra IP u otro secreto dan otro hash', () => {
    const base = hashClientIp('190.25.10.7', secret);
    expect(hashClientIp('190.25.10.8', secret)).not.toBe(base);
    expect(hashClientIp('190.25.10.7', 'otro-secreto-0123456789')).not.toBe(base);
  });

  it('trata ::ffff:1.2.3.4 igual que 1.2.3.4', () => {
    expect(hashClientIp('::ffff:190.25.10.7', secret)).toBe(hashClientIp('190.25.10.7', secret));
  });

  it('sin IP o sin secreto no se guarda nada (null)', () => {
    expect(hashClientIp(undefined, secret)).toBeNull();
    expect(hashClientIp('190.25.10.7', undefined)).toBeNull();
  });
});