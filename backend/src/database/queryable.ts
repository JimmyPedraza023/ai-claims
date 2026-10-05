import type { QueryResult, QueryResultRow } from 'pg';

/**
 * Cualquier cosa que sepa ejecutar una consulta SQL: el pool normal
 * (DatabaseService) o una conexión dentro de una transacción (PoolClient).
 *
 * Los servicios reciben esto como primer parámetro. Así quien orquesta
 * (por ejemplo, la radicación) abre UNA transacción y le pasa la misma
 * conexión al servicio de casos, al de documentos y a la bitácora: o se
 * guarda todo junto o no se guarda nada.
 */
export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}