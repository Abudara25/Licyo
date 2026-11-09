import 'server-only';
import type { ReactElement } from 'react';
import { render } from '@react-email/components';
import { createAdminClient } from '@/lib/db/admin';
import { cloudflareEnv } from '@/lib/db/d1';
import { decryptSecret } from '@/lib/utils/crypto';
import type { Club } from '@/types/database';
import { accessTokenFromRefresh, gmailSendRaw } from './google';
import { buildMime, toBase64Url } from './mime';

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

type MailClub = Pick<Club, 'id' | 'name' | 'contact_email' | 'email_provider' | 'email_sender_address'>;

export type SendResult = { provider: 'gmail' | 'platform' | 'log'; messageId?: string };

/** Interdit les hôtes SMTP internes (localhost, réseaux privés) : pas de rebond réseau. */
export function isAllowedSmtpHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return false;
  return !/(^|\.)(localhost|local|internal)$/.test(h);
}

/** Nom d'affichage sans caractère pouvant casser l'en-tête From. */
function displayName(name: string): string {
  return name.replace(/["\r\n<>]/g, '').slice(0, 80);
}

async function loadCredentials(clubId: string) {
  const { data } = await createAdminClient().from('club_mail_credentials').select('*').eq('club_id', clubId).maybeSingle();
  return data;
}

/**
 * Envoi par la plateforme (Cloudflare Email Service).
 * Sans domaine d'envoi configuré (phase de test), le message est seulement
 * journalisé : visible dans `wrangler tail` ou la console de développement.
 */
export async function sendPlatformEmail(msg: {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  replyTo?: string;
}): Promise<SendResult> {
  const from = process.env.EMAIL_FROM_ADDRESS;
  const binding = cloudflareEnv().EMAIL;
  if (!from || !binding) {
    console.log(`[mailer:journal] à ${msg.to} — ${msg.subject}\n${msg.text}`);
    return { provider: 'log' };
  }
  const res = (await binding.send({
    from: { email: from, name: displayName(msg.fromName ?? 'Licyo') },
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
  })) as { messageId?: string } | undefined;
  return { provider: 'platform', messageId: res?.messageId };
}

/**
 * Routeur d'envoi d'un club :
 * 1. Gmail (OAuth) si le club a connecté son compte Google ;
 * 2. plateforme, avec Reply-To vers l'adresse du club.
 * Le SMTP privé n'est pas utilisable sur Cloudflare Workers (pas de SMTP sortant
 * standard) : les réglages restent enregistrés mais l'envoi passe par la plateforme.
 * En cas d'échec de Gmail, repli sur la plateforme pour ne pas perdre un e-mail
 * transactionnel (lien de correction, convocation).
 */
export async function sendClubEmail({
  club,
  to,
  subject,
  reactComponent,
  replyTo,
}: {
  club: MailClub;
  to: string;
  subject: string;
  reactComponent: ReactElement;
  replyTo?: string;
}): Promise<SendResult> {
  const html = await render(reactComponent);
  const text = await render(reactComponent, { plainText: true });
  const name = displayName(club.name);
  const reply = replyTo ?? club.contact_email;

  if (club.email_provider === 'gmail') {
    try {
      const creds = await loadCredentials(club.id);
      if (creds?.google_refresh_token_enc) {
        const accessToken = await accessTokenFromRefresh(decryptSecret(creds.google_refresh_token_enc));
        const from = creds.google_account_email ?? club.email_sender_address ?? club.contact_email;
        const raw = buildMime({ from: { name, address: from }, to, subject, html, text, replyTo: reply });
        return { provider: 'gmail', messageId: await gmailSendRaw(accessToken, toBase64Url(raw)) };
      }
    } catch (error) {
      console.error(`[mailer] envoi gmail échoué pour le club ${club.id}, repli plateforme`, error instanceof Error ? error.message : error);
    }
  }

  return sendPlatformEmail({ to, subject, html, text, fromName: name, replyTo: reply });
}

/** Envoi sans bloquer l'action en cours : l'échec est journalisé, pas propagé. */
export async function sendClubEmailSafely(args: Parameters<typeof sendClubEmail>[0]): Promise<boolean> {
  try {
    await sendClubEmail(args);
    return true;
  } catch (error) {
    console.error('[mailer] e-mail non envoyé', error instanceof Error ? error.message : error);
    return false;
  }
}
