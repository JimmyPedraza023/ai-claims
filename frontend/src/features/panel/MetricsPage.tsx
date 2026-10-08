import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ClockBadge from './ClockBadge';
import { clockLine, formatHours, formatRate } from './format';
import { SUBJECT_LABELS, labelOf } from './labels';
import { errorMessage, panelRequest } from './panelApi';
import TimelineList from './TimelineList';
import type { ClockMetrics, FirstResponseStats, ModelCorrectionRow, RandomTimeline } from './types';

interface MetricState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

// Cada tarjeta carga por su cuenta: si una falla, las otras tres siguen funcionando.
function useMetric<T>(path: string) {
  const [state, setState] = useState<MetricState<T>>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    panelRequest<T>(path, { signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState((s) => ({ ...s, error: errorMessage(err), loading: false }));
        }
      });
    return () => controller.abort();
  }, [path, tick]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    setTick((t) => t + 1);
  }, []);

  return { ...state, reload };
}

function Card(props: {
  number: number;
  title: string;
  question: string;
  state: MetricState<unknown>;
  onRetry: () => void;
  children: ReactNode;
}) {
  const { number, title, question, state, onRetry, children } = props;
  return (
    <section className="rounded-md border border-stone-300 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
        Pregunta {number}
        </p>
        <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
        <p className="mt-1 text-sm text-stone-600">{question}</p>

        <div className="mt-4">
        {state.error && (
            <div
            role="alert"
            className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
            >
            {state.error}{' '}
            <button onClick={onRetry} className="underline underline-offset-4">
                Reintentar
            </button>
            </div>
        )}

        {state.loading && !state.data ? (
            <p role="status" className="text-sm text-stone-700">
            Cargando…
            </p>
        ) : state.data ? (
            children
        ) : null}
        </div>
    </section>
    );
}

function Stat({ label, value, tone = 'bg-stone-100 text-stone-900' }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className={`rounded-md p-3 ${tone}`}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-sm">{label}</p>
    </div>
  );
}

export default function MetricsPage() {
  const clock = useMetric<ClockMetrics>('/panel/metrics/clock');
  const corrections = useMetric<{ subjects: ModelCorrectionRow[] }>('/panel/metrics/model-corrections');
  const response = useMetric<FirstResponseStats>('/panel/metrics/first-response');
  const random = useMetric<RandomTimeline>('/panel/metrics/random-timeline');

  const s = clock.data?.summary;
  const r = response.data;
  const subjects = corrections.data?.subjects ?? [];
  const anyReviewed = subjects.some((x) => x.reviewed > 0);

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Métricas</h1>
        <p className="mt-1 text-sm text-stone-600">
          Las cuatro preguntas del enunciado, calculadas en vivo desde la base de datos con lo que realmente pasó.
        </p>
      </div>

      <Card
        number={1}
        title="Reloj legal"
        question="¿Cuántos casos hay abiertos, en qué día del plazo va cada uno, cuántos están en riesgo y cuántos se vencieron?"
        state={clock}
        onRetry={clock.reload}
      >
        {s && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Abiertos" value={s.open} />
              <Stat label="En plazo" value={s.onTime} tone="bg-teal-100 text-teal-900" />
              <Stat label="En riesgo" value={s.atRisk} tone="bg-amber-100 text-amber-900" />
              <Stat label="Vencidos" value={s.expired} tone="bg-red-100 text-red-900" />
              <Stat label="Sin reloj aún" value={s.withoutClock} />
            </div>
            {clock.data && clock.data.claims.length > 0 ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-teal-800">
                  Ver el día del plazo de cada caso ({clock.data.claims.length})
                </summary>
                <ul className="mt-2 max-h-80 divide-y divide-stone-200 overflow-auto rounded-md border border-stone-200">
                  {clock.data.claims.map((c) => (
                    <li key={c.claimId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <Link
                        to={`/panel/casos/${c.claimId}`}
                        className="font-medium text-teal-800 underline underline-offset-4"
                      >
                        {c.referenceCode}
                      </Link>
                      <span className="text-stone-600">{clockLine(c)}</span>
                      <ClockBadge clock={c} />
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="mt-4 text-sm text-stone-700">No hay casos abiertos.</p>
            )}
          </>
        )}
      </Card>

      <Card
        number={2}
        title="Correcciones al modelo"
        question="De las clasificaciones que hizo el modelo, ¿cuántas tuvo que corregir una persona?"
        state={corrections}
        onRetry={corrections.reload}
      >
        {subjects.length === 0 ? (
          <p className="text-sm text-stone-700">El modelo aún no ha hecho clasificaciones.</p>
        ) : (
          <>
            {!anyReviewed && (
              <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Todavía nadie ha revisado clasificaciones: con estos datos aún no se puede afirmar que el modelo sirva.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="border-b border-stone-300 text-stone-700">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Qué clasificó</th>
                    <th className="px-3 py-2 font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Confirmadas</th>
                    <th className="px-3 py-2 font-medium">Corregidas</th>
                    <th className="px-3 py-2 font-medium">Se abstuvo</th>
                    <th className="px-3 py-2 font-medium">Sin revisar</th>
                    <th className="px-3 py-2 font-medium">Tasa de corrección</th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((x) => (
                    <tr key={x.subject} className="border-b border-stone-200 last:border-0">
                      <td className="py-2 pr-3">{labelOf(SUBJECT_LABELS, x.subject)}</td>
                      <td className="px-3 py-2">{x.total}</td>
                      <td className="px-3 py-2">{x.confirmed}</td>
                      <td className="px-3 py-2">{x.corrected}</td>
                      <td className="px-3 py-2">{x.abstained}</td>
                      <td className="px-3 py-2">{x.pendingReview}</td>
                      <td className="px-3 py-2 font-medium">
                        {x.correctionRate === null ? 'Sin revisiones' : formatRate(x.correctionRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-stone-600">
              Tasa = corregidas ÷ (confirmadas + corregidas). «Se abstuvo» es cuando el modelo dudó y envió el caso a
              una persona: no es un error, y por eso no cuenta en la tasa.
            </p>
          </>
        )}
      </Card>

      <Card
        number={3}
        title="Tiempo hasta la primera respuesta"
        question="¿Cuánto se demora el sistema desde que llega la radicación hasta decirle al beneficiario qué le falta?"
        state={response}
        onRetry={response.reload}
      >
        {r &&
          (r.total === 0 ? (
            <p className="text-sm text-stone-700">Todavía no hay radicaciones.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Promedio" value={formatHours(r.avgHours)} />
                <Stat label="Mediana" value={formatHours(r.medianHours)} />
                <Stat label="Percentil 90" value={formatHours(r.p90Hours)} />
                <Stat label="Más lento" value={formatHours(r.maxHours)} />
              </div>
              <p className="mt-3 text-sm text-stone-800">
                Hoy, sin el sistema: <strong>{formatHours(r.baselineHours)}</strong> en promedio (escenario del enunciado).
              </p>
              <p className="mt-1 text-sm text-stone-800">
                Con respuesta: <strong>{r.responded}</strong> de {r.total}. Sin respuesta todavía:{' '}
                <strong>{r.withoutResponse}</strong>
                {r.oldestWaitingHours !== null &&
                  ` (el más antiguo lleva esperando ${formatHours(r.oldestWaitingHours)})`}
                .
              </p>
              <p className="mt-2 text-xs text-stone-600">
                Los casos sin respuesta no entran en el promedio: se cuentan aparte para que no lo mejoren sin merecerlo.
              </p>
            </>
          ))}
      </Card>

      <Card
        number={4}
        title="Reconstrucción de un caso"
        question="Si escogemos un caso al azar, ¿se puede reconstruir su historia completa de principio a fin?"
        state={random}
        onRetry={random.reload}
      >
        {random.data &&
          (random.data.claim === null ? (
            <p className="text-sm text-stone-700">Todavía no hay casos.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-stone-800">
                  Caso{' '}
                  <Link
                    to={`/panel/casos/${random.data.claim.id}`}
                    className="font-medium text-teal-800 underline underline-offset-4"
                  >
                    {random.data.claim.referenceCode}
                  </Link>{' '}
                  · {random.data.timeline.length} eventos
                </p>
                <button
                  onClick={random.reload}
                  disabled={random.loading}
                  className="rounded-md border border-stone-400 px-3 py-2 text-sm text-stone-800 disabled:opacity-50"
                >
                  {random.loading ? 'Escogiendo…' : 'Escoger otro caso al azar'}
                </button>
              </div>
              <div className="mt-4">
                <TimelineList entries={random.data.timeline} />
              </div>
              {random.data.claimsWithoutEvents === 0 ? (
                <p className="mt-4 text-sm text-teal-900">
                  Todos los casos tienen historial: ninguno quedó sin eventos.
                </p>
              ) : (
                <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                  Hay {random.data.claimsWithoutEvents} casos sin ningún evento en la bitácora: esos no se pueden
                  reconstruir.
                </p>
              )}
            </>
          ))}
      </Card>
    </section>
  );
}