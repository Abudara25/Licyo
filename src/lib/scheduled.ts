// Tâches planifiées de la plateforme (Cron Trigger du Worker → POST /api/cron, voir worker.ts).
//
// Principes repris du CRM de Saint-Gratien FC :
// - chaque tâche est INDÉPENDANTE : une panne n'empêche pas les autres de tourner ;
// - un verrou par créneau (scheduled_runs, unique (task, slot)) : deux déclenchements du même créneau ne lancent la
//   tâche qu'une fois (reprise du Worker, double appel manuel) ;
// - chaque exécution laisse une trace (statut, détail chiffré, sans donnée personnelle).
//
// Module sans dépendance à Next.js : testé directement sur SQLite (tests/scheduled.test.ts).

import type { SqlDatabase } from './db/query.ts';

export type TaskOutcome = { task: string; status: 'ok' | 'failed' | 'skipped'; detail: string };

type Task = {
  name: string;
  /** Créneau d'exécution : une exécution au plus par créneau. */
  slot: (now: Date) => string;
  run: (db: SqlDatabase, now: Date) => Promise<string>;
};

const DAY = 24 * 3600 * 1000;
const iso = (d: Date) => d.toISOString();
const daily = (now: Date) => now.toISOString().slice(0, 10);

/** Durées de conservation appliquées par la purge. */
export const RETENTION = {
  emailLogDays: 396, // 13 mois : répondre à « je n'ai rien reçu » sur une saison complète
  scheduledRunsDays: 90,
  rateLimitsDays: 2,
  loginTokensDays: 1, // après expiration
  sessionsDays: 0, // dès expiration
} as const;

async function deleteOlderThan(db: SqlDatabase, sql: string, cutoff: Date): Promise<number> {
  const res = await db.prepare(sql).bind(iso(cutoff)).run();
  return Number(res.meta?.changes ?? 0);
}

export const TASKS: readonly Task[] = [
  {
    name: 'purge',
    slot: daily,
    run: async (db, now) => {
      const t = now.getTime();
      const counts = {
        emails: await deleteOlderThan(db, 'DELETE FROM email_log WHERE created_at < ?', new Date(t - RETENTION.emailLogDays * DAY)),
        executions: await deleteOlderThan(db, "DELETE FROM scheduled_runs WHERE started_at < ? AND status <> 'running'", new Date(t - RETENTION.scheduledRunsDays * DAY)),
        limites: await deleteOlderThan(db, 'DELETE FROM rate_limits WHERE window_start < ?', new Date(t - RETENTION.rateLimitsDays * DAY)),
        liens: await deleteOlderThan(db, 'DELETE FROM auth_login_tokens WHERE expires_at < ?', new Date(t - RETENTION.loginTokensDays * DAY)),
        sessions: await deleteOlderThan(db, 'DELETE FROM auth_sessions WHERE expires_at < ?', new Date(t - RETENTION.sessionsDays * DAY)),
      };
      return Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ');
    },
  },
  {
    // Une exécution restée « running » plus de 2 heures a été interrompue (Worker arrêté) : on la marque en échec
    // pour qu'elle se voie dans le suivi au lieu de rester silencieuse.
    name: 'executions_bloquees',
    slot: daily,
    run: async (db, now) => {
      const res = await db
        .prepare("UPDATE scheduled_runs SET status = 'failed', detail = 'interrompue', finished_at = ? WHERE status = 'running' AND started_at < ?")
        .bind(iso(now), iso(new Date(now.getTime() - 2 * 3600 * 1000)))
        .run();
      return `marquees=${Number(res.meta?.changes ?? 0)}`;
    },
  },
];

function shortDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

/** Lance une tâche une seule fois pour son créneau, en enregistrant son résultat. */
export async function runTask(db: SqlDatabase, task: Task, now: Date): Promise<TaskOutcome> {
  const slot = task.slot(now);
  const id = crypto.randomUUID();
  const claim = await db
    .prepare('INSERT INTO scheduled_runs (id, task, slot, started_at) VALUES (?, ?, ?, ?) ON CONFLICT (task, slot) DO NOTHING')
    .bind(id, task.name, slot, iso(now))
    .run();
  if (Number(claim.meta?.changes ?? 0) === 0) return { task: task.name, status: 'skipped', detail: `déjà lancée (${slot})` };
  try {
    const detail = (await task.run(db, now)).slice(0, 500);
    await db.prepare("UPDATE scheduled_runs SET status = 'ok', detail = ?, finished_at = ? WHERE id = ?").bind(detail, iso(new Date()), id).run();
    return { task: task.name, status: 'ok', detail };
  } catch (error) {
    const detail = shortDetail(error);
    await db
      .prepare("UPDATE scheduled_runs SET status = 'failed', detail = ?, finished_at = ? WHERE id = ?")
      .bind(detail, iso(new Date()), id)
      .run()
      .catch(() => undefined);
    return { task: task.name, status: 'failed', detail };
  }
}

/** Toutes les tâches, indépendamment les unes des autres. */
export async function runScheduledTasks(db: SqlDatabase, now = new Date(), tasks: readonly Task[] = TASKS): Promise<TaskOutcome[]> {
  const out: TaskOutcome[] = [];
  for (const task of tasks) out.push(await runTask(db, task, now));
  return out;
}

/** Comparaison en temps constant du secret d'appel (pas de fuite par la durée de réponse). */
export function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0 && expected.length >= 32;
}
