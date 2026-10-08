import { useState, type FormEvent } from 'react';
import { ApiError } from '@/shared/api/client';
import Field from '@/shared/ui/Field';
import { inputClass as input } from '@/shared/ui/classes';
import {
  DECISION_OPTIONS,
  DOCUMENT_LABELS,
  REQUESTABLE_DOCUMENTS,
  type DecisionKind,
} from './domain';
import { panelRequest } from './panelApi';
import { getUser } from './session';

interface DecisionFormProps {
  claimId: string;
  /** Se llama cuando la decisión quedó registrada, para que el detalle se vuelva a cargar. */
  onDone: () => void;
}

const MIN_REASON = 10;
const GENERIC_ERROR = 'Algo salió mal de nuestro lado. Inténtalo de nuevo en unos minutos.';

export default function DecisionForm({ claimId, onDone }: DecisionFormProps) {
  const user = getUser();
  const [kind, setKind] = useState<DecisionKind | null>(null);
  const [reason, setReason] = useState('');
  const [requested, setRequested] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);

  const option = DECISION_OPTIONS.find((o) => o.value === kind);

  function toggleDocument(doc: string) {
    setRequested((prev) => {
      const next = prev.includes(doc) ? prev.filter((d) => d !== doc) : [...prev, doc];
      // Se conserva el orden de la lista, no el orden de los clics.
      return REQUESTABLE_DOCUMENTS.filter((d) => next.includes(d));
    });
    setErrors((p) => ({ ...p, requestedDocuments: '' }));
  }

  // Revisión rápida antes de pedir la confirmación. El servidor valida de nuevo.
  function onReview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!kind) next.kind = 'Elige qué vas a decidir.';
    if (reason.trim().length < MIN_REASON) next.reason = `Explica el motivo (mínimo ${MIN_REASON} caracteres).`;
    if (kind === 'pedir_documentos' && requested.length === 0) {
      next.requestedDocuments = 'Elige al menos un documento.';
    }
    setErrors(next);
    setBanner(null);
    if (Object.keys(next).length === 0) setConfirming(true);
  }

  async function onConfirm() {
    if (sending || !kind) return;
    setSending(true);
    setBanner(null);
    try {
      await panelRequest(`/panel/claims/${claimId}/decisions`, {
        method: 'POST',
        body: {
          kind,
          reason: reason.trim(),
          ...(kind === 'pedir_documentos' ? { requestedDocuments: requested } : {}),
        },
      });
      onDone();
    } catch (err) {
      setConfirming(false);
      if (err instanceof ApiError) {
        if (err.fieldErrors.length) {
          // Un error en "requestedDocuments.0" se muestra bajo "requestedDocuments".
          setErrors(Object.fromEntries(err.fieldErrors.map((x) => [x.field.split('.')[0], x.message])));
        }
        setBanner(err.message);
      } else {
        setBanner(GENERIC_ERROR);
      }
    } finally {
      setSending(false);
    }
  }

  if (confirming && option) {
    return (
      <div className="rounded-md border border-stone-400 bg-white p-4">
        <h2 className="text-lg font-semibold text-stone-900">Confirma la decisión</h2>
        <dl className="mt-3 space-y-2 text-sm text-stone-800">
          <div>
            <dt className="font-medium">Decisión</dt>
            <dd>{option.label}</dd>
          </div>
          {kind === 'pedir_documentos' && (
            <div>
              <dt className="font-medium">Documentos que se piden</dt>
              <dd>{requested.map((d) => DOCUMENT_LABELS[d] ?? d).join(', ')}</dd>
            </div>
          )}
          <div>
            <dt className="font-medium">Motivo</dt>
            <dd className="whitespace-pre-wrap">{reason.trim()}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-stone-700">
          Esta decisión queda registrada a nombre de <strong>{user?.fullName ?? 'tu usuario'}</strong> en el historial del caso y no se puede editar.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={onConfirm}
            disabled={sending}
            className="rounded-md bg-teal-800 px-4 py-3 font-medium text-white disabled:opacity-50"
          >
            {sending ? 'Registrando…' : 'Confirmar y registrar'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={sending}
            className="rounded-md border border-stone-400 px-4 py-3 text-stone-800 disabled:opacity-50"
          >
            Volver a editar
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onReview} noValidate className="space-y-5 rounded-md border border-stone-300 bg-white p-4">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">Registrar decisión</h2>
        <p className="mt-1 text-sm text-stone-600">
          El sistema clasifica y sugiere; la decisión es tuya. Aquí no se registra el valor de la indemnización.
        </p>
      </div>

      {banner && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {banner}
        </p>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-stone-900">Decisión</legend>
        {DECISION_OPTIONS.map((o) => (
          <label key={o.value} className="flex items-start gap-3 rounded-md border border-stone-300 p-3">
            <input
              type="radio"
              name="kind"
              value={o.value}
              checked={kind === o.value}
              onChange={() => {
                setKind(o.value);
                setErrors((p) => ({ ...p, kind: '' }));
              }}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="block font-medium text-stone-900">{o.label}</span>
              <span className="block text-sm text-stone-600">{o.description}</span>
            </span>
          </label>
        ))}
        {errors.kind && (
          <p role="alert" className="text-sm text-red-800">
            {errors.kind}
          </p>
        )}
      </fieldset>

      {kind === 'pedir_documentos' && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-stone-900">Documentos que se piden</legend>
          {REQUESTABLE_DOCUMENTS.map((doc) => (
            <label key={doc} className="flex items-center gap-3 text-sm text-stone-800">
              <input
                type="checkbox"
                checked={requested.includes(doc)}
                onChange={() => toggleDocument(doc)}
                className="h-5 w-5"
              />
              {DOCUMENT_LABELS[doc]}
            </label>
          ))}
          {errors.requestedDocuments && (
            <p role="alert" className="text-sm text-red-800">
              {errors.requestedDocuments}
            </p>
          )}
        </fieldset>
      )}

      <Field label="Motivo" hint={`Obligatorio, mínimo ${MIN_REASON} caracteres. Queda en el historial del caso.`} error={errors.reason}>
        <textarea
          rows={4}
          maxLength={2000}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setErrors((p) => ({ ...p, reason: '' }));
          }}
          className={input}
        />
      </Field>

      <button type="submit" className="w-full rounded-md bg-teal-800 px-4 py-3 font-medium text-white sm:w-auto">
        Revisar y confirmar
      </button>
    </form>
  );
}