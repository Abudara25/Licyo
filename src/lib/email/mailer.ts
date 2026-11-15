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

/** Types d'e-mails tracés dans le journal (email_log.kind). */
export type EmailKind =
  | 'inscription_recue'
  | 'inscription_validee'
  | 'correction_demandee'
  | 'convocation'
  | 'essai'
  | 'reinscription'
  | 'paiement_recu'
  | 'preinscription_recue'
  | 'preinscription_invitation'
  | 'test'
  | 'autre';

/** Message d'erreur court et sans donnée sensible pour le journal. */
function shortError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/[\r\n]+/g, ' ').replace(/(token|key|secret|password)=\S+/gi, '$1=…').slice(0, 300);
}

/**
 * Inscrit un envoi dans le journal du club. Ne fait jamais échouer l'envoi : une panne du journal est seulement
 * signalée dans les journaux du Worker.
 */
async function logEmail(entry: {
  clubId: string;
  kind: EmailKind;
  to: string;
  subject: string;
  provider: 'gmail' | 'platform' | 'log' | 'none';
  status: 'sent' | 'logged' | 'failed';
  error?: string;
}): Promise<void> {
  try {
    await createAdminClient().from('email_log').insert({
      club_id: entry.clubId,
      kind: entry.kind,
      recipient: entry.to.trim().toLowerCase().slice(0, 254),
      subject: entry.subject.slice(0, 200),
      provider: entry.provider,
      status: entry.status,
      error: entry.error ?? null,
    });
  } catch (error) {
    console.error('[mailer] journal des e-mails indisponible', shortError(error));
  }
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
export async function sendClubEmail(args: {
  club: MailClub;
  to: string;
  subject: string;
  reactComponent: ReactElement;
  replyTo?: string;
  /** Type d'e-mail pour le journal du club. */
  kind?: EmailKind;
}): Promise<SendResult> {
  const kind = args.kind ?? 'autre';
  try {
    const result = await deliverClubEmail(args);
    await logEmail({
      clubId: args.club.id,
      kind,
      to: args.to,
      subject: args.subject,
      provider: result.provider,
      status: result.provider === 'log' ? 'logged' : 'sent',
    });
    return result;
  } catch (error) {
    await logEmail({ clubId: args.club.id, kind, to: args.to, subject: args.subject, provider: 'none', status: 'failed', error: shortError(error) });
    throw error;
  }
}

async function deliverClubEmail({
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
