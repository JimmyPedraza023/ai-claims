import { formatDateTime } from './format';
import { ACTOR_LABELS, EVENT_LABELS, labelOf } from './labels';
import type { TimelineEntry } from './types';

export default function TimelineList({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="space-y-3">
      {entries.map((e) => (
        <li key={e.eventId} className="border-l-2 border-stone-300 pl-3 text-sm">
          <p className="font-medium text-stone-900">{labelOf(EVENT_LABELS, e.eventType)}</p>
          <p className="text-stone-600">
            {formatDateTime(e.occurredAt)} · {labelOf(ACTOR_LABELS, e.actor)}
            {e.actorName ? ` (${e.actorName})` : ''}
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-teal-800">Detalle</summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-stone-100 p-2 text-xs text-stone-800">
              {JSON.stringify(e.payload, null, 2)}
            </pre>
          </details>
        </li>
      ))}
    </ol>
  );
}