import { makeFrom, type DbResult, type SqlDatabase, type TypedFrom } from './query.ts';
import type { SecurityContext } from './policies.ts';
import { callRpc } from './rpc.ts';

export type DbClient = {
  from: TypedFrom;
  rpc: <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<DbResult<T>>;
  /** Contexte de sécurité appliqué à toutes les requêtes de ce client. */
  readonly context: SecurityContext;
};

export function makeClient(db: SqlDatabase, ctx: SecurityContext): DbClient {
  return {
    from: makeFrom(db, ctx),
    rpc: <T>(name: string, args?: Record<string, unknown>) => callRpc(db, ctx, name, args) as Promise<DbResult<T>>,
    context: ctx,
  };
}
