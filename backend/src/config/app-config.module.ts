import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

/** Configuración global, validada al arrancar. Se lee con ConfigService<Env, true>. */
export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: validateEnv,
});