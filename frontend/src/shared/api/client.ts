const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

export interface FieldError {
  field: string;
  message: string;
}

/** Error normalizado: la UI decide qué mostrar según `status` y `fieldErrors`. */
export class ApiError extends Error {
  public readonly status: number;
  public readonly fieldErrors: FieldError[];

  constructor(
    status: number,
    message: string,
    fieldErrors: FieldError[] = [],
  ) {
    super(message);

    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

const FALLBACK_MESSAGES: Record<number, string> = {
  0: 'No pudimos conectarnos. Revisa tu internet e inténtalo de nuevo; tus datos siguen aquí.',
  403: 'No pudimos verificar que eres una persona. Inténtalo de nuevo.',
  404: 'No encontramos lo que buscas.',
  409: 'Esta acción ya no está disponible para esta reclamación.',
  413: 'Uno de los archivos es demasiado grande. El máximo es 10 MB por archivo.',
  415: 'Uno de los archivos no es válido. Usa PDF, JPG, PNG o WebP.',
  429: 'Has hecho muchos intentos seguidos. Espera un momento e inténtalo otra vez.',
  400: 'Revisa los datos del formulario e inténtalo de nuevo.',
};

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: FormData | Record<string, unknown>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = opts;
  const isForm = body instanceof FormData;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      signal,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, FALLBACK_MESSAGES[0]);
  }

  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;

  // El backend devuelve `errors: [{field, message}]` en 400 y `message` en 429.
  const fieldErrors: FieldError[] = Array.isArray(data?.errors) ? data.errors : [];
  const message =
    (res.status === 429 && typeof data?.message === 'string' && data.message) ||
    FALLBACK_MESSAGES[res.status] ||
    'Algo salió mal de nuestro lado. Inténtalo de nuevo en unos minutos.';
  throw new ApiError(res.status, message, fieldErrors);
}