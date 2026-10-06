// backend/test/integration/turnstile.integration.spec.ts
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import type { Env } from '../../src/config/env.schema';
import { IntakeController } from '../../src/modules/intake/intake.controller';
import { IntakeService } from '../../src/modules/intake/intake.service';
import { TRACKING_LINK_SENDER } from '../../src/modules/intake/tracking-link-sender';
import { CAPTCHA_MESSAGE } from '../../src/modules/intake/turnstile.guard';
import { TurnstileService } from '../../src/modules/intake/turnstile.service';

const reply = (body: unknown, status = 200) => async () =>
  new Response(JSON.stringify(body), { status });

function serviceWith(secret: string | undefined): TurnstileService {
  const config = { get: () => secret } as unknown as ConfigService<Env, true>;
  return new TurnstileService(config);
}

describe('TurnstileService', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('manda la clave, el token y la IP a Cloudflare y acepta un token válido', async () => {
    fetchSpy.mockImplementation(reply({ success: true }));

    expect(await serviceWith('clave').verify('TOKEN', '190.25.10.7')).toBe('passed');

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = init.body as URLSearchParams;
    expect(body.get('secret')).toBe('clave');
    expect(body.get('response')).toBe('TOKEN');
    expect(body.get('remoteip')).toBe('190.25.10.7');
  });

  it.each(['invalid-input-response', 'timeout-or-duplicate', 'missing-input-response'])(
    'rechaza el token si Cloudflare responde %s',
    async (code) => {
      fetchSpy.mockImplementation(reply({ success: false, 'error-codes': [code] }));
      expect(await serviceWith('clave').verify('TOKEN')).toBe('rejected');
    },
  );

  it('si la clave secreta está mal configurada es un fallo nuestro, no del usuario: unavailable', async () => {
    fetchSpy.mockImplementation(reply({ success: false, 'error-codes': ['invalid-input-secret'] }));
    expect(await serviceWith('clave').verify('TOKEN')).toBe('unavailable');
  });

  it('si Cloudflare no responde (error de red, HTTP 500 o respuesta ilegible): unavailable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('sin red'));
    expect(await serviceWith('clave').verify('TOKEN')).toBe('unavailable');

    fetchSpy.mockImplementationOnce(reply({}, 500));
    expect(await serviceWith('clave').verify('TOKEN')).toBe('unavailable');

    fetchSpy.mockImplementationOnce(async () => new Response('no es json', { status: 200 }));
    expect(await serviceWith('clave').verify('TOKEN')).toBe('unavailable');
  });

  it('sin clave secreta está desactivado y no llama a Cloudflare', async () => {
    const service = serviceWith(undefined);
    expect(service.enabled).toBe(false);
    expect(await service.verify('TOKEN')).toBe('passed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('TurnstileGuard en POST /intake', () => {
  let app: INestApplication;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  async function buildApp(secret: string | undefined): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'short', ttl: 60_000, limit: 1000 }] })],
      controllers: [IntakeController],
      providers: [
        { provide: IntakeService, useValue: { receive: jest.fn() } },
        { provide: TRACKING_LINK_SENDER, useValue: { send: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => secret } },
        TurnstileService,
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  }

  // Un formulario vacío: si el guard deja pasar, el controlador responde 400 (datos inválidos);
  // si el guard bloquea, responde 403. Así se distingue quién cortó la petición.
  const post = (token?: string) => {
    const req = request(app.getHttpServer()).post('/intake');
    return token ? req.set('x-turnstile-token', token) : req;
  };

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('sin token: 403 y ni siquiera se consulta a Cloudflare', async () => {
    await buildApp('clave');
    const res = await post();
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(CAPTCHA_MESSAGE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('token rechazado por Cloudflare: 403', async () => {
    await buildApp('clave');
    fetchSpy.mockImplementation(reply({ success: false, 'error-codes': ['invalid-input-response'] }));
    expect((await post('TOKEN-FALSO')).status).toBe(403);
  });

  it('token válido: pasa el guard y llega al formulario (400 por estar vacío)', async () => {
    await buildApp('clave');
    fetchSpy.mockImplementation(reply({ success: true }));
    expect((await post('TOKEN')).status).toBe(400);
  });

  it('Cloudflare caído: se deja pasar (decisión de diseño) y el error queda en el log', async () => {
    await buildApp('clave');
    fetchSpy.mockRejectedValue(new Error('sin red'));
    expect((await post('TOKEN')).status).toBe(400);
  });

  it('con el captcha desactivado (sin clave) no se exige token', async () => {
    await buildApp(undefined);
    expect((await post()).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});