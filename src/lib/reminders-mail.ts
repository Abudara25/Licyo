import 'server-only';
import { createElement } from 'react';
import { createAdminClient } from '@/lib/db/admin';
import { clubSiteUrl } from '@/lib/env';
import { sendClubEmail } from '@/lib/email/mailer';
import { ReminderEmail } from '@/lib/email/templates';
import { formatEuros } from '@/lib/pricing';
import { parseReminderPolicy, type PlannedReminder } from '@/lib/reminders';

const KIND = { documents: 'relance_pieces', correction: 'relance_correction', payment: 'relance_paiement' } as const;
const SUBJECT = { documents: 'Dossier à compléter', correction: 'Pièce à remplacer', payment: 'Règlement en attente' } as const;

/**
 * Envoie une relance planifiée (src/lib/reminders.ts). Module serveur uniquement, jamais exposé au navigateur.
 * Pièces et correction : lien personnel de complément du dossier (/correction/<jeton>), sans connexion.
 */
export async function sendReminder(r: PlannedReminder): Promise<void> {
  const { data: club } = await createAdminClient().from('clubs').select('*').eq('id', r.clubId).maybeSingle();
  if (!club) throw new Error('club introuvable');
  const totalSteps = parseReminderPolicy(club.reminder_policy).delaysDays.length;
  await sendClubEmail({
    club,
    to: r.recipient,
    subject: `${SUBJECT[r.kind]} - ${r.subject || club.name}`,
    kind: KIND[r.kind],
    reactComponent: createElement(ReminderEmail, {
      club,
      firstName: r.firstName || 'Madame, Monsieur',
      kind: r.kind,
      personName: r.subject,
      details: r.details,
      link: r.kind !== 'payment' && r.token ? `${clubSiteUrl(club)}/correction/${r.token}` : undefined,
      amountDue: r.amountDue !== undefined ? formatEuros(r.amountDue) : undefined,
      step: r.step,
      totalSteps,
    }),
  });
}
