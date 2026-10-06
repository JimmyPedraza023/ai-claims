// backend/test/integration/intake.throttle.integration.spec.ts
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { IntakeController } from '../../src/modules/intake/intake.controller';
import { IntakeService } from '../../src/modules/intake/intake.service';
import { THROTTLE_MESSAGE } from '../../src/modules/intake/intake.throttle';
import { TRACKING_LINK_SENDER } from '../../src/modules/intake/tracking-link-sender';
import { ConfigService } from '@nestjs/config';
import { TurnstileService } from '../../src/modules/intake/turnstile.service';

describe('Límite de peticiones en POST /intake', () => {
  let app: INestApplication;
  const receive = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // Límite bajo (3) para poder probarlo sin mandar decenas de peticiones.
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'short', ttl: 60_000, limit: 3 }],
          errorMessage: THROTTLE_MESSAGE,
        }),
      ],
      controllers: [IntakeController],
      providers: [
        { provide: IntakeService, useValue: { receive } },
        { provide: TRACKING_LINK_SENDER, useValue: { send: jest.fn() } },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: TurnstileService, useValue: { enabled: false } },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('pasado el límite responde 429 con un mensaje claro, sin llegar a la radicación', async () => {
    const post = () => request(app.getHttpServer()).post('/intake');

    // Formularios vacíos: el guard igual los cuenta (los intentos fallidos también son abuso).
    for (let i = 0; i < 3; i++) {
      expect((await post()).status).toBe(400);
    }

    const blocked = await post();
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toBe(THROTTLE_MESSAGE);
    expect(receive).not.toHaveBeenCalled();
  });
});