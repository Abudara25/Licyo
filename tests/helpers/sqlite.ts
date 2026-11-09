// Base SQLite en mémoire avec les migrations D1, exposée avec l'interface D1
// de la couche de données. Sert aux tests et à la génération des données de démo.
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase, SqlStatement } from '../../src/lib/db/query.ts';

export function sqliteAdapter(raw: DatabaseSync): SqlDatabase {
  const statement = (sql: string, params: unknown[] = []): SqlStatement => ({
    bind: (...values: unknown[]) => statement(sql, values),
    all: async <T,>() => ({ results: raw.prepare(sql).all(...(params as never[])) as T[], meta: { changes: 0 } }),
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...(params as never[])).changes) } }),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (stmts) => {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.all());
        raw.exec('COMMIT');
        return out;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export function migratedDatabase(): DatabaseSync {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync('migrations').filter((n) => n.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  return raw;
}
