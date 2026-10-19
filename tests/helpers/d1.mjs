// Base D1 simulée pour les tests : même interface que le binding Cloudflare (prepare/bind/first/all/run),
// sur une base SQLite en mémoire (node:sqlite) — les vraies requêtes SQL du projet sont donc exécutées.
import { DatabaseSync } from 'node:sqlite';

// sqlite : base existante à envelopper (ex. copie de la production, scripts/verify-d1-copy.mjs).
export function createD1(sqlite = new DatabaseSync(':memory:')) {
  const queries = new WeakMap();
  const execute = (sql, params) => {
    const prepared = sqlite.prepare(sql);
    const returnsRows = prepared.columns().length > 0;
    const results = returnsRows ? prepared.all(...params) : [];
    const info = returnsRows
      ? sqlite.prepare('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid').get()
      : prepared.run(...params);
    return { results, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  };
  const statement = (sql, params = []) => {
    const result = {
      bind: (...args) => statement(sql, args),
      first: async () => sqlite.prepare(sql).get(...params) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
      run: async () => execute(sql, params),
    };
    queries.set(result, { sql, params });
    return result;
  };
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => {
          const { sql, params } = queries.get(statement);
          return execute(sql, params);
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export function createKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => void store.set(key, value),
    delete: async (key) => void store.delete(key),
    store,
  };
}

// Bucket R2 simulé : put/get/delete (une clé ou une liste, comme le binding Cloudflare).
export function createR2({ failDelete = false } = {}) {
  const store = new Map();
  return {
    put: async (key, value) => void store.set(key, value),
    get: async (key) => (store.has(key) ? { body: store.get(key) } : null),
    delete: async (keys) => {
      if (failDelete) throw new Error('R2 indisponible');
      for (const key of [].concat(keys)) store.delete(key);
    },
    store,
  };
}
