import 'server-only';
import { appUrl } from '@/lib/env';
import { sendPlatformEmail } from '@/lib/email/mailer';
import { createLoginToken } from './session';
import { safeNextPath } from './tokens';

/** Lien de connexion vers /auth/callback, valable 15 minutes, usage unique. */
export function loginUrl(token: string, next: string): string {
  return `${appUrl()}/auth/callback?token=${encodeURIComponent(token)}&next=${encodeURIComponent(safeNextPath(next))}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Envoie un lien de connexion (aussi utilisé pour les invitations d'équipe). */
export async function sendLoginLink(email: string, next: string, createUser: boolean, intro = 'Pour vous connecter à Licyo'): Promise<void> {
  const url = loginUrl(await createLoginToken(email, createUser), next);
  await sendPlatformEmail({
    to: email,
    subject: 'Votre lien de connexion Licyo',
    text: `Bonjour,\n\n${intro}, ouvrez ce lien (valable 15 minutes, une seule fois) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    html: `<p>Bonjour,</p><p>${escapeHtml(intro)}, ouvrez ce lien (valable 15 minutes, une seule fois) :</p><p><a href="${escapeHtml(url)}">Se connecter</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>`,
  });
}
