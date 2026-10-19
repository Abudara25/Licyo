// Écrire un e-mail depuis l'admin (2026-10-09) : à une famille (depuis sa fiche) ou à un groupe de familles, envoyé
// depuis contact@ (Infomaniak, Brevo en secours) avec l'habillage du club. Un e-mail séparé par famille : personne ne
// voit les adresses des autres. Trois étapes sans boîte de dialogue : formulaire → confirmation (aperçu exact de
// l'e-mail, nombre de familles, essai envoyé au club) → envoi. Chaque envoi est inscrit au journal, relié à la fiche.
import { ensureInscriptionsTable, isInscriptionComplete } from '../_shared/inscriptions-db.js';
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash } from '../_shared/admin-auth.js';
import { getPreinscriptionConfig, ensurePreinscriptionsTable, listPreinscriptions } from '../_shared/preinscriptions.js';
import { mailConfigured, sendClubMessage, buildClubMessage, clubRecipientsFor } from '../_shared/confirmation-email.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

export const MAX_FAMILIES = 150; // plafond Infomaniak : 200 e-mails par 24 h, envois automatiques compris
const SUBJECT_MAX = 150;
const MESSAGE_MAX = 5000;

export const GROUPS = {
  actives: 'Toutes les familles inscrites',
  incompletes: 'Familles dont l’inscription est à compléter',
  completes: 'Familles des adhérents (inscription complète)',
  preinscriptions: 'Familles pré-inscrites',
};

// Familles destinataires, dédoublonnées par e-mail du premier responsable (deux enfants = un seul e-mail).
// destinataire (avec inscriptionId) : un seul responsable de la fiche, désigné par son e-mail (bouton « E-mail » des
// fiches) ; il doit être le responsable 1 ou 2 de cette fiche, sinon introuvable.
// preinscriptionId : la famille d'une pré-inscription (bouton « E-mail » des cartes de /admin/preinscriptions).
export async function resolveFamilies(env, organizationId, { groupe, inscriptionId, preinscriptionId, destinataire = '' }) {
  if (preinscriptionId) {
    await ensurePreinscriptionsTable(env.DB);
    const row = await env.DB.prepare('SELECT * FROM preinscriptions WHERE organization_id = ? AND id = ?').bind(organizationId, preinscriptionId).first();
    if (!row) return null;
    return { label: `Famille de ${row.enfant_prenom} ${row.enfant_nom} (pré-inscription)`, families: [{ row: { ...row, id: null }, inscriptionId: null, children: [`${row.enfant_prenom} ${row.enfant_nom}`] }] };
  }
  if (inscriptionId) {
    await ensureInscriptionsTable(env.DB);
    const found = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(organizationId, inscriptionId).first();
    if (!found) return null;
    const row = destinataire ? onlyGuardian(found, destinataire) : found;
    if (!row) return null;
    if (destinataire) {
      return { label: `${row.parent_prenom} ${row.parent_nom} (${row.email}), responsable de ${row.enfant_prenom} ${row.enfant_nom}`, families: [{ row, inscriptionId: row.id, children: [`${row.enfant_prenom} ${row.enfant_nom}`] }] };
    }
    return { label: `Famille de ${row.enfant_prenom} ${row.enfant_nom}`, families: [{ row, inscriptionId: row.id, children: [`${row.enfant_prenom} ${row.enfant_nom}`] }] };
  }
  let rows = [];
  let label = GROUPS[groupe];
  if (!label) return null;
  if (groupe === 'preinscriptions') {
    const config = await getPreinscriptionConfig(env, organizationId);
    if (!config) return null;
    await ensurePreinscriptionsTable(env.DB);
    rows = (await listPreinscriptions(env.DB, organizationId, config.groupe)).map((r) => ({ ...r, id: null }));
    label = `Familles pré-inscrites ${config.label}`;
  } else {
    await ensureInscriptionsTable(env.DB);
    const { results } = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND archived_at IS NULL ORDER BY id').bind(organizationId).all();
    rows = results.filter((r) => (groupe === 'incompletes' ? !isInscriptionComplete(r) : groupe === 'completes' ? isInscriptionComplete(r) : true));
  }
  const byEmail = new Map();
  for (const row of rows) {
    const key = String(row.email || '').trim().toLowerCase();
    if (!key) continue;
    const child = `${row.enfant_prenom} ${row.enfant_nom}`;
    if (byEmail.has(key)) byEmail.get(key).children.push(child);
    else byEmail.set(key, { row, inscriptionId: row.id, children: [child] });
  }
  return { label, families: [...byEmail.values()] };
}

const sameEmail = (a, b) => Boolean(a) && String(a).trim().toLowerCase() === String(b || '').trim().toLowerCase();
// La fiche réduite à un seul responsable (le second prend la place du premier s'il est visé).
function onlyGuardian(row, email) {
  const none = { parent2_prenom: null, parent2_nom: null, parent2_email: null, parent2_telephone: null };
  if (sameEmail(row.email, email)) return { ...row, ...none };
  if (sameEmail(row.parent2_email, email)) {
    return { ...row, ...none, parent_prenom: row.parent2_prenom, parent_nom: row.parent2_nom, email: row.parent2_email, telephone: row.parent2_telephone };
  }
  return null;
}

function readForm(form) {
  return {
    groupe: String(form.get('groupe') || ''),
    inscriptionId: Number(form.get('inscription')) || null,
    preinscriptionId: Number(form.get('preinscription')) || null,
    destinataire: String(form.get('destinataire') || '').trim(),
    subject: String(form.get('subject') || '').replace(/[\r\n]+/g, ' ').trim(),
    message: String(form.get('message') || '').trim(),
    greet: form.get('greet') === '1',
  };
}

function validate(input) {
  if (!input.subject) return 'Indiquez un objet.';
  if (input.subject.length > SUBJECT_MAX) return `Objet trop long (${SUBJECT_MAX} caractères au plus).`;
  if (!input.message) return 'Écrivez un message.';
  if (input.message.length > MESSAGE_MAX) return `Message trop long (${MESSAGE_MAX} caractères au plus).`;
  return null;
}

const hidden = (input) => `<input type="hidden" name="groupe" value="${escapeHtml(input.groupe)}">
      ${input.inscriptionId ? `<input type="hidden" name="inscription" value="${input.inscriptionId}">` : ''}
      ${input.preinscriptionId ? `<input type="hidden" name="preinscription" value="${input.preinscriptionId}">` : ''}
      ${input.destinataire ? `<input type="hidden" name="destinataire" value="${escapeHtml(input.destinataire)}">` : ''}
      <input type="hidden" name="subject" value="${escapeHtml(input.subject)}">
      <input type="hidden" name="message" value="${escapeHtml(input.message)}">
      <input type="hidden" name="greet" value="${input.greet ? '1' : '0'}">`;

function shell(title, badges, back) {
  return `${adminHead(title)}
${adminShell({ active: 'email', badges, eyebrow: 'Espace admin', title: 'Écrire un e-mail', subtitle: 'Envoyé depuis contact@clubdemo.licyo.fr, une famille à la fois.', back })}`;
}

async function composePage(env, admin, input, { error = null, counts = {}, target = null, badges }) {
  const options = Object.entries(GROUPS)
    .filter(([key]) => key in counts)
    .map(([key, label]) => `<option value="${key}"${input.groupe === key ? ' selected' : ''}>${escapeHtml(label)} (${counts[key]})</option>`)
    .join('');
  const back = input.preinscriptionId ? { href: '/admin/preinscriptions', label: 'Pré-inscriptions' } : target ? { href: `/admin/inscriptions/${input.inscriptionId}`, label: 'Retour à la fiche' } : null;
  return `${shell('Écrire un e-mail', badges, back)}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  ${error ? flash('error', error) : ''}
  <section class="adm-surface">
    <form method="POST" class="adm-email-form">
      <input type="hidden" name="action" value="preview">
      ${
        target
          ? `${input.inscriptionId ? `<input type="hidden" name="inscription" value="${input.inscriptionId}">` : ''}
      ${input.preinscriptionId ? `<input type="hidden" name="preinscription" value="${input.preinscriptionId}">` : ''}
      ${input.destinataire ? `<input type="hidden" name="destinataire" value="${escapeHtml(input.destinataire)}">` : ''}
      <p class="adm-email-to"><span>À</span><strong>${escapeHtml(target)}</strong></p>`
          : `<div class="form-field">
        <label for="email-groupe">Destinataires</label>
        <select id="email-groupe" name="groupe" required>${options}</select>
      </div>`
      }
      <div class="form-field">
        <label for="email-subject">Objet</label>
        <input type="text" id="email-subject" name="subject" maxlength="${SUBJECT_MAX}" value="${escapeHtml(input.subject)}" required>
      </div>
      <div class="form-field">
        <label for="email-message">Message</label>
        <textarea id="email-message" name="message" rows="10" maxlength="${MESSAGE_MAX}" required placeholder="Votre message. Laissez une ligne vide entre deux paragraphes ; les liens commençant par https:// deviennent cliquables.">${escapeHtml(input.message)}</textarea>
      </div>
      <label class="adm-check"><input type="checkbox" name="greet" value="1"${input.greet ? ' checked' : ''}><span>Commencer par « Bonjour [prénom du responsable], »</span></label>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('eye')}Prévisualiser</button></div>
    </form>
  </section>
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

function previewPage(input, resolved, siteUrl, { badges, notice = null }) {
  const first = resolved.families[0];
  const { html: emailHtml } = buildClubMessage(first.row, { subject: input.subject, message: input.message, siteUrl, greet: input.greet });
  const n = resolved.families.length;
  const names = resolved.families.slice(0, 8).map((f) => escapeHtml(f.children.join(', '))).join(' · ');
  return `${shell('Vérifier l’e-mail', badges, null)}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  ${notice ? flash(notice.type, notice.text) : ''}
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('send')}Vérifier avant d’envoyer</h2>
    <p class="adm-email-to"><span>À</span><strong>${escapeHtml(resolved.label)} : ${n} famille${n > 1 ? 's' : ''}</strong></p>
    <p class="adm-help">${names}${n > 8 ? ` · et ${n - 8} autre${n - 8 > 1 ? 's' : ''}` : ''}</p>
    <p class="adm-email-to"><span>Objet</span><strong>${escapeHtml(input.subject)}</strong></p>
    <p class="adm-help">Aperçu tel que la première famille le recevra${n > 1 ? ' (le prénom change pour chaque famille)' : ''} :</p>
    <iframe class="adm-email-preview" title="Aperçu de l’e-mail" sandbox srcdoc="${escapeHtml(emailHtml)}"></iframe>
    <div class="adm-form-actions adm-email-actions">
      <form method="POST" data-once>
        <input type="hidden" name="action" value="send">
        ${hidden(input)}
        <button type="submit" class="adm-btn adm-btn-primary">${icon('send')}Envoyer à ${n} famille${n > 1 ? 's' : ''}</button>
      </form>
      <form method="POST" data-once>
        <input type="hidden" name="action" value="test">
        ${hidden(input)}
        <button type="submit" class="adm-btn adm-btn-ghost">${icon('mail')}M’envoyer un essai</button>
      </form>
      <form method="POST">
        <input type="hidden" name="action" value="edit">
        ${hidden(input)}
        <button type="submit" class="adm-btn adm-btn-ghost">${icon('edit')}Modifier</button>
      </form>
    </div>
    <p class="adm-help">L’essai part aux adresses du club (Paramètres), avec le prénom de la première famille.</p>
  </section>
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

function donePage(input, { sent, failed, label }, badges) {
  return `${shell('E-mail envoyé', badges, null)}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  ${failed.length ? flash('error', `${sent} envoyé${sent > 1 ? 's' : ''}, ${failed.length} en échec : ${failed.join(', ')}.`) : flash('ok', `E-mail « ${input.subject} » envoyé à ${sent} famille${sent > 1 ? 's' : ''} (${label}).`)}
  <section class="adm-surface">
    <p class="adm-help">Chaque envoi figure dans le journal des e-mails${input.inscriptionId ? ' et dans « E-mails envoyés » de la fiche' : ''}.</p>
    <div class="adm-form-actions">
      ${input.inscriptionId ? `<a class="adm-btn adm-btn-ghost" href="/admin/inscriptions/${input.inscriptionId}">${icon('arrowLeft')}Retour à la fiche</a>` : ''}
      ${input.preinscriptionId ? `<a class="adm-btn adm-btn-ghost" href="/admin/preinscriptions">${icon('arrowLeft')}Pré-inscriptions</a>` : ''}
      <a class="adm-btn adm-btn-ghost" href="/admin/events?type=message_club">${icon('activity')}Voir le journal</a>
      <a class="adm-btn adm-btn-primary" href="/admin/email">${icon('send')}Écrire un autre e-mail</a>
    </div>
  </section>
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

async function groupCounts(env, organizationId) {
  const counts = {};
  for (const key of Object.keys(GROUPS)) {
    const resolved = await resolveFamilies(env, organizationId, { groupe: key }).catch(() => null);
    if (resolved) counts[key] = resolved.families.length;
  }
  return counts;
}

async function compose(env, admin, input, error = null, status = 200) {
  const badges = await adminBadges(env, admin);
  if (input.inscriptionId || input.preinscriptionId) {
    const resolved = await resolveFamilies(env, admin.organizationId, input);
    if (!resolved) return html('Fiche ou destinataire introuvable.', 404);
    const target = input.destinataire ? resolved.label : `${resolved.label} (${resolved.families[0].row.email})`;
    return html(await composePage(env, admin, input, { error, target, badges }), status);
  }
  return html(await composePage(env, admin, input, { error, counts: await groupCounts(env, admin.organizationId), badges }), status);
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  const url = new URL(request.url);
  const input = {
    groupe: GROUPS[url.searchParams.get('groupe')] ? url.searchParams.get('groupe') : 'actives',
    inscriptionId: Number(url.searchParams.get('inscription')) || null,
    preinscriptionId: Number(url.searchParams.get('preinscription')) || null,
    destinataire: String(url.searchParams.get('destinataire') || '').trim(),
    subject: '',
    message: '',
    greet: true,
  };
  return compose(env, admin, input);
}

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  const form = await request.formData();
  const action = String(form.get('action') || '');
  const input = readForm(form);
  if (action === 'edit') return compose(env, admin, input);

  const error = validate(input);
  if (error) return compose(env, admin, input, error, 400);
  if (!mailConfigured(env)) return compose(env, admin, input, 'Aucun service d’envoi configuré : aucun e-mail ne peut partir.', 503);
  const resolved = await resolveFamilies(env, admin.organizationId, input);
  if (!resolved) return compose(env, admin, input, 'Destinataires introuvables.', 400);
  if (!resolved.families.length) return compose(env, admin, input, 'Aucune famille dans ce groupe.', 400);
  if (resolved.families.length > MAX_FAMILIES) return compose(env, admin, input, `Trop de familles pour un seul envoi (${MAX_FAMILIES} au plus).`, 400);

  const siteUrl = new URL(request.url).origin;
  const badges = await adminBadges(env, admin);
  if (action === 'preview') return html(previewPage(input, resolved, siteUrl, { badges }));

  if (action === 'test') {
    const to = await clubRecipientsFor(env, admin.organizationId);
    const ok = to.length
      ? await sendClubMessage(env, resolved.families[0].row, { ...input, siteUrl, to, organizationId: admin.organizationId })
      : false;
    const notice = ok ? { type: 'ok', text: `Essai envoyé à ${to.map((r) => r.email).join(', ')}.` } : { type: 'error', text: 'L’essai n’a pas pu partir.' };
    return html(previewPage(input, resolved, siteUrl, { badges, notice }));
  }

  if (action === 'send') {
    let sent = 0;
    const failed = [];
    for (const family of resolved.families) {
      const ok = await sendClubMessage(env, family.row, { ...input, siteUrl, inscriptionId: family.inscriptionId, organizationId: admin.organizationId });
      if (ok) sent += 1;
      else failed.push(family.children.join(', '));
    }
    return html(donePage(input, { sent, failed, label: resolved.label }, badges));
  }
  return compose(env, admin, input, 'Action inconnue.', 400);
}
