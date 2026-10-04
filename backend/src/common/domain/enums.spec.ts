import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAIM_TYPES, DOCUMENT_ISSUES, DOCUMENT_STATUSES, DOCUMENT_TYPES } from './enums';

/** Lee los valores de un CREATE TYPE ... AS ENUM de la migración 0001. */
function enumFromSql(name: string): string[] {
  const sql = readFileSync(
    join(__dirname, '../../database/migrations/0001_enums.sql'),
    'utf8',
  ).replace(/--.*$/gm, ''); // sin comentarios
  const match = new RegExp(`CREATE TYPE ${name} AS ENUM \\(([^)]*)\\)`).exec(sql);
  if (!match) throw new Error(`No se encontró el tipo ${name} en 0001_enums.sql`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('enums del dominio vs. base de datos', () => {
  const casos: Array<[string, readonly string[]]> = [
    ['claim_type', CLAIM_TYPES],
    ['document_type', DOCUMENT_TYPES],
    ['document_status', DOCUMENT_STATUSES],
    ['document_issue', DOCUMENT_ISSUES],
  ];

  it.each(casos)('%s coincide con la migración SQL', (nombre, valoresTs) => {
    expect([...valoresTs].sort()).toEqual(enumFromSql(nombre).sort());
  });
});