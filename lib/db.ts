import postgres from 'postgres';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { env } from './env';

export type Db = {
  query<T>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
};

const fromPostgres = (sql: postgres.Sql | postgres.TransactionSql, inTx = false): Db => {
  const db: Db = {
    query: async <T>(text: string, params?: unknown[]) =>
      (params ? await sql.unsafe(text, params as never[]) : await sql.unsafe(text).simple()) as unknown as T[],
    transaction: <T>(fn: (tx: Db) => Promise<T>) =>
      inTx ? fn(db) : ((sql as postgres.Sql).begin((tx) => fn(fromPostgres(tx, true))) as Promise<T>),
  };
  return db;
};

const fromPglite = (pg: PGlite | Transaction, inTx = false): Db => {
  const db: Db = {
    query: async <T>(text: string, params?: unknown[]) =>
      (params ? (await pg.query<T>(text, params)).rows : ((await pg.exec(text)).at(-1)?.rows ?? [])) as T[],
    transaction: <T>(fn: (tx: Db) => Promise<T>) =>
      inTx ? fn(db) : (pg as PGlite).transaction((tx) => fn(fromPglite(tx, true))),
  };
  return db;
};

export const postgresDb = (url: string): Db => fromPostgres(postgres(url, { prepare: false }));

export const pgliteDb = async (): Promise<Db> => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { vector } = await import('@electric-sql/pglite-pgvector');
  return fromPglite(await PGlite.create({ extensions: { vector } }));
};

let shared: Db | undefined;

export const appDb = () => (shared ??= postgresDb(env().DATABASE_URL));
