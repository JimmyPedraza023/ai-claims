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

// Una línea vacía en .env cuenta como ausente.
// Acepta cualquier esquema de Zod (z.url() y z.email() no son ZodString en Zod 4).
const optionalStr = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

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

    IP_HASH_SECRET: optionalStr(z.string().min(16, 'debe tener al menos 16 caracteres')),

    // Clave secreta de Cloudflare Turnstile (captcha). Sin ella, la verificación se desactiva.
    TURNSTILE_SECRET_KEY: optionalStr(z.string().min(1)),

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
    NVIDIA_API_KEY: optionalStr(z.string().min(1)),
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
    LLM_TEXT_MODEL: optionalStr(z.string().min(1)),

    // --- Correo (SMTP) y avisos ---
    SMTP_HOST: optionalStr(z.string().min(1)),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: bool, // true para el puerto 465
    SMTP_USER: optionalStr(z.string().min(1)),
    SMTP_PASS: optionalStr(z.string().min(1)),
    MAIL_FROM: optionalStr(z.string().min(3)),
    FRONTEND_URL: optionalStr(z.url()), // base del enlace de seguimiento
    ANALYST_ALERT_EMAIL: optionalStr(z.email()),

    // --- Vigilancia del reloj ---
    CLOCK_WATCH_SECRET: optionalStr(z.string().min(32, 'debe tener al menos 32 caracteres')),
    CLOCK_WATCH_PING_URL: optionalStr(z.url()),

    JWT_SECRET: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(32, 'debe tener al menos 32 caracteres').optional(),
    ),

    JWT_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.CORS_ORIGINS.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'es obligatoria en producción',
        });
      }
      for (const key of [
        'IP_HASH_SECRET',
        'TURNSTILE_SECRET_KEY',
        'SMTP_HOST',
        'MAIL_FROM',
        'FRONTEND_URL',
        'ANALYST_ALERT_EMAIL',
        'CLOCK_WATCH_SECRET',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'es obligatoria en producción' });
        }
      }
    }
    if (env.SMTP_USER && !env.SMTP_PASS) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_PASS'],
        message: 'es obligatoria si se define SMTP_USER',
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