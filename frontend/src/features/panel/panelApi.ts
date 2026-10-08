import { ApiError, request, requestBlob } from '@/shared/api/client';
import { clearToken, getToken } from './session';

interface PanelRequestOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}

// SUPUESTO 2: el guard del backend espera "Authorization: Bearer <token>".
function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Un 401 en cualquier llamada del panel es una sesión vencida o inválida: se limpia y se vuelve al login.
function onUnauthorized(err: unknown): never {
  if (err instanceof ApiError && err.status === 401) {
    clearToken();
    window.location.assign('/panel/login?expired=1');
  }
  throw err;
}

export async function panelRequest<T>(path: string, opts: PanelRequestOptions = {}): Promise<T> {
  try {
    return await request<T>(path, { ...opts, headers: authHeaders() });
  } catch (err) {
    return onUnauthorized(err);
  }
}

/** Para los archivos de los documentos: un enlace directo no manda la cabecera de sesión. */
export async function panelBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  try {
    return await requestBlob(path, { headers: authHeaders(), signal });
  } catch (err) {
    return onUnauthorized(err);
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiError
    ? err.message
    : 'Algo salió mal de nuestro lado. Inténtalo de nuevo en unos minutos.';
}