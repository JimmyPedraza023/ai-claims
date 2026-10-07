import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker/worker.module';
import { WorkerService } from './worker/worker.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Apagado ordenado: al recibir la señal se deja de tomar trabajo y se espera a los que están en curso.
  // Si el proceso muere antes, el lease de cada trabajo vence y otro worker lo retoma.
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    await app.get(WorkerService).run(controller.signal);
  } finally {
    await app.close(); // cierra el pool de la base de datos
  }
}

bootstrap().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});