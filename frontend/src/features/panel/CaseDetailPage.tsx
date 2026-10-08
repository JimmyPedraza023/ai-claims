import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import ClockBadge from './ClockBadge';
import DecisionForm from './DecisionForm';
import { CLAIM_TYPE_LABELS, DECISION_OPTIONS, DOCUMENT_LABELS, ISSUE_LABELS } from './domain';
import { clockLine, formatDateTime, formatDeadline } from './format';
import {
  ACTOR_LABELS,
  CLAIM_STATUS_LABELS,
  DOCUMENT_STATUS_LABELS,
  EVENT_LABELS,
  REQUIREMENT_STATUS_LABELS,
  SUBJECT_LABELS,
  TASK_LABELS,
  labelOf,
} from './labels';
import { errorMessage, panelBlob, panelRequest } from './panelApi';
import type { CaseDetail, Classification, DocumentDetail } from './types';

const REQUIREMENT_CLASS: Record<string, string> = {
  valido: 'bg-teal-100 text-teal-900',
  en_revision: 'bg-stone-200 text-stone-800',
  invalido: 'bg-red-100 text-red-900',
  faltante: 'bg-amber-100 text-amber-900',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-stone-300 bg-white p-4">
      <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm text-teal-800">{label}</summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded bg-stone-100 p-2 text-xs text-stone-800">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') {
    return CLAIM_TYPE_LABELS[v] ?? DOCUMENT_LABELS[v] ?? DOCUMENT_STATUS_LABELS[v] ?? v;
  }
  return JSON.stringify(v);
}

function percent(c: number | string | null): string {
  const n = Number(c);
  return c === null || !Number.isFinite(n) ? '—' : `${Math.round(n * 100)} %`;
}

function text(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v ? v : null;
}

function requirementsOf(result: unknown) {
  const reqs = (result as { requirements?: unknown } | null)?.requirements;
  return Array.isArray(reqs)
    ? (reqs as { documentType: string; status: string; issue?: string | null }[])
    : [];
}

export default function CaseDetailPage() {
  const { claimId = '' } = useParams();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await panelRequest<CaseDetail>(`/panel/claims/${claimId}`, { signal });
        setDetail(res);
        setError(null);
      } catch (err) {
        if (!signal?.aborted) setError(errorMessage(err));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [claimId],
  );

  useEffect(() => {
    const controller = new AbortController();

    const timeoutId = window.setTimeout(() => {
        void load(controller.signal);
    }, 0);

    return () => {
        window.clearTimeout(timeoutId);
        controller.abort();
    };
    }, [load]);

  // El archivo está protegido: se pide con la cabecera de sesión y se abre desde memoria.
  async function openFile(doc: DocumentDetail) {
    setFileError(null);
    const tab = window.open('', '_blank'); // se abre al hacer clic para que el navegador no la bloquee
    if (!tab) {
      setFileError('Tu navegador bloqueó la ventana nueva. Permite las ventanas emergentes para este sitio.');
      return;
    }
    tab.opener = null;
    try {
      const blob = await panelBlob(`/panel/claims/${claimId}/documents/${doc.id}/file`);
      const url = URL.createObjectURL(blob);
      tab.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab.close();
      setFileError(errorMessage(err));
    }
  }

  if (!detail) {
    return (
      <section>
        <Link to="/panel" className="text-sm text-teal-800 underline underline-offset-4">
          ← Casos
        </Link>
        {loading ? (
          <p role="status" className="mt-4 text-stone-700">
            Cargando el caso…
          </p>
        ) : (
          <>
            <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
              {error ?? 'No pudimos abrir el caso.'}
            </p>
            <button
              onClick={() => {
                setLoading(true);
                void load();
              }}
              className="mt-3 text-teal-800 underline underline-offset-4"
            >
              Intentar de nuevo
            </button>
          </>
        )}
      </section>
    );
  }

  const { claim, clock, documents, evaluation, classifications, aiRuns, decisions, timeline } = detail;
  const closed = claim.status === 'pagada' || claim.status === 'objetada';
  const canDecide = claim.status === 'completa';
  const docName = (id: string | null) => documents.find((d) => d.id === id)?.originalFilename;

  const optional: [string, string | null][] = [
    ['Beneficiario', text(claim, 'beneficiaryFullName')],
    ['Asegurado', text(claim, 'insuredFullName')],
  ];

  return (
    <div className="space-y-5">
      <div>
        <Link to="/panel" className="text-sm text-teal-800 underline underline-offset-4">
          ← Casos
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-stone-900">{claim.referenceCode}</h1>
          <ClockBadge clock={clock} />
        </div>
        <p className="mt-1 text-sm text-stone-600">{closed ? 'Caso cerrado.' : clockLine(clock)}</p>
      </div>

      {notice && (
        <p role="status" className="rounded-md border border-teal-300 bg-teal-50 p-3 text-teal-900">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          No pudimos actualizar el caso: {error}
        </p>
      )}

      <Section title="Resumen">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium text-stone-900">Tipo de reclamación</dt>
            <dd>{claim.claimType ? labelOf(CLAIM_TYPE_LABELS, claim.claimType) : 'Sin determinar'}</dd>
          </div>
          <div>
            <dt className="font-medium text-stone-900">Estado</dt>
            <dd>{labelOf(CLAIM_STATUS_LABELS, claim.status)}</dd>
          </div>
          <div>
            <dt className="font-medium text-stone-900">Recibido</dt>
            <dd>{formatDateTime(claim.receivedAt)}</dd>
          </div>
          <div>
            <dt className="font-medium text-stone-900">Fecha límite</dt>
            <dd>{formatDeadline(clock?.deadlineDate ?? null)}</dd>
          </div>
          {optional.map(([label, value]) =>
            value ? (
              <div key={label}>
                <dt className="font-medium text-stone-900">{label}</dt>
                <dd>{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
        {text(claim, 'narrative') && (
          <div className="mt-4">
            <p className="text-sm font-medium text-stone-900">Relato del beneficiario</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-stone-800">{text(claim, 'narrative')}</p>
          </div>
        )}
      </Section>

      <Section title="Qué determinó el sistema">
        <p className="text-sm text-stone-600">
          Esto es lo que el sistema concluyó y con qué información. No decide por ti: tú decides.
        </p>

        <h3 className="mt-4 font-medium text-stone-900">Expediente</h3>
        {evaluation ? (
          <>
            <p className="mt-1 text-sm text-stone-800">
              {evaluation.isComplete ? 'Completo' : 'Incompleto'} según el tipo{' '}
              {labelOf(CLAIM_TYPE_LABELS, evaluation.claimType)} · reglas {evaluation.rulesVersion} ·{' '}
              {formatDateTime(evaluation.createdAt)}
            </p>
            <ul className="mt-2 space-y-1">
              {requirementsOf(evaluation.result).map((r) => (
                <li key={r.documentType} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {labelOf(DOCUMENT_LABELS, r.documentType)}
                    {r.issue ? ` · ${labelOf(ISSUE_LABELS, r.issue)}` : ''}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      REQUIREMENT_CLASS[r.status] ?? 'bg-stone-200 text-stone-800'
                    }`}
                  >
                    {labelOf(REQUIREMENT_STATUS_LABELS, r.status)}
                  </span>
                </li>
              ))}
            </ul>
            <JsonBlock label="Resultado completo de la evaluación" value={evaluation.result} />
          </>
        ) : (
          <p className="mt-1 text-sm text-stone-700">Todavía no se ha evaluado el expediente.</p>
        )}

        <h3 className="mt-5 font-medium text-stone-900">Clasificaciones del modelo</h3>
        {classifications.length === 0 ? (
          <p className="mt-1 text-sm text-stone-700">El modelo aún no ha clasificado nada.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {classifications.map((k: Classification) => (
              <li key={k.id} className="rounded-md border border-stone-200 p-3 text-sm">
                <p className="font-medium text-stone-900">
                  {labelOf(SUBJECT_LABELS, k.subject)}
                  {docName(k.documentId) ? ` · ${docName(k.documentId)}` : ''}
                </p>
                <p className="mt-1 text-stone-800">
                  El modelo dijo: <strong>{displayValue(k.predictedValue)}</strong> (confianza {percent(k.confidence)})
                </p>
                {k.reviewedAt && (
                  <p className="mt-1 text-stone-800">
                    Una persona lo corrigió a: <strong>{displayValue(k.finalValue)}</strong> ·{' '}
                    {formatDateTime(k.reviewedAt)}
                  </p>
                )}
                <JsonBlock label="Evidencia del modelo" value={k.evidence} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Documentos (${documents.length})`}>
        {fileError && (
          <p role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {fileError}
          </p>
        )}
        {documents.length === 0 ? (
          <p className="text-sm text-stone-700">Este caso aún no tiene documentos.</p>
        ) : (
          <ul className="space-y-3">
            {documents.map((d) => (
              <li key={d.id} className="rounded-md border border-stone-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-stone-900">{labelOf(DOCUMENT_LABELS, d.type)}</span>
                  <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-800">
                    {labelOf(DOCUMENT_STATUS_LABELS, d.status)}
                  </span>
                </div>
                <p className="mt-1 break-all text-stone-700">
                  {d.originalFilename} · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB · recibido{' '}
                  {formatDateTime(d.uploadedAt)}
                </p>
                {d.issue && (
                  <p className="mt-1 text-red-900">
                    Problema: {labelOf(ISSUE_LABELS, d.issue)}
                    {d.issueDetail ? ` · ${d.issueDetail}` : ''}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void openFile(d)}
                  className="mt-2 text-teal-800 underline underline-offset-4"
                >
                  Ver archivo
                </button>
                <JsonBlock label="Datos que extrajo el modelo" value={d.extractedData} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Decisión">
        {decisions.length > 0 && (
          <ul className="mb-4 space-y-3">
            {decisions.map((d) => (
              <li key={d.id} className="rounded-md border border-stone-300 bg-stone-50 p-3 text-sm">
                <p className="font-medium text-stone-900">
                  {DECISION_OPTIONS.find((o) => o.value === d.kind)?.label ?? d.kind} · {d.decidedByName}
                </p>
                <p className="text-stone-600">{formatDateTime(d.decidedAt)}</p>
                {d.requestedDocuments && d.requestedDocuments.length > 0 && (
                  <p className="mt-1 text-stone-800">
                    Documentos pedidos: {d.requestedDocuments.map((x) => labelOf(DOCUMENT_LABELS, x)).join(', ')}
                  </p>
                )}
                <p className="mt-1 whitespace-pre-wrap text-stone-800">{d.reason}</p>
              </li>
            ))}
          </ul>
        )}
        {canDecide ? (
          <DecisionForm
            key={decisions.length}
            claimId={claimId}
            onDone={() => {
              setNotice('Decisión registrada a tu nombre.');
              void load();
            }}
          />
        ) : (
          <p className="text-sm text-stone-700">
            {closed
              ? 'Este caso ya está cerrado.'
              : 'Aún no se puede decidir: el expediente no está completo.'}
          </p>
        )}
      </Section>

      <Section title={`Historial (${timeline.length})`}>
        <p className="text-sm text-stone-600">Todo lo que pasó en este caso, en orden.</p>
        <ol className="mt-3 space-y-3">
          {timeline.map((e) => (
            <li key={e.eventId} className="border-l-2 border-stone-300 pl-3 text-sm">
              <p className="font-medium text-stone-900">{labelOf(EVENT_LABELS, e.eventType)}</p>
              <p className="text-stone-600">
                {formatDateTime(e.occurredAt)} · {labelOf(ACTOR_LABELS, e.actor)}
                {e.actorName ? ` (${e.actorName})` : ''}
              </p>
              <JsonBlock label="Detalle" value={e.payload} />
            </li>
          ))}
        </ol>
      </Section>

      <Section title={`Llamadas al modelo (${aiRuns.length})`}>
        {aiRuns.length === 0 ? (
          <p className="text-sm text-stone-700">No se ha llamado al modelo en este caso.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {aiRuns.map((r) => (
              <li key={r.id} className="rounded-md border border-stone-200 p-2">
                <p className="text-stone-900">
                  {labelOf(TASK_LABELS, r.task)}
                  {docName(r.documentId) ? ` · ${docName(r.documentId)}` : ''}
                </p>
                <p className="text-stone-600">
                  {r.model} · {r.status}
                  {r.latencyMs !== null ? ` · ${(r.latencyMs / 1000).toFixed(1)} s` : ''} ·{' '}
                  {formatDateTime(r.createdAt)}
                </p>
                {r.error && <p className="text-red-900">Error: {r.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}