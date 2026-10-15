/**
 * Sous-ensemble de l'API op-sqlite utilisé par la couche base de données.
 * Une connexion op-sqlite (`DB`) satisfait cette interface ; les tests
 * utilisent un adaptateur sur `node:sqlite`.
 */
export type SqlValue = string | number | null;

export type SqlRow = Record<string, unknown>;

export interface SqlResult {
  rows: SqlRow[];
}

export interface SqlDatabase {
  execute(sql: string, params?: SqlValue[]): Promise<SqlResult>;
}
