import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, request } from '@/shared/api/client';
import Field from '@/shared/ui/Field';
import { inputClass as input } from '@/shared/ui/classes';
import { getToken, setToken, setUser, type SessionUser } from './session';

// SUPUESTO 1: el login responde { accessToken }. Si tu AuthService devuelve otro nombre, cámbialo aquí.
interface LoginResponse {
  accessToken: string;
  expiresInSeconds: number;
  user: SessionUser;
}

function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return 'Revisa el correo y la contraseña.';
    if (err.status === 401) return 'Correo o contraseña incorrectos.';
    return err.message; // incluye el 429 de demasiados intentos
  }
  return 'Algo salió mal de nuestro lado. Inténtalo de nuevo en unos minutos.';
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (getToken()) return <Navigate to="/panel" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;

    setSending(true);
    setError(null);
    try {
      const res = await request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      if (!res.accessToken) throw new Error('La respuesta no trae token');
      setToken(res.accessToken);
      setUser(res.user);
      navigate('/panel', { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold text-stone-900">Panel del analista</h1>
      <p className="mt-1 text-sm text-stone-600">Uso interno de Global Seguros de Vida.</p>

      {params.get('expired') && !error && (
        <p role="status" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Tu sesión terminó. Inicia sesión de nuevo.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <Field label="Correo">
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={input}
          />
        </Field>
        <Field label="Contraseña">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
          />
        </Field>
        <button
          type="submit"
          disabled={sending || !email || !password}
          className="w-full rounded-md bg-teal-800 px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {sending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}