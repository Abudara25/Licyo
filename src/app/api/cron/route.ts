import { createAdminClient } from '@/lib/db/admin';
import { getDatabase } from '@/lib/db/d1';
import { TASKS, daily, runScheduledTasks, sameSecret, type Task } from '@/lib/scheduled';
import { workerVar } from '@/lib/secrets';
import { runWaitlistMaintenance } from '@/lib/waitlist';
import { sendInvitationEmail } from '@/lib/waitlist-mail';
import { runReminders } from '@/lib/reminders';
import { sendReminder } from '@/lib/reminders-mail';
import { processNewsletters } from '@/lib/newsletter';
import { makeNewsletterSender } from '@/lib/newsletter-mail';
import { runRetention } from '@/lib/retention';
import { deletePrivateFilesVerified } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liste d'attente : invitations expirées rendues, places libres proposées aux suivants (catégories en automatique). */
const waitlistTask: Task = {
  name: 'liste_attente',
  slot: daily,
  run: (db, now) =>
    runWaitlistMaintenance(db, now, async (row, token, expiresAt) => {
      const { data: club } = await createAdminClient().from('clubs').select('*').eq('id', row.club_id).maybeSingle();
      if (!club) throw new Error('club introuvable');
      await sendInvitationEmail(club, row, token, expiresAt);
    }),
};

/** Relances des dossiers incomplets, pour les clubs qui les ont activées (src/lib/reminders.ts). */
const remindersTask: Task = {
  name: 'relances',
  slot: daily,
  run: (db, now) => runReminders(db, now, sendReminder),
};

/** Newsletter : messages programmés préparés puis envoyés par lots, à chaque quart d'heure. */
const newsletterTask: Task = {
  name: 'newsletter',
  slot: (now) => `${now.toISOString().slice(0, 14)}${String(Math.floor(now.getUTCMinutes() / 15) * 15).padStart(2, '0')}`,
  run: (db, now) => processNewsletters(db, now, makeNewsletterSender()),
};

/** Conservation RGPD : durées choisies par chaque club (src/lib/retention.ts), fichiers R2 supprimés et vérifiés. */
const retentionTask: Task = {
  name: 'conservation',
  slot: daily,
  run: (db, now) => runRetention(db, now, deletePrivateFilesVerified),
};

/**
 * Point d'entrée des tâches planifiées. Appelé par le Cron Trigger du Worker (worker.ts, `scheduled`) avec
 * « Authorization: Bearer <CRON_SECRET> ». Sans secret configuré, la route est fermée.
 * Réponse : le résultat de chaque tâche (chiffres seulement) ; 500 si l'une d'elles a échoué.
 */
export async function POST(req: Request) {
  const expected = workerVar('CRON_SECRET') ?? '';
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!expected || !sameSecret(given, expected)) return new Response('Accès refusé', { status: 401 });

  // Déclenchement des 15 minutes : newsletter seulement. Déclenchement quotidien (ou appel manuel) : toutes les tâches.
  const frequent = req.headers.get('x-licyo-cron') === '*/15 * * * *';
  const tasks = frequent ? [newsletterTask] : [...TASKS, waitlistTask, remindersTask, newsletterTask, retentionTask];
  const results = await runScheduledTasks(getDatabase(), new Date(), tasks);
  const failed = results.filter((r) => r.status === 'failed');
  for (const r of results) console.log(`[cron] ${r.task} : ${r.status} - ${r.detail}`);
  return Response.json({ ok: failed.length === 0, results }, { status: failed.length ? 500 : 200, headers: { 'Cache-Control': 'no-store' } });
}
