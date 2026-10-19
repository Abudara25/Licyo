// Journal des actions des comptes dans le club (permission users.manage) : connexions, invitations, rôles, et chaque
// formulaire envoyé dans l'admin (chemin et action, jamais le contenu). Organisation de la session uniquement.
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, formatDateFr } from '../_shared/admin-auth.js';
import { ensureSchema } from '../_shared/inscriptions-db.js';
import { listAudit } from '../_shared/accounts.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

const LABELS = {
  connexion: 'Connexion',
  'utilisateur.invitation': 'Invitation envoyée',
  'utilisateur.invitation-renvoyee': 'Invitation renvoyée',
  'utilisateur.invitation-acceptee': 'Invitation acceptée',
  'utilisateur.retrait': 'Accès retiré',
  'utilisateur.premier-responsable': 'Premier responsable créé',
  'compte.mot-de-passe': 'Mot de passe changé',
  'compte.nom': 'Nom modifié',
  'compte.reinitialisation-demandee': 'Nouveau mot de passe demandé',
  'compte.mot-de-passe-reinitialise': 'Mot de passe réinitialisé',
};

function label(action) {
  if (LABELS[action]) return LABELS[action];
  if (action.startsWith('utilisateur.role:')) return `Rôle changé (${action.slice(17)})`;
  return action;
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  await ensureSchema(env.DB);
  const rows = await listAudit(env.DB, admin.organizationId, { limit: 200 });
  const badges = await adminBadges(env, admin);
  const lines = rows
    .map(
      (r) => `<tr><td>${escapeHtml(formatDateFr(r.created_at, { dateStyle: 'short', timeStyle: 'short' }) || r.created_at)}</td><td>${escapeHtml(r.name || r.email || '—')}</td><td>${escapeHtml(label(r.action))}</td><td>${escapeHtml(r.target || '')}</td></tr>`
    )
    .join('');
  return html(`${adminHead('Journal des actions')}
${adminShell({ active: 'utilisateurs', badges, eyebrow: 'Utilisateurs', title: 'Journal des actions', subtitle: 'Les 200 dernières actions des comptes du club, conservées 400 jours.', back: { href: '/admin/utilisateurs', label: 'Utilisateurs' } })}
<main id="adm-main" class="adm-wrap adm-main">
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('activity')}Actions</h2>
    ${rows.length ? `<table class="adm-audit"><thead><tr><th>Date</th><th>Compte</th><th>Action</th><th>Cible</th></tr></thead><tbody>${lines}</tbody></table>` : '<p class="adm-help">Aucune action enregistrée.</p>'}
  </section>
</main>
${adminScripts('admin-nav')}
</body></html>`);
}
