import { validateEnv } from './env.schema';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('validateEnv', () => {
  it('aplica valores por defecto', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.DATABASE_SSL).toBe(false);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('convierte tipos (puerto, booleano, lista de orígenes)', () => {
    const env = validateEnv({
      ...base,
      PORT: '8080',
      DATABASE_SSL: 'true',
      CORS_ORIGINS: 'https://a.com, https://b.com ,',
    });
    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_SSL).toBe(true);
    expect(env.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
  });

  it('falla si falta DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rechaza una URL que no es de Postgres', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });

  it('exige CORS_ORIGINS en producción', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://app.com' }),
    ).not.toThrow();
  });

  it('no filtra el valor de las variables en el mensaje de error', () => {
    const secreto = 'mysql://usuario:clave-super-secreta@host/db';
    try {
      validateEnv({ DATABASE_URL: secreto });
      fail('debía lanzar');
    } catch (e) {
      expect((e as Error).message).not.toContain('clave-super-secreta');
    }
  });
});