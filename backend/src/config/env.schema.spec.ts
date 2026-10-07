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

  const prod = {
    ...base,
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://app.com',
    IP_HASH_SECRET: 'x'.repeat(32),
    TURNSTILE_SECRET_KEY: 'clave-de-pruebas',
  };

  it('exige CORS_ORIGINS en producción', () => {
    expect(() => validateEnv({ ...prod, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
    expect(() => validateEnv(prod)).not.toThrow();
  });

  it('exige IP_HASH_SECRET en producción', () => {
    expect(() => validateEnv({ ...prod, IP_HASH_SECRET: undefined })).toThrow(/IP_HASH_SECRET/);
  });

  it('IP_HASH_SECRET es opcional fuera de producción, y vacío cuenta como ausente', () => {
    expect(validateEnv(base).IP_HASH_SECRET).toBeUndefined();
    expect(validateEnv({ ...base, IP_HASH_SECRET: '' }).IP_HASH_SECRET).toBeUndefined();
  });

  it('rechaza un secreto corto sin mostrarlo en el mensaje de error', () => {
    let message = '';
    try {
      validateEnv({ ...base, IP_HASH_SECRET: 'abc-secreto' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/IP_HASH_SECRET/);
    expect(message).not.toContain('abc-secreto');
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

  it('exige TURNSTILE_SECRET_KEY en producción y es opcional fuera de ella', () => {
    expect(() => validateEnv({ ...prod, TURNSTILE_SECRET_KEY: undefined })).toThrow(
      /TURNSTILE_SECRET_KEY/,
    );
    expect(validateEnv(base).TURNSTILE_SECRET_KEY).toBeUndefined();
  });
});

describe('variables del worker', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

  it('traen valores por defecto coherentes entre sí', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({
      LLM_MODEL: 'moonshotai/kimi-k3', LLM_TIMEOUT_MS: 120000, JOB_TIMEOUT_MS: 150000,
      JOB_LEASE_SECONDS: 210, WORKER_CONCURRENCY: 2,
    });
    expect(env.NVIDIA_API_KEY).toBeUndefined();
  });

  it('una clave vacía cuenta como ausente', () => {
    expect(validateEnv({ ...base, NVIDIA_API_KEY: '' }).NVIDIA_API_KEY).toBeUndefined();
  });

  it('rechaza un tiempo de trabajo menor que el del modelo', () => {
    expect(() => validateEnv({ ...base, LLM_TIMEOUT_MS: '200000' })).toThrow(/JOB_TIMEOUT_MS/);
  });

  it('rechaza un lease que no cubre el tiempo del trabajo', () => {
    expect(() => validateEnv({ ...base, JOB_LEASE_SECONDS: '100' })).toThrow(/JOB_LEASE_SECONDS/);
  });
});