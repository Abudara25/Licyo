// Constructeur de requêtes D1 compatible avec le sous-ensemble de l'API
// supabase-js utilisé par Licyo (from/select/eq/in/order/insert/update/upsert/delete).
// Chaque requête applique les règles d'accès de policies.ts selon le contexte.

import type { Database } from '@/types/database';
import { CLUB_USER_UPDATABLE, policyFor, type ColumnRef, type Command, type SecurityContext } from './policies.ts';
import { fromSql, isTableName, tableMeta, toSql, type TableMeta, type TableName } from './schema.ts';

// --- Base SQL minimale (D1 en production, node:sqlite en test) --------------------------

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta?: { changes?: number } }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<Array<{ results?: unknown[]; meta?: { changes?: number } }>>;
}

// --- Résultats et erreurs au format supabase-js ----------------------------------------

export type DbError = { message: string; code: string; details?: string };
export type DbResult<T> = { data: T; error: DbError | null; count: number | null; status: number };

type Tables = Database['public']['Tables'];
type RowOf<T extends keyof Tables> = Tables[T]['Row'];
type InsertOf<T extends keyof Tables> = Tables[T]['Insert'];
type UpdateOf<T extends keyof Tables> = Tables[T]['Update'];

const RLS_SENTINEL = 'licyo_rls_violation';
const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Clés de conflit par défaut d'un upsert (clé primaire). */
const PRIMARY_KEYS: Partial<Record<TableName, string[]>> = {
  club_mail_credentials: ['club_id'],
  club_site_settings: ['club_id'],
  club_site_media: ['club_id', 'section'],
  family_access: ['family_id', 'user_id'],
  auth_sessions: ['token_hash'],
  auth_login_tokens: ['token_hash'],
  rate_limits: ['bucket', 'window_start'],
};

function ident(name: string): string {
  if (!IDENT.test(name)) throw new DbQueryError(`Identifiant SQL refusé : ${name}`, '42601');
  return `"${name}"`;
}

class DbQueryError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export function toDbError(error: unknown): DbError {
  if (error instanceof DbQueryError) return { message: error.message, code: error.code };
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(RLS_SENTINEL) || message.includes('malformed JSON')) {
    return { message: 'new row violates row-level security policy', code: '42501' };
  }
  if (message.includes('UNIQUE constraint failed')) return { message, code: '23505' };
  if (message.includes('FOREIGN KEY constraint failed')) return { message, code: '23503' };
  if (message.includes('CHECK constraint failed')) return { message, code: '23514' };
  if (message.includes('NOT NULL constraint failed')) return { message, code: '23502' };
  if (message.includes('tenant_mismatch')) return { message: 'Référence à un autre club refusée', code: '23503' };
  return { message, code: 'XX000' };
}

/** Condition qui lève une erreur si la nouvelle ligne n'est pas autorisée. */
function enforce(check: string): string {
  return `(CASE WHEN ${check} THEN 1 ELSE json('${RLS_SENTINEL}') END)`;
}

type Filter = { sql: string; params: unknown[] };
type Order = { column: string; ascending: boolean; nullsFirst: boolean };
type Mode = 'many' | 'single' | 'maybeSingle';

export class QueryBuilder<Row, Result = Row[]> implements PromiseLike<DbResult<Result>> {
  private op: Command | 'upsert' = 'select';
  private columns = '*';
  private countMode: 'exact' | null = null;
  private head = false;
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private limitValue: number | null = null;
  private mode: Mode = 'many';
  private values: Record<string, unknown>[] = [];
  private onConflict: string[] | null = null;
  private returning = false;
  private readonly meta: TableMeta;
  private readonly db: SqlDatabase;
  private readonly table: TableName;
  private readonly ctx: SecurityContext;

  constructor(db: SqlDatabase, table: TableName, ctx: SecurityContext) {
    this.db = db;
    this.table = table;
    this.ctx = ctx;
    this.meta = tableMeta(table);
  }

  private col(name: string): string {
    return `${ident(this.table)}.${ident(name)}`;
  }

  // --- Opérations -----------------------------------------------------------------

  select(columns = '*', options?: { count?: 'exact'; head?: boolean }): QueryBuilder<Row, Row[]> {
    if (this.op === 'select') {
      this.columns = columns;
      this.countMode = options?.count ?? null;
      this.head = options?.head ?? false;
    } else {
      // insert/update/upsert/delete ... .select() : renvoyer les lignes écrites.
      this.returning = true;
      this.columns = columns;
    }
    return this as unknown as QueryBuilder<Row, Row[]>;
  }

  insert(values: Partial<Row> | Partial<Row>[]): QueryBuilder<Row, null> {
    this.assertWritable();
    this.op = 'insert';
    this.values = (Array.isArray(values) ? values : [values]) as Record<string, unknown>[];
    return this as unknown as QueryBuilder<Row, null>;
  }

  upsert(values: Partial<Row> | Partial<Row>[], options?: { onConflict?: string }): QueryBuilder<Row, null> {
    this.assertWritable();
    this.op = 'upsert';
    this.values = (Array.isArray(values) ? values : [values]) as Record<string, unknown>[];
    this.onConflict = options?.onConflict
      ? options.onConflict.split(',').map((c) => c.trim())
      : (PRIMARY_KEYS[this.table] ?? ['id']);
    return this as unknown as QueryBuilder<Row, null>;
  }

  update(values: Partial<Row>): QueryBuilder<Row, null> {
    this.assertWritable();
    this.op = 'update';
    this.values = [values as Record<string, unknown>];
    return this as unknown as QueryBuilder<Row, null>;
  }

  delete(): QueryBuilder<Row, null> {
    this.assertWritable();
    this.op = 'delete';
    return this as unknown as QueryBuilder<Row, null>;
  }

  private assertWritable() {
    if (this.meta.view) throw new DbQueryError(`Vue en lecture seule : ${this.table}`, '42809');
  }

  // --- Filtres --------------------------------------------------------------------

  private where(column: string, operator: string, value: unknown): this {
    this.filters.push({ sql: `${this.col(column)} ${operator} ?`, params: [toSql(this.meta, column, value)] });
    return this;
  }
  eq<K extends keyof Row & string>(column: K, value: Row[K] | string | number | boolean): this {
    if (value === null) return this.is(column, null);
    return this.where(column, '=', value);
  }
  neq<K extends keyof Row & string>(column: K, value: unknown): this {
    // Postgres : col <> NULL est inconnu ; on garde la même sémantique (NULL exclu).
    return this.where(column, '<>', value);
  }
  gt<K extends keyof Row & string>(column: K, value: unknown): this {
    return this.where(column, '>', value);
  }
  gte<K extends keyof Row & string>(column: K, value: unknown): this {
    return this.where(column, '>=', value);
  }
  lt<K extends keyof Row & string>(column: K, value: unknown): this {
    return this.where(column, '<', value);
  }
  lte<K extends keyof Row & string>(column: K, value: unknown): this {
    return this.where(column, '<=', value);
  }
  is<K extends keyof Row & string>(column: K, value: null | boolean): this {
    if (value === null) this.filters.push({ sql: `${this.col(column)} IS NULL`, params: [] });
    else this.filters.push({ sql: `${this.col(column)} IS ?`, params: [value ? 1 : 0] });
    return this;
  }
  in<K extends keyof Row & string>(column: K, values: readonly unknown[]): this {
    if (values.length === 0) {
      this.filters.push({ sql: '0', params: [] });
      return this;
    }
    this.filters.push({
      sql: `${this.col(column)} IN (${values.map(() => '?').join(',')})`,
      params: values.map((v) => toSql(this.meta, column, v)),
    });
    return this;
  }
  /** Sous-ensemble PostgREST : not(col, 'in', '(a,b)'), not(col, 'is', null), not(col, 'eq', v). */
  not<K extends keyof Row & string>(column: K, operator: 'in' | 'is' | 'eq', value: unknown): this {
    if (operator === 'is' && value === null) {
      this.filters.push({ sql: `${this.col(column)} IS NOT NULL`, params: [] });
    } else if (operator === 'in') {
      const items = String(value).replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
      // Comme Postgres, NULL NOT IN (...) est inconnu : la ligne est exclue.
      this.filters.push(
        items.length > 0
          ? { sql: `${this.col(column)} NOT IN (${items.map(() => '?').join(',')})`, params: items }
          : { sql: `${this.col(column)} IS NOT NULL`, params: [] },
      );
    } else {
      this.filters.push({ sql: `${this.col(column)} <> ?`, params: [toSql(this.meta, column, value)] });
    }
    return this;
  }

  /** Sous-ensemble PostgREST : or('col.eq.valeur,col.is.null,...') avec eq, neq, is. */
  or(expression: string): this {
    const parts = expression.split(',').map((p) => p.trim()).filter(Boolean);
    const sql: string[] = [];
    const params: unknown[] = [];
    for (const part of parts) {
      const match = /^([a-z_][a-z0-9_]*)\.(eq|neq|is)\.(.*)$/.exec(part);
      if (!match) throw new DbQueryError(`Filtre or() non pris en charge : ${part}`, '42601');
      const [, column, op, raw] = match;
      if (op === 'is') {
        if (raw !== 'null') throw new DbQueryError(`Filtre or() non pris en charge : ${part}`, '42601');
        sql.push(`${this.col(column)} IS NULL`);
      } else {
        sql.push(`${this.col(column)} ${op === 'eq' ? '=' : '<>'} ?`);
        params.push(toSql(this.meta, column, raw === 'true' ? true : raw === 'false' ? false : raw));
      }
    }
    if (sql.length) this.filters.push({ sql: `(${sql.join(' OR ')})`, params });
    return this;
  }

  order(column: keyof Row & string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    const ascending = options?.ascending ?? true;
    // Postgres : NULLS LAST en ordre croissant, NULLS FIRST en ordre décroissant.
    this.orders.push({ column, ascending, nullsFirst: options?.nullsFirst ?? !ascending });
    return this;
  }
  limit(count: number): this {
    this.limitValue = Math.max(0, Math.floor(count));
    return this;
  }

  single(): QueryBuilder<Row, Row> {
    this.mode = 'single';
    return this as unknown as QueryBuilder<Row, Row>;
  }
  maybeSingle(): QueryBuilder<Row, Row | null> {
    this.mode = 'maybeSingle';
    return this as unknown as QueryBuilder<Row, Row | null>;
  }

  // --- Exécution ------------------------------------------------------------------

  then<A = DbResult<Result>, B = never>(
    onfulfilled?: ((value: DbResult<Result>) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<DbResult<Result>> {
    try {
      const { rows, count } = await this.run();
      return this.shape(rows, count);
    } catch (error) {
      const err = toDbError(error);
      if (err.code === 'XX000') console.error(`[db] ${this.op} ${this.table}`, err.message);
      return { data: null as Result, error: err, count: null, status: 400 };
    }
  }

  private shape(rows: Row[], count: number | null): DbResult<Result> {
    const writeWithoutReturn = this.op !== 'select' && !this.returning;
    if (writeWithoutReturn) return { data: null as Result, error: null, count, status: 204 };
    if (this.mode === 'many') return { data: (this.head ? null : rows) as Result, error: null, count, status: 200 };
    if (rows.length > 1) {
      return { data: null as Result, error: { message: 'Plusieurs lignes renvoyées', code: 'PGRST116' }, count, status: 406 };
    }
    if (rows.length === 0 && this.mode === 'single') {
      return { data: null as Result, error: { message: 'Aucune ligne renvoyée', code: 'PGRST116' }, count, status: 406 };
    }
    return { data: (rows[0] ?? null) as Result, error: null, count, status: 200 };
  }

  private selectList(): string {
    const trimmed = this.columns.trim();
    if (trimmed === '*' || trimmed === '') return `${ident(this.table)}.*`;
    return trimmed
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => this.col(c))
      .join(', ');
  }

  private whereClause(using: ((col: ColumnRef) => string) | null): { sql: string; params: unknown[] } {
    const parts = this.filters.map((f) => f.sql);
    const params = this.filters.flatMap((f) => f.params);
    if (using) parts.push(using((c) => this.col(c)));
    return { sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', params };
  }

  private parse(rows: Record<string, unknown>[]): Row[] {
    return rows.map((r) => fromSql<Row>(this.meta, r));
  }

  private async run(): Promise<{ rows: Row[]; count: number | null }> {
    switch (this.op) {
      case 'select':
        return this.runSelect();
      case 'insert':
      case 'upsert':
        return { rows: await this.runInsert(), count: null };
      case 'update':
        return { rows: await this.runUpdate(), count: null };
      case 'delete':
        return { rows: await this.runDelete(), count: null };
    }
  }

  private async runSelect(): Promise<{ rows: Row[]; count: number | null }> {
    const policy = policyFor(this.table, 'select', this.ctx);
    const where = this.whereClause(policy.using);
    let count: number | null = null;
    if (this.countMode === 'exact') {
      const res = await this.db
        .prepare(`SELECT count(*) AS n FROM ${ident(this.table)}${where.sql}`)
        .bind(...where.params)
        .all<{ n: number }>();
      count = Number(res.results[0]?.n ?? 0);
    }
    if (this.head) return { rows: [], count };
    let sql = `SELECT ${this.selectList()} FROM ${ident(this.table)}${where.sql}`;
    if (this.orders.length) {
      sql += ` ORDER BY ${this.orders
        .map((o) => `${this.col(o.column)} ${o.ascending ? 'ASC' : 'DESC'} NULLS ${o.nullsFirst ? 'FIRST' : 'LAST'}`)
        .join(', ')}`;
    }
    const params = [...where.params];
    // single() sans limite : on lit 2 lignes pour détecter l'ambiguïté.
    const limit = this.limitValue ?? (this.mode === 'many' ? null : 2);
    if (limit !== null) {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    const res = await this.db.prepare(sql).bind(...params).all<Record<string, unknown>>();
    return { rows: this.parse(res.results), count };
  }

  private prepareRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (v !== undefined) out[k] = v;
    for (const g of this.meta.generated ?? []) if (out[g] === undefined || out[g] === null) out[g] = crypto.randomUUID();
    return out;
  }

  private returningClause(): string {
    return this.returning ? ` RETURNING ${this.columns.trim() === '*' ? '*' : this.columns.split(',').map((c) => ident(c.trim())).join(', ')}` : '';
  }

  private async runInsert(): Promise<Row[]> {
    if (this.values.length === 0) return [];
    const insertPolicy = policyFor(this.table, 'insert', this.ctx);
    const updatePolicy = this.op === 'upsert' ? policyFor(this.table, 'update', this.ctx) : null;
    const statements: SqlStatement[] = [];

    for (const raw of this.values) {
      const row = this.prepareRow(raw);
      const columns = Object.keys(row);
      if (columns.length === 0) throw new DbQueryError('Insertion vide', '22023');
      const params = columns.map((c) => toSql(this.meta, c, row[c]));
      let sql = `INSERT INTO ${ident(this.table)} (${columns.map(ident).join(', ')}) SELECT ${columns.map(() => '?').join(', ')}`;

      if (insertPolicy.check) {
        // Chaque référence de colonne devient la valeur proposée.
        const checkParams: unknown[] = [];
        const check = insertPolicy.check((c) => {
          checkParams.push(c in row ? toSql(this.meta, c, row[c]) : null);
          return '?';
        });
        sql += ` WHERE ${enforce(check)}`;
        params.push(...checkParams);
      } else {
        sql += ' WHERE 1';
      }

      if (this.op === 'upsert' && this.onConflict) {
        const conflict = this.onConflict;
        conflict.forEach((c) => ident(c));
        // Les identifiants générés ne remplacent jamais ceux d'une ligne existante.
        const provided = Object.keys(raw).filter((c) => raw[c] !== undefined);
        const updatable = provided.filter((c) => !conflict.includes(c));
        this.assertClubColumns(updatable);
        if (updatable.length === 0) {
          sql += ` ON CONFLICT (${conflict.map(ident).join(', ')}) DO NOTHING`;
        } else {
          sql += ` ON CONFLICT (${conflict.map(ident).join(', ')}) DO UPDATE SET ${updatable
            .map((c) => `${ident(c)} = excluded.${ident(c)}`)
            .join(', ')}`;
          const guards: string[] = [];
          if (updatePolicy?.using) guards.push(updatePolicy.using((c) => this.col(c)));
          if (updatePolicy?.check) guards.push(enforce(updatePolicy.check((c) => `excluded.${ident(c)}`)));
          if (guards.length) sql += ` WHERE ${guards.join(' AND ')}`;
        }
      } else if (this.op === 'insert') {
        this.assertClubColumns(columns, true);
      }
      sql += this.returningClause();
      statements.push(this.db.prepare(sql).bind(...params));
    }

    const results = statements.length === 1 ? [await statements[0].all()] : await this.db.batch(statements);
    return this.parse(results.flatMap((r) => (r.results ?? []) as Record<string, unknown>[]));
  }

  /** Un utilisateur ne modifie pas l'offre, Stripe ou le statut d'un club (ancien GRANT UPDATE). */
  private assertClubColumns(columns: string[], isInsert = false) {
    if (this.table !== 'clubs' || this.ctx.role !== 'authenticated' || isInsert) return;
    const forbidden = columns.filter((c) => !CLUB_USER_UPDATABLE.has(c));
    if (forbidden.length) throw new DbQueryError(`Colonnes non modifiables : ${forbidden.join(', ')}`, '42501');
  }

  private async runUpdate(): Promise<Row[]> {
    const values = this.prepareUpdate(this.values[0] ?? {});
    const columns = Object.keys(values);
    if (columns.length === 0) return [];
    this.assertClubColumns(columns);
    const policy = policyFor(this.table, 'update', this.ctx);
    const setParams = columns.map((c) => toSql(this.meta, c, values[c]));
    const where = this.whereClause(policy.using);
    const params = [...setParams, ...where.params];
    let whereSql = where.sql;
    if (policy.check) {
      const checkParams: unknown[] = [];
      const check = policy.check((c) => {
        if (c in values) {
          checkParams.push(toSql(this.meta, c, values[c]));
          return '?';
        }
        return this.col(c);
      });
      whereSql += `${whereSql ? ' AND ' : ' WHERE '}${enforce(check)}`;
      params.push(...checkParams);
    }
    if (this.filters.length === 0) throw new DbQueryError('Mise à jour sans filtre refusée', '21000');
    const sql = `UPDATE ${ident(this.table)} SET ${columns.map((c) => `${ident(c)} = ?`).join(', ')}${whereSql}${this.returningClause()}`;
    const res = await this.db.prepare(sql).bind(...params).all<Record<string, unknown>>();
    return this.parse(res.results);
  }

  private prepareUpdate(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (v !== undefined) out[k] = v;
    return out;
  }

  private async runDelete(): Promise<Row[]> {
    if (this.filters.length === 0) throw new DbQueryError('Suppression sans filtre refusée', '21000');
    const policy = policyFor(this.table, 'delete', this.ctx);
    const where = this.whereClause(policy.using);
    const sql = `DELETE FROM ${ident(this.table)}${where.sql}${this.returningClause()}`;
    const res = await this.db.prepare(sql).bind(...where.params).all<Record<string, unknown>>();
    return this.parse(res.results);
  }
}

export type TypedFrom = <T extends keyof Tables & TableName>(table: T) => QueryBuilder<RowOf<T>> & {
  insert(values: InsertOf<T> | InsertOf<T>[]): QueryBuilder<RowOf<T>, null>;
  upsert(values: InsertOf<T> | InsertOf<T>[], options?: { onConflict?: string }): QueryBuilder<RowOf<T>, null>;
  update(values: UpdateOf<T>): QueryBuilder<RowOf<T>, null>;
};

export function makeFrom(db: SqlDatabase, ctx: SecurityContext): TypedFrom {
  return ((table: string) => {
    if (!isTableName(table)) throw new DbQueryError(`Table inconnue : ${table}`, '42P01');
    return new QueryBuilder(db, table, ctx);
  }) as TypedFrom;
}
