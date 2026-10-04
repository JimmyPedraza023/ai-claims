import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { Env } from '../../config/env.schema';

/**
 * Logs estructurados (JSON en producción, legibles en desarrollo).
 * - Cada petición recibe un id propio (nunca se confía en uno enviado por el
 *   cliente) y se devuelve en el header x-request-id para poder rastrearla.
 * - Se redactan credenciales. Los cuerpos de las peticiones NO se registran:
 *   contienen datos personales de los beneficiarios.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isDev = config.get('NODE_ENV', { infer: true }) === 'development';
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            transport: isDev ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
            genReqId: (_req, res) => {
              const id = randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
              censor: '[REDACTED]',
            },
            // Los chequeos de salud se hacen cada pocos segundos: sin ruido en los logs.
            autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
            serializers: {
              req: (req) => ({ id: req.id, method: req.method, url: req.url }),
              res: (res) => ({ statusCode: res.statusCode }),
            },
          },
        };
      },
    }),
  ],
})
export class AppLoggerModule {}