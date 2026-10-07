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

    // Clave secreta de Cloudflare Turnstile (captcha). Sin ella, la verificación se desactiva. 
    TURNSTILE_SECRET_KEY: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(1).optional(),
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
    
    // --- Modelo de IA y worker (solo los usa el proceso del worker) ---
    NVIDIA_API_KEY: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(1).optional(),
    ),
    LLM_MODEL: z.string().min(1).default('moonshotai/kimi-k3'),
    // El endpoint gratuito tarda ~50 s por llamada.
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),
    // Margen para el razonamiento: con un tope bajo la respuesta puede salir cortada.
    LLM_MAX_TOKENS: z.coerce.number().int().min(256).max(16_000).default(3000),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
    WORKER_POLL_MS: z.coerce.number().int().min(100).default(2000),
    // Un trabajo incluye preparar el documento + la llamada al modelo + guardar.
    JOB_TIMEOUT_MS: z.coerce.number().int().min(1000).default(150_000),
    // Debe superar JOB_TIMEOUT_MS: si no, otro worker tomaría un trabajo aún en curso.
    JOB_LEASE_SECONDS: z.coerce.number().int().min(10).default(210),

    // Modelo para tareas de solo texto (clasificar). Si no se define, se usa LLM_MODEL.
    LLM_TEXT_MODEL: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
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
    if (env.NODE_ENV === 'production' && !env.TURNSTILE_SECRET_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['TURNSTILE_SECRET_KEY'],
        message: 'es obligatoria en producción',
      });
    }
    if (env.JOB_TIMEOUT_MS <= env.LLM_TIMEOUT_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['JOB_TIMEOUT_MS'],
        message: 'debe ser mayor que LLM_TIMEOUT_MS (el trabajo incluye preparar el documento)',
      });
    }
    if (env.JOB_LEASE_SECONDS * 1000 <= env.JOB_TIMEOUT_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['JOB_LEASE_SECONDS'],
        message: 'debe superar JOB_TIMEOUT_MS: si no, otro worker tomaría un trabajo aún en curso',
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