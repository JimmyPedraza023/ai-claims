import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ClockBadge from './ClockBadge';
import { CLAIM_TYPE_LABELS } from './domain';
import { clockLine, formatDay } from './format';
import { CLAIM_STATUS_LABELS, labelOf } from './labels';
import { errorMessage, panelRequest } from './panelApi';
import type { CaseRow, CasesResponse } from './types';

const PAGE = 50;

export default function CasesPage() {
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (offset: number, signal?: AbortSignal) => {
    const res = await panelRequest<CasesResponse>(`/panel/claims?limit=${PAGE}&offset=${offset}`, { signal });
    return res.claims;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchPage(0, controller.signal)
      .then((list) => {
        setRows(list);
        setHasMore(list.length === PAGE);
        setError(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [fetchPage]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = await fetchPage(rows.length);
      setRows((prev) => [...prev, ...next]);
      setHasMore(next.length === PAGE);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section>
      <h1 className="text-xl font-semibold text-stone-900">Casos abiertos</h1>
      <p className="mt-1 text-sm text-stone-600">
        Ordenados por urgencia: primero los vencidos, luego los que están en riesgo.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      )}

      {loading ? (
        <p role="status" className="mt-4 text-stone-700">
          Cargando casos…
        </p>
      ) : rows.length === 0 ? (
        !error && <p className="mt-4 text-stone-700">No hay casos abiertos.</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto rounded-md border border-stone-300 bg-white">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-stone-300 bg-stone-100 text-stone-700">
                <tr>
                  <th className="px-3 py-2 font-medium">Caso</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Plazo legal</th>
                  <th className="px-3 py-2 font-medium">Recibido</th>
                  <th className="px-3 py-2 font-medium">Por revisar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.claimId} className="border-b border-stone-200 align-top last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        to={`/panel/casos/${r.claimId}`}
                        className="font-medium text-teal-800 underline underline-offset-4"
                      >
                        {r.referenceCode}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {r.claimType ? labelOf(CLAIM_TYPE_LABELS, r.claimType) : 'Sin determinar'}
                    </td>
                    <td className="px-3 py-2">{labelOf(CLAIM_STATUS_LABELS, r.status)}</td>
                    <td className="px-3 py-2">
                      <ClockBadge clock={r} />
                      <span className="mt-1 block text-xs text-stone-600">{clockLine(r)}</span>
                    </td>
                    <td className="px-3 py-2">{formatDay(r.receivedAt)}</td>
                    <td className="px-3 py-2">
                      {r.docsInReview > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                          {r.docsInReview} {r.docsInReview === 1 ? 'documento' : 'documentos'}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-4 rounded-md border border-stone-400 px-4 py-2 text-stone-800 disabled:opacity-50"
            >
              {loadingMore ? 'Cargando…' : 'Ver más casos'}
            </button>
          )}
        </>
      )}
    </section>
  );
}