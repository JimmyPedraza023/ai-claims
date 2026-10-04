import {
  addOneMonth,
  computeDeadline,
  diffInDays,
  getClockStatus,
  toCalendarDate,
} from './legal-clock';

// Atajo: instante a las 10:00 hora de Colombia (UTC-5) de la fecha dada.
const bogota = (isoDate: string, hour = 10): Date =>
  new Date(`${isoDate}T${String(hour).padStart(2, '0')}:00:00-05:00`);

describe('addOneMonth', () => {
  it.each([
    ['2026-10-01', '2026-11-01'],
    ['2026-10-20', '2026-11-20'],
    ['2026-10-31', '2026-11-30'], // noviembre no tiene día 31
    ['2027-01-30', '2027-02-28'], // año no bisiesto
    ['2028-01-31', '2028-02-29'], // año bisiesto
    ['2026-12-15', '2027-01-15'], // cambio de año
    ['2026-12-31', '2027-01-31'],
    ['2026-05-31', '2026-06-30'],
  ])('%s -> %s', (desde, esperado) => {
    expect(addOneMonth(desde)).toBe(esperado);
  });

  it('rechaza fechas mal formadas', () => {
    expect(() => addOneMonth('31/10/2026')).toThrow();
  });
});

describe('computeDeadline: el reloj corre desde que el expediente queda completo', () => {
  it('caso del enunciado: llega incompleto el 1 de octubre y se completa el 20 => vence el 20 de noviembre', () => {
    const completo = bogota('2026-10-20');
    expect(computeDeadline(completo)).toBe('2026-11-20');
    expect(computeDeadline(completo)).not.toBe('2026-11-01'); // no desde la primera radicación
  });

  it('usa la fecha de Colombia, no la de UTC', () => {
    // 9:30 p. m. del 31 de octubre en Colombia = 02:30 UTC del 1 de noviembre.
    const instante = new Date('2026-11-01T02:30:00Z');
    expect(toCalendarDate(instante)).toBe('2026-10-31');
    expect(computeDeadline(instante)).toBe('2026-11-30'); // y no 2026-12-01
  });
});

describe('diffInDays', () => {
  it('cuenta días de calendario', () => {
    expect(diffInDays('2026-10-20', '2026-11-20')).toBe(31);
    expect(diffInDays('2026-11-20', '2026-10-20')).toBe(-31);
    expect(diffInDays('2026-10-31', '2026-10-31')).toBe(0);
  });
});

describe('getClockStatus', () => {
  const completedAt = bogota('2026-10-20');
  const deadlineDate = '2026-11-20';
  const estado = (hoy: string, riskDays?: number) =>
    getClockStatus({ completedAt, deadlineDate, now: bogota(hoy), riskDays });

  it('sin completar no hay reloj', () => {
    expect(getClockStatus({ completedAt: null, deadlineDate: null, now: bogota('2026-10-25') })).toEqual({
      state: 'sin_reloj',
      daysElapsed: null,
      daysTotal: null,
      daysRemaining: null,
    });
  });

  it('el día en que se completa: día 0 de 31, en plazo', () => {
    expect(estado('2026-10-20')).toEqual({
      state: 'en_plazo',
      daysElapsed: 0,
      daysTotal: 31,
      daysRemaining: 31,
    });
  });

  it('en plazo mientras queden más de 7 días', () => {
    expect(estado('2026-11-12')).toMatchObject({ state: 'en_plazo', daysRemaining: 8 });
  });

  it('en riesgo cuando quedan 7 días o menos', () => {
    expect(estado('2026-11-13')).toMatchObject({ state: 'en_riesgo', daysRemaining: 7 });
    expect(estado('2026-11-19')).toMatchObject({ state: 'en_riesgo', daysRemaining: 1 });
  });

  it('el último día del plazo todavía no está vencido', () => {
    expect(estado('2026-11-20')).toMatchObject({ state: 'en_riesgo', daysRemaining: 0 });
  });

  it('al día siguiente de la fecha límite está vencido', () => {
    expect(estado('2026-11-21')).toMatchObject({ state: 'vencido', daysRemaining: -1 });
    expect(estado('2026-12-15')).toMatchObject({ state: 'vencido', daysRemaining: -25 });
  });

  it('el umbral de riesgo es configurable', () => {
    expect(estado('2026-11-05', 15)).toMatchObject({ state: 'en_riesgo' });
    expect(estado('2026-11-05', 7)).toMatchObject({ state: 'en_plazo' });
  });

  it('cambia de día a medianoche de Colombia, no de UTC', () => {
    // 11:30 p. m. del 20 de nov en Colombia = 04:30 UTC del 21: aún no está vencido.
    const casiMedianoche = new Date('2026-11-21T04:30:00Z');
    expect(getClockStatus({ completedAt, deadlineDate, now: casiMedianoche })).toMatchObject({
      state: 'en_riesgo',
      daysRemaining: 0,
    });
  });

  it('rechaza un estado incoherente (igual que la base de datos)', () => {
    expect(() => getClockStatus({ completedAt, deadlineDate: null, now: new Date() })).toThrow();
    expect(() => getClockStatus({ completedAt: null, deadlineDate, now: new Date() })).toThrow();
  });

  it('rechaza un umbral de riesgo inválido', () => {
    expect(() => estado('2026-10-25', -1)).toThrow();
    expect(() => estado('2026-10-25', 1.5)).toThrow();
  });
});