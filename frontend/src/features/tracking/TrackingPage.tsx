import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, request } from '@/shared/api/client';
import FilePicker from '@/shared/ui/FilePicker';
import type { ChecklistState, TrackingView, UploadResponse } from './types';

const POLL_MS = 30_000;
const GENERIC_ERROR = 'Algo salió mal de nuestro lado. Inténtalo de nuevo en unos minutos.';
const INVALID_LINK =
  'Este enlace no es válido o está incompleto. Abre de nuevo el enlace del correo y asegúrate de usarlo completo.';

// El token viaja en el fragmento (#...), que el navegador no envía a ningún servidor.
function readToken(): string {
  return window.location.hash.replace(/^#/, '').trim();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });
}

function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.status === 404 ? INVALID_LINK : err.message;
  return GENERIC_ERROR;
}

// Cada estado se dice con texto e ícono, no solo con color.
const STATE_UI: Record<ChecklistState, { label: string; icon: string; className: string }> = {
  listo: { label: 'Recibido', icon: '✓', className: 'bg-teal-100 text-teal-900' },
  revisando: { label: 'Lo estamos revisando', icon: '…', className: 'bg-stone-200 text-stone-800' },
  falta: { label: 'Falta', icon: '!', className: 'bg-amber-100 text-amber-900' },
  no_sirve: { label: 'Necesitamos uno nuevo', icon: '×', className: 'bg-red-100 text-red-900' },
};

export default function TrackingPage() {
  const [token] = useState(readToken);
  const [view, setView] = useState<TrackingView | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [loadError, setLoadError] = useState<string | null>(token ? null : INVALID_LINK);

  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOk, setUploadOk] = useState<string | null>(null);
  // Una llave por tanda de documentos: se reutiliza en los reintentos y se renueva tras un éxito.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await request<TrackingView>('/tracking', {
          headers: { 'x-tracking-token': token },
          signal,
        });
        setView(data);
        setLoadError(null);
      } catch (err) {
        if (signal?.aborted) return;
        setLoadError(loadErrorMessage(err));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();

    const run = async () => {
      await load(controller.signal);
    };

    void run();

    return () => controller.abort();
  }, [token, load]);

  // Mientras algo esté en revisión, la página se actualiza sola.
  const underReview =
    view?.stage === 'revisando' || Boolean(view?.checklist.some((i) => i.state === 'revisando'));

  useEffect(() => {
    if (!underReview) return;
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [underReview, load]);

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending || files.length === 0) return;

    setSending(true);
    setUploadError(null);
    setUploadOk(null);

    const body = new FormData();
    body.append('idempotencyKey', idempotencyKey);
    files.forEach((f) => body.append('files', f));

    try {
      const res = await request<UploadResponse>('/tracking/documents', {
        method: 'POST',
        body,
        headers: { 'x-tracking-token': token },
      });
      setView(res.tracking);
      setUploadOk(res.message);
      setFiles([]);
      setIdempotencyKey(crypto.randomUUID());
    } catch (err) {
      if (err instanceof ApiError) {
        setUploadError(err.fieldErrors[0]?.message ?? err.message);
        if (err.status === 409) void load(); // el caso cambió de etapa: refrescar lo que se ve
      } else {
        setUploadError(GENERIC_ERROR);
      }
    } finally {
      setSending(false);
    }
  }

  if (!view) {
    if (loading) {
      return (
        <p role="status" className="text-stone-700">
          Cargando tu reclamación…
        </p>
      );
    }
    return (
      <section className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold text-stone-900">No pudimos abrir tu seguimiento</h1>
        <p role="alert" className="mt-3 text-stone-700">
          {loadError}
        </p>
        {token && (
          <button
            onClick={() => {
              setLoading(true);
              setLoadError(null);
              void load();
            }}
            className="mt-4 text-teal-800 underline underline-offset-4"
          >
            Intentar de nuevo
          </button>
        )}
      </section>
    );
  }

  const canUpload = view.stage === 'faltan_documentos' || view.stage === 'revisando';

  return (
    <section className="mx-auto max-w-xl">
      <p className="text-sm text-stone-600">
        Reclamación {view.referenceCode} · recibida el {formatDate(view.receivedAt)}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-stone-900">{view.headline}</h1>
      <p className="mt-2 text-sm text-stone-600">Documentos recibidos hasta ahora: {view.documentsReceived}</p>

      {loadError && (
        <p role="alert" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          No pudimos actualizar la información. Lo que ves puede no ser lo más reciente.
        </p>
      )}

      {view.checklist.length > 0 ? (
        <div className="mt-6">
          <h2 className="font-medium text-stone-900">Documentos de tu reclamación</h2>
          <ul className="mt-3 space-y-3">
            {view.checklist.map((item) => {
              const ui = STATE_UI[item.state];
              return (
                <li key={item.documentType} className="rounded-md border border-stone-300 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-stone-900">{item.label}</span>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${ui.className}`}
                    >
                      <span aria-hidden="true">{ui.icon}</span>
                      {ui.label}
                    </span>
                  </div>
                  {item.message && <p className="mt-2 text-sm text-stone-700">{item.message}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        view.stage === 'revisando' && (
          <p className="mt-6 text-stone-700">
            Estamos revisando lo que nos enviaste para saber qué documentos necesitamos. Te lo mostraremos aquí.
          </p>
        )
      )}

      {underReview && (
        <p className="mt-4 text-sm text-stone-600">Esta página se actualiza sola cada medio minuto.</p>
      )}

      {canUpload && (
        <form onSubmit={onUpload} noValidate className="mt-8 space-y-4 border-t border-stone-300 pt-6">
          <h2 className="text-lg font-semibold text-stone-900">Subir documentos</h2>

          {uploadOk && (
            <p role="status" className="rounded-md border border-teal-300 bg-teal-50 p-3 text-teal-900">
              {uploadOk}
            </p>
          )}
          {uploadError && (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
              {uploadError}
            </p>
          )}

          <FilePicker files={files} onChange={setFiles} buttonLabel="Elegir documentos" />

          <button
            type="submit"
            disabled={sending || files.length === 0}
            className="w-full rounded-md bg-teal-800 px-4 py-3 font-medium text-white disabled:opacity-50"
          >
            {sending ? 'Enviando…' : 'Enviar documentos'}
          </button>
          {sending && (
            <p aria-live="polite" className="text-sm text-stone-600">
              No cierres esta página mientras enviamos tus documentos.
            </p>
          )}
        </form>
      )}
    </section>
  );
}