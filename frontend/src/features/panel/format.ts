import type { ClockInfo } from './types';

const TZ = 'America/Bogota';

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: TZ,
  });
}

/** El límite es una fecha sin hora: se formatea en UTC para que la zona del servidor no la corra de día. */
export function formatDeadline(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function remainingText(days: number | null): string {
  if (days === null) return '';
  if (days < 0) return `Venció hace ${-days} ${-days === 1 ? 'día' : 'días'}`;
  if (days === 0) return 'Vence hoy';
  return `${days} ${days === 1 ? 'día restante' : 'días restantes'}`;
}

/** "Día 12 de 31 · 19 días restantes" */
export function clockLine(clock: ClockInfo | null): string {
  if (!clock || !clock.deadlineDate) return 'El plazo arranca cuando el expediente esté completo.';
  return `Día ${clock.daysElapsed} de ${clock.daysTotal} · ${remainingText(clock.daysRemaining)}`;
}

export function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toLocaleString('es-CO', { maximumFractionDigits: 1 })} h`;
  return `${(hours / 24).toLocaleString('es-CO', { maximumFractionDigits: 1 })} días`;
}

export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
}