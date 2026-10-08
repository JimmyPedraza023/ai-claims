const TOKEN_KEY = 'panel-token';
const USER_KEY = 'panel-user';

export interface SessionUser {
  id: string;
  fullName: string;
  role: string;
}

// sessionStorage: la sesión se pierde al cerrar la pestaña, lo deseable en una vista interna.
function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento disponible: la sesión no se podrá mantener */
  }
}

export function getToken(): string | null {
  return read(TOKEN_KEY);
}

export function setToken(token: string): void {
  write(TOKEN_KEY, token);
}

export function getUser(): SessionUser | null {
  const raw = read(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function setUser(user: SessionUser): void {
  write(USER_KEY, JSON.stringify(user));
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch {
    /* nada que limpiar */
  }
}