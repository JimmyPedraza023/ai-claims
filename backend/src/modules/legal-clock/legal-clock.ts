/**
 * Reloj legal (art. 1080 del Código de Comercio): la aseguradora tiene un mes,
 * contado desde que el expediente queda COMPLETO, para pagar u objetar.
 *
 * Funciones puras: sin base de datos, sin Nest, sin leer la hora del sistema
 * (la hora se recibe como parámetro). Por eso se prueban fácil y no dependen
 * del servidor donde corran.
 *
 * Reglas (supuestos pendientes de confirmar con la compañía, ver docs/ASSUMPTIONS.md):
 *  - "Un mes" = mes calendario. Si el día no existe en el mes siguiente, se usa
 *    el último día de ese mes (31 oct -> 30 nov). Igual que Postgres: date + interval '1 month'.
 *  - Los días se cuentan en hora de Colombia (America/Bogota, UTC-5, sin horario de verano).
 *  - La fecha límite es el ÚLTIMO día del plazo, inclusive: solo está vencido al día siguiente.
 */

/** Fecha de calendario sin hora, formato 'YYYY-MM-DD'. */
export type CalendarDate = string;

export type ClockState = 'sin_reloj' | 'en_plazo' | 'en_riesgo' | 'vencido';

export interface ClockStatus {
  state: ClockState;
  /** Días transcurridos desde que se completó (null si no hay reloj). */
  daysElapsed: number | null;
  /** Duración total del plazo en días: 28 a 31 según el mes (null si no hay reloj). */
  daysTotal: number | null;
  /** Días que quedan hasta la fecha límite; negativo si ya venció (null si no hay reloj). */
  daysRemaining: number | null;
}

export const CLOCK_TIME_ZONE = 'America/Bogota';
/** Un caso está "en riesgo" cuando le quedan este número de días o menos. */
export const DEFAULT_RISK_DAYS = 7;

const MS_PER_DAY = 86_400_000;

const bogotaParts = new Intl.DateTimeFormat('en-US', {
  timeZone: CLOCK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha de calendario (en hora de Colombia) a la que corresponde un instante. */
export function toCalendarDate(instant: Date): CalendarDate {
  if (Number.isNaN(instant.getTime())) throw new Error('Fecha inválida');
  const parts = Object.fromEntries(
    bogotaParts.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parse(date: CalendarDate): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Fecha de calendario inválida: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function format(year: number, month: number, day: number): CalendarDate {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month: 1..12
}

/** Suma un mes calendario, ajustando al último día si el día no existe. */
export function addOneMonth(date: CalendarDate): CalendarDate {
  const { year, month, day } = parse(date);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return format(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
}

/** Último día del plazo para un expediente que quedó completo en `completedAt`. */
export function computeDeadline(completedAt: Date): CalendarDate {
  return addOneMonth(toCalendarDate(completedAt));
}

/** Días entre dos fechas de calendario (positivo si `to` es posterior a `from`). */
export function diffInDays(from: CalendarDate, to: CalendarDate): number {
  const a = parse(from);
  const b = parse(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_PER_DAY,
  );
}

export interface ClockInput {
  /** Momento en que el expediente quedó completo; null si aún no lo está. */
  completedAt: Date | null;
  /** Fecha límite guardada al completarse; null si aún no hay reloj. */
  deadlineDate: CalendarDate | null;
  /** "Ahora". Se recibe como parámetro para poder probar cualquier fecha. */
  now: Date;
  riskDays?: number;
}

/** En qué día del plazo va un caso y en qué estado está su reloj. */
export function getClockStatus(input: ClockInput): ClockStatus {
  const { completedAt, deadlineDate, now, riskDays = DEFAULT_RISK_DAYS } = input;

  if (!Number.isInteger(riskDays) || riskDays < 0) {
    throw new Error('riskDays debe ser un entero mayor o igual a 0');
  }
  // Mismo criterio que la base de datos: sin completar => sin reloj; completo => con reloj.
  if ((completedAt === null) !== (deadlineDate === null)) {
    throw new Error('completedAt y deadlineDate deben venir los dos o ninguno');
  }
  if (completedAt === null || deadlineDate === null) {
    return { state: 'sin_reloj', daysElapsed: null, daysTotal: null, daysRemaining: null };
  }

  const today = toCalendarDate(now);
  const completedDay = toCalendarDate(completedAt);
  const daysRemaining = diffInDays(today, deadlineDate);

  let state: ClockState;
  if (daysRemaining < 0) state = 'vencido';
  else if (daysRemaining <= riskDays) state = 'en_riesgo';
  else state = 'en_plazo';

  return {
    state,
    daysElapsed: diffInDays(completedDay, today),
    daysTotal: diffInDays(completedDay, deadlineDate),
    daysRemaining,
  };
}