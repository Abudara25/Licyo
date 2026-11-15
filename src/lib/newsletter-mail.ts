import 'server-only';
import { createElement } from 'react';
import { createAdminClient } from '@/lib/db/admin';
import { appUrl } from '@/lib/env';
import { sendClubEmail } from '@/lib/email/mailer';
import { NewsletterEmail } from '@/lib/email/templates';
import { parseBody, type DeliveryToSend } from '@/lib/newsletter';
import type { Club } from '@/types/database';

/** Lien de désinscription : servi par la plateforme (même lien quel que soit le domaine du club). */
export function unsubscribeLink(token: string): string {
  return `${appUrl()}/newsletter/desinscription/${encodeURIComponent(token)}`;
}

/**
 * Envoie un exemplaire de la newsletter (module serveur uniquement). En-têtes List-Unsubscribe (RFC 8058) : les
 * messageries proposent alors un bouton « Se désabonner » qui désinscrit en un clic, sans ouvrir de page.
 */
export function makeNewsletterSender(): (d: DeliveryToSend) => Promise<void> {
  // Cache limité à une exécution (une tâche planifiée) : jamais partagé entre requêtes.
  const clubs = new Map<string, Club>();
  return (d) => sendNewsletterDelivery(d, clubs);
}

export async function sendNewsletterDelivery(d: DeliveryToSend, clubs = new Map<string, Club>()): Promise<void> {
  let club = clubs.get(d.newsletter.club_id);
  if (!club) {
    const { data } = await createAdminClient().from('clubs').select('*').eq('id', d.newsletter.club_id).maybeSingle();
    if (!data) throw new Error('club introuvable');
    club = data;
    clubs.set(club.id, club);
  }
  const link = unsubscribeLink(d.unsubscribeToken);
  await sendClubEmail({
    club,
    to: d.email,
    subject: d.newsletter.subject,
    kind: 'newsletter',
    headers: {
      'List-Unsubscribe': `<${appUrl()}/api/newsletter/unsubscribe?t=${encodeURIComponent(d.unsubscribeToken)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    reactComponent: createElement(NewsletterEmail, {
      club,
      firstName: d.firstName,
      subject: d.newsletter.subject,
      blocks: parseBody(d.newsletter.body),
      unsubscribeLink: link,
    }),
  });
}
