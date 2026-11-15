import 'server-only';
import { createElement } from 'react';
import { createAdminClient } from '@/lib/db/admin';
import { clubSiteUrl } from '@/lib/env';
import { sendClubEmail } from '@/lib/email/mailer';
import { PreregistrationInvitationEmail } from '@/lib/email/templates';
import type { Club } from '@/types/database';

const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' });

/**
 * E-mail d'invitation d'une demande de la liste d'attente (lien personnel, place réservée jusqu'à expiration).
 * Module serveur uniquement : jamais exposé comme action appelable depuis le navigateur.
 */
export async function sendInvitationEmail(
  club: Club,
  row: { email: string; contact_name: string; first_name: string; last_name: string; category_id: string },
  token: string,
  expiresAt: string,
): Promise<void> {
  const { data: category } = await createAdminClient().from('categories').select('name').eq('id', row.category_id).maybeSingle();
  await sendClubEmail({
    club,
    to: row.email,
    subject: `Une place vous attend - ${club.name}`,
    kind: 'preinscription_invitation',
    reactComponent: createElement(PreregistrationInvitationEmail, {
      club,
      contactName: row.contact_name,
      personName: `${row.first_name} ${row.last_name}`,
      categoryName: category?.name ?? 'la catégorie demandée',
      link: `${clubSiteUrl(club)}/inscription?invitation=${encodeURIComponent(token)}`,
      expiresLabel: dateLabel.format(new Date(expiresAt)),
    }),
  });
}
