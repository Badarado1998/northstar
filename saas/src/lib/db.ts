import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { statements } from './sql';

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');

export async function migrate(db: Db): Promise<void> {
  for (const statement of statements(readFileSync(schemaPath, 'utf8'))) {
    await db.query(statement);
  }
}

type Sql = ReturnType<typeof postgres>;

function postgresAdapter(sql: Sql, nested = false): Db {
  return {
    async query(text, params = []) {
      return await sql.unsafe(text, params as never[]);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      if (nested) return fn(postgresAdapter(sql, true));
      const result = await sql.begin(async tx => fn(postgresAdapter(tx as unknown as Sql, true)));
      return result as T;
    },
  };
}

const globalDb = globalThis as unknown as { sql?: Sql; migrated?: Promise<void> };

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is not set.');
  return url;
}

export async function getDb(): Promise<Db> {
  if (!globalDb.sql) {
    const url = databaseUrl();
    globalDb.sql = postgres(url, {
      max: 1,
      prepare: false,
      ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : 'require',
      connection: { application_name: 'northstar' },
    });
  }
  const db = postgresAdapter(globalDb.sql);
  if (!globalDb.migrated) {
    globalDb.migrated = migrate(db).catch(error => {
      globalDb.migrated = undefined;
      throw error;
    });
  }
  await globalDb.migrated;
  return db;
}
