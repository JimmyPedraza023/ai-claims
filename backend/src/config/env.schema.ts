import { z } from 'zod';

/**
 * Variables de entorno de la aplicación, validadas al arrancar.
 * Si falta o es inválida alguna, el proceso no levanta (falla rápido y con
 * un mensaje claro) en vez de fallar horas después en mitad de una petición.
 *
 * Solo se declaran las variables que el código usa HOY. Cada módulo nuevo
 * (auth, LLM, correo...) agrega las suyas.
 */
const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // Conexión de la API. En Supabase puede ser el pooler en modo transaction (6543).
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'debe empezar con postgres:// o postgresql://'),
    DATABASE_SSL: bool,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    // Carpeta del almacenamiento local de archivos (en la nube se reemplaza por Supabase Storage).
    STORAGE_DIR: z.string().min(1).default('./data/uploads'),

    IP_HASH_SECRET: z.preprocess(
      (v) => (v === '' ? undefined : v), // una línea vacía en .env cuenta como ausente
      z.string().min(16, 'debe tener al menos 16 caracteres').optional(),
    ),

    // Orígenes permitidos para CORS, separados por coma.
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'es obligatoria en producción',
      });
    }
    if (env.NODE_ENV === 'production' && !env.IP_HASH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['IP_HASH_SECRET'],
        message: 'es obligatoria en producción',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Valida el entorno. En el mensaje de error solo aparecen el nombre de la
 * variable y el motivo, nunca su valor (puede ser un secreto).
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const detalle = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(general)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${detalle}`);
  }
  return result.data;
}