import { checkDecisionAllowed, closedStatusFor } from './decisions.rules';

const open = (status: 'recibida' | 'incompleta' | 'completa') => ({ status, closedAt: null });

describe('checkDecisionAllowed', () => {
  it.each(['pagar', 'objetar'] as const)('%s solo con el expediente completo', (kind) => {
    expect(checkDecisionAllowed(open('completa'), kind)).toBeNull();
    expect(checkDecisionAllowed(open('incompleta'), kind)).not.toBeNull();
    expect(checkDecisionAllowed(open('recibida'), kind)).not.toBeNull();
  });

  it('pedir documentos vale en cualquier estado abierto', () => {
    for (const s of ['recibida', 'incompleta', 'completa'] as const) {
      expect(checkDecisionAllowed(open(s), 'pedir_documentos')).toBeNull();
    }
  });

  it('un caso cerrado no admite ninguna decisión', () => {
    const closed = { status: 'pagada' as const, closedAt: new Date() };
    for (const k of ['pagar', 'objetar', 'pedir_documentos'] as const) {
      expect(checkDecisionAllowed(closed, k)).toBe('Este caso ya fue resuelto');
    }
  });

  it('closedStatusFor', () => {
    expect(closedStatusFor('pagar')).toBe('pagada');
    expect(closedStatusFor('objetar')).toBe('objetada');
  });
});