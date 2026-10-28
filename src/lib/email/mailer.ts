import 'server-only';
import type { ReactElement } from 'react';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { google } from 'googleapis';
import { render } from '@react-email/components';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/utils/crypto';
import { requireEnv } from '@/lib/env';
import type { Club } from '@/types/database';

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

type MailClub = Pick<Club, 'id' | 'name' | 'contact_email' | 'email_provider' | 'email_sender_address'>;

export type SendResult = { provider: 'gmail' | 'smtp' | 'platform'; messageId?: string };

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
 * Routeur d'envoi d'un club :
 * 1. Gmail (OAuth) si le club a connecté son compte Google ;
 * 2. SMTP privé du club (OVH, Infomaniak…) ;
 * 3. SMTP de la plateforme, avec Reply-To vers l'adresse du club.
 * En cas d'échec des modes 1 ou 2, on retombe sur la plateforme pour ne pas
 * perdre un e-mail transactionnel (lien de correction, convocation).
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

  if (club.email_provider !== 'platform') {
    const creds = await loadCredentials(club.id);
    try {
      if (club.email_provider === 'gmail' && creds?.google_refresh_token_enc) {
        const oauth2Client = new google.auth.OAuth2(requireEnv('GOOGLE_CLIENT_ID'), requireEnv('GOOGLE_CLIENT_SECRET'));
        oauth2Client.setCredentials({ refresh_token: decryptSecret(creds.google_refresh_token_enc) });
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const from = creds.google_account_email ?? club.email_sender_address ?? club.contact_email;
        // MailComposer produit un message RFC 822 correct (encodage UTF-8 des en-têtes, multipart texte + HTML).
        const raw = await new MailComposer({ from: { name, address: from }, to, subject, html, text, replyTo: reply }).compile().build();
        const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: raw.toString('base64url') } });
        return { provider: 'gmail', messageId: res.data.id ?? undefined };
      }
      if (club.email_provider === 'smtp' && creds?.smtp_settings_enc) {
        const smtp = JSON.parse(decryptSecret(creds.smtp_settings_enc)) as SmtpSettings;
        if (!isAllowedSmtpHost(smtp.host)) throw new Error('Hôte SMTP refusé');
        const transporter = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: { user: smtp.user, pass: smtp.pass } });
        const info = await transporter.sendMail({ from: { name, address: smtp.user }, to, subject, html, text, replyTo: reply });
        return { provider: 'smtp', messageId: info.messageId };
      }
    } catch (error) {
      console.error(`[mailer] envoi ${club.email_provider} échoué pour le club ${club.id}, repli plateforme`, error instanceof Error ? error.message : error);
    }
  }

  const transporter = nodemailer.createTransport({
    host: requireEnv('SMTP_HOST'),
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: Number(process.env.SMTP_PORT ?? 465) === 465,
    auth: { user: requireEnv('SMTP_USER'), pass: requireEnv('SMTP_PASSWORD') },
  });
  const info = await transporter.sendMail({ from: { name, address: requireEnv('SMTP_USER') }, to, subject, html, text, replyTo: reply });
  return { provider: 'platform', messageId: info.messageId };
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
