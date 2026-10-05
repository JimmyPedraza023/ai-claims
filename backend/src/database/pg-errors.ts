/**
 * ¿El error de PostgreSQL es una violación de unicidad (23505)?
 * Si se indica `constraint`, además debe ser ese índice o restricción.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string } | null | undefined;
  return e?.code === '23505' && (constraint === undefined || e.constraint === constraint);
}