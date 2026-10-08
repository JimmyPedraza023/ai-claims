import type { ClockInfo } from './types';

// El semáforo se dice con texto e ícono, no solo con color.
const UI: Record<string, { label: string; icon: string; className: string }> = {
  vencido: { label: 'Vencido', icon: '!', className: 'bg-red-100 text-red-900' },
  en_riesgo: { label: 'En riesgo', icon: '▲', className: 'bg-amber-100 text-amber-900' },
  en_plazo: { label: 'En plazo', icon: '✓', className: 'bg-teal-100 text-teal-900' },
};
const NO_CLOCK = { label: 'Sin reloj', icon: '–', className: 'bg-stone-200 text-stone-800' };

export default function ClockBadge({ clock }: { clock: ClockInfo | null }) {
  const ui = (clock?.clockState && UI[clock.clockState]) || NO_CLOCK;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${ui.className}`}
    >
      <span aria-hidden="true">{ui.icon}</span>
      {ui.label}
    </span>
  );
}