import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { PanelModule } from '../../src/modules/panel/panel.module';

describe('Panel auth', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, PanelModule],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    }).compile();

    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const ID = '00000000-0000-4000-8000-000000000001';
  const routes: Array<['get' | 'post', string]> = [
    ['get', '/panel/claims'],
    ['get', '/panel/review-queue'],
    ['get', `/panel/claims/${ID}`],
    ['get', `/panel/claims/${ID}/documents/${ID}/file`],
    ['post', `/panel/claims/${ID}/decisions`],
    ['post', `/panel/claims/${ID}/corrections/claim-type`],
    ['post', `/panel/claims/${ID}/documents/${ID}/corrections`],
    ['get', '/panel/metrics/clock'],
    ['get', '/panel/metrics/model-corrections'],
    ['get', '/panel/metrics/first-response'],
    ['get', '/panel/metrics/random-timeline'],
  ];

  it.each(routes)('%s %s sin token responde 401', async (method, path) => {
    await request(app.getHttpServer())[method](path).expect(401);
  });
});
