// Fiche d'un éducateur (2026-11-12, _shared/educateurs.js) : tout ce qu'il a rempli (champs utiles à Footclubs
// copiables), état du lien, et actions du club : envoyer un nouveau lien, révoquer les liens, modifier rôle, catégories,
// e-mail et n° de licence, note interne, retirer / réactiver, supprimer définitivement (fiche retirée seulement).
// Organisation de la session uniquement ; jeton CSRF injecté par le middleware.
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash, formatDateFr, formatBirth, contactActions } from '../../_shared/admin-auth.js';
import {
  getEducateur,
  findActiveByEmail,
  updateClubFields,
  setNote,
  setArchived,
  revokeEducateurLinks,
  activeEducateurLinks,
  deleteEducateurPermanently,
  educateurStatus,
  diplomeLabels,
  ROLES,
  cleanLine,
} from '../../_shared/educateurs.js';
import { sendEducateurLinkEmail } from '../../_shared/confirmation-email.js';
import { readClubFields, statusTagOf } from '../educateurs.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
const redirect = (location) => new Response('', { status: 303, headers: { Location: location } });
const kv = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
const copyButton = (value, what) =>
  `<button type="button" class="adm-copy-btn" data-copy="${escapeHtml(value)}" aria-label="Copier ${what}" title="Copier">${icon('copy')}${icon('check')}</button>`;
const copyKv = (label, value, what) => kv(label, value ? `<span class="adm-person-coord">${escapeHtml(value)}</span>${copyButton(value, what)}` : '—');
const TODO = '<span class="adm-tag is-wait">Pas encore rempli</span>';

const MESSAGES = {
  created: ['ok', 'Éducateur ajouté. Envoyez-lui le lien quand vous êtes prêt.'],
  linkSent: ['ok', 'Lien envoyé par e-mail (valable 30 jours).'],
  linkFailed: ['error', 'L’e-mail n’a pas pu partir. Vérifiez l’adresse puis réessayez.'],
  revoked: ['ok', 'Liens révoqués : ils ne permettent plus d’ouvrir la fiche.'],
  saved: ['ok', 'Fiche mise à jour.'],
  invalid: ['error', 'Vérifiez le prénom, le nom, l’adresse e-mail et le n° de licence.'],
  duplicate: ['error', 'Un autre éducateur actif utilise déjà cette adresse e-mail.'],
  noteSaved: ['ok', 'Note enregistrée.'],
  archived: ['ok', 'Éducateur retiré : ses liens ne fonctionnent plus. Vous pouvez le réactiver.'],
  restored: ['ok', 'Éducateur réactivé. Envoyez-lui un nouveau lien si besoin.'],
  deleteActive: ['error', 'Retirez d’abord l’éducateur avant de supprimer sa fiche.'],
  deleteFiles: ['error', 'La photo n’a pas pu être supprimée : rien n’a été effacé, réessayez.'],
  error: ['error', 'Opération impossible pour le moment. Réessayez.'],
};

const parseId = (value) => (/^\d{1,9}$/.test(String(value)) ? Number(value) : null);

function page(r, { links, message, badges }) {
  const name = escapeHtml(`${r.prenom} ${r.nom}`);
  const status = educateurStatus(r);
  const diplomes = diplomeLabels(r);
  const filled = Boolean(r.submitted_at);
  const lieu = [[r.cp_naissance, r.ville_naissance].filter(Boolean).join(' '), r.pays_naissance].filter(Boolean).join(', ');

  const identity = `<section class="adm-surface">
    <h2 class="adm-h2">${icon('user')}Identité</h2>
    ${filled ? `<p class="adm-help">Champs copiables pour la licence dirigeant ou éducateur sur Footclubs.</p>
    <dl class="adm-kv adm-kv-copy">
      ${kv('Civilité', escapeHtml(r.civilite || '—'))}
      ${copyKv('Nom', r.nom, 'le nom')}
      ${r.nom_naissance ? copyKv('Nom de naissance', r.nom_naissance, 'le nom de naissance') : ''}
      ${copyKv('Prénom', r.prenom, 'le prénom')}
      ${copyKv('Né(e) le', r.naissance ? formatBirth(r.naissance) : '', 'la date de naissance')}
      ${copyKv('Ville de naissance', r.ville_naissance, 'la ville de naissance')}
      ${r.cp_naissance ? copyKv('Code postal de naissance', r.cp_naissance, 'le code postal de naissance') : ''}
      ${kv('Pays de naissance', escapeHtml(r.pays_naissance || '—'))}
      ${kv('Nationalité', escapeHtml(r.nationalite || '—'))}
    </dl>` : `<p>${TODO}</p><p class="adm-help">${escapeHtml(r.prenom)} n’a pas encore rempli sa fiche${r.link_sent_at ? ` (lien envoyé le ${formatDateFr(r.link_sent_at, { dateStyle: 'short' })})` : ''}.</p>`}
  </section>`;

  const contact = `<section class="adm-surface">
    <h2 class="adm-h2">${icon('phone')}Coordonnées</h2>
    <dl class="adm-kv adm-kv-copy">
      ${copyKv('E-mail', r.email, 'l’e-mail')}
      ${copyKv('Téléphone', r.telephone, 'le téléphone')}
      ${kv('Adresse', filled ? escapeHtml(`${r.adresse}, ${r.code_postal} ${r.ville}`) : '—')}
    </dl>
    ${r.telephone ? contactActions({ phone: r.telephone, email: null, name: `${r.prenom} ${r.nom}` }) : ''}
    ${filled ? `<h3 class="adm-h3">Personne à prévenir en cas d’urgence</h3>
    <dl class="adm-kv">
      ${kv('Nom', escapeHtml(r.urgence_nom || '—'))}
      ${r.urgence_lien ? kv('Lien', escapeHtml(r.urgence_lien)) : ''}
      ${kv('Téléphone', r.urgence_telephone ? `<a href="tel:${escapeHtml(r.urgence_telephone.replace(/[^\d+]/g, ''))}">${escapeHtml(r.urgence_telephone)}</a>` : '—')}
    </dl>` : ''}
  </section>`;

  const club = `<section class="adm-surface">
    <h2 class="adm-h2">${icon('award')}Encadrement</h2>
    <dl class="adm-kv">
      ${kv('Rôle', escapeHtml(ROLES[r.role] || ROLES.educateur))}
      ${kv('Catégorie(s)', escapeHtml(r.categories || '—'))}
      ${kv('Diplômes déclarés', filled ? escapeHtml(diplomes.length ? diplomes.join(', ') : 'Aucun déclaré') : '—')}
      ${r.diplomes_autre ? kv('Autres', escapeHtml(r.diplomes_autre)) : ''}
      ${kv('N° de licence FFF', r.numero_licence ? `<span class="adm-person-coord">${escapeHtml(r.numero_licence)}</span>${copyButton(r.numero_licence, 'le n° de licence')}` : '—')}
      ${kv('Tenue', escapeHtml(r.taille_tenue || '—'))}
      ${kv('Droit à l’image', filled ? (r.droit_image ? 'Oui' : 'Non') : '—')}
      ${filled ? kv('Fiche remplie le', formatDateFr(r.submitted_at, { dateStyle: 'long' })) : ''}
      ${r.updated_at && filled ? kv('Dernière modification', formatDateFr(r.updated_at, { dateStyle: 'short', timeStyle: 'short' })) : ''}
    </dl>
    <p class="adm-help">Les qualifications sont déclarées par l’éducateur. Une fiche complète ne vaut pas vérification des diplômes ni validation de la licence FFF.</p>
    ${r.disponibilites ? `<h3 class="adm-h3">Disponibilités ou remarques</h3><p class="adm-pre">${escapeHtml(r.disponibilites)}</p>` : ''}
  </section>`;

  const photo = `<section class="adm-surface" id="photo">
    <h2 class="adm-h2">${icon('camera')}Photo</h2>
    ${r.photo_uploaded_at
      ? `<img class="adm-educ-photo" src="/admin/educateurs/${r.id}/photo?v=${escapeHtml(encodeURIComponent(r.photo_uploaded_at))}" alt="Photo de ${name}" width="150" height="190">
         <p class="adm-help">Reçue le ${formatDateFr(r.photo_uploaded_at, { dateStyle: 'long' })}. <a class="adm-link" href="/admin/educateurs/${r.id}/photo" download>Télécharger</a></p>`
      : '<p class="adm-help">Pas encore déposée : l’éducateur la dépose depuis son lien.</p>'}
  </section>`;

  const lien = r.archived_at
    ? ''
    : `<section class="adm-surface" id="lien">
    <h2 class="adm-h2">${icon('send')}Lien de la fiche</h2>
    <p class="adm-help">${links.count ? `${links.count} lien${links.count > 1 ? 's' : ''} valable${links.count > 1 ? 's' : ''} jusqu’au ${formatDateFr(links.until, { dateStyle: 'long' })}.` : 'Aucun lien valable.'} Le lien n’est jamais affiché ici : il part uniquement à ${escapeHtml(r.email)}.</p>
    <div class="adm-form-actions">
      <form method="POST"><input type="hidden" name="action" value="send-link"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary" data-once>${icon('send')}${r.link_sent_at ? 'Envoyer un nouveau lien' : 'Envoyer le lien'}</button></form>
      ${links.count ? `<form method="POST" class="admin-confirm-form"><input type="hidden" name="action" value="revoke"><button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="Révoquer les liens de ${name} ? Ils ne permettront plus d’ouvrir la fiche.">${icon('lock')}Révoquer les liens</button></form>` : ''}
    </div>
  </section>`;

  const edit = `<section class="adm-surface" id="modifier">
    <details class="adm-prein-add">
      <summary class="adm-btn adm-btn-sm adm-btn-ghost">${icon('edit')}Modifier rôle, e-mail, licence</summary>
      <form method="POST" class="adm-prein-settings">
        <input type="hidden" name="action" value="club">
        <div class="form-row">
          <div class="form-field"><label for="ed-prenom">Prénom</label><input type="text" id="ed-prenom" name="prenom" value="${escapeHtml(r.prenom)}" maxlength="100" required></div>
          <div class="form-field"><label for="ed-nom">Nom</label><input type="text" id="ed-nom" name="nom" value="${escapeHtml(r.nom)}" maxlength="100" required></div>
        </div>
        <div class="form-field"><label for="ed-email">E-mail</label><input type="email" id="ed-email" name="email" value="${escapeHtml(r.email)}" maxlength="200" required></div>
        <div class="form-row">
          <div class="form-field"><label for="ed-role">Rôle</label><select id="ed-role" name="role">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}"${r.role === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="form-field"><label for="ed-cat">Catégorie(s)</label><input type="text" id="ed-cat" name="categories" value="${escapeHtml(r.categories || '')}" maxlength="100"></div>
        </div>
        <div class="form-field"><label for="ed-licence">N° de licence FFF</label><input type="text" id="ed-licence" name="numeroLicence" value="${escapeHtml(r.numero_licence || '')}" maxlength="40"></div>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button></div>
      </form>
    </details>
  </section>`;

  const note = `<section class="adm-surface" id="note">
    <details class="adm-note">
      <summary class="adm-btn adm-btn-sm adm-btn-ghost">${icon('edit')}Note interne${r.note_interne ? ' (1)' : ''}</summary>
      <form method="POST">
        <input type="hidden" name="action" value="note">
        <div class="form-field"><label for="ed-note">Visible seulement par le club</label><textarea id="ed-note" name="note" rows="3" maxlength="2000">${escapeHtml(r.note_interne || '')}</textarea></div>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer la note</button></div>
      </form>
    </details>
  </section>`;

  const danger = `<section class="adm-surface">
    <div class="adm-form-actions">
      ${r.archived_at
        ? `<form method="POST"><input type="hidden" name="action" value="restore"><button type="submit" class="adm-btn adm-btn-sm">${icon('refresh')}Réactiver</button></form>
           <form method="POST" class="admin-confirm-form"><input type="hidden" name="action" value="delete"><button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="Supprimer définitivement la fiche de ${name} et sa photo ? Cette action est irréversible.">${icon('trash')}Supprimer définitivement</button></form>`
        : `<form method="POST" class="admin-confirm-form"><input type="hidden" name="action" value="archive"><button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="Retirer ${name} des éducateurs ? Ses liens ne fonctionneront plus ; la fiche est conservée.">${icon('archive')}Retirer de l’encadrement</button></form>`}
    </div>
  </section>`;

  return `${adminHead(`${r.prenom} ${r.nom}`)}
${adminShell({
  active: 'educateurs',
  badges,
  back: { href: r.archived_at ? '/admin/educateurs?vue=retires' : '/admin/educateurs', label: 'Éducateurs' },
  eyebrow: escapeHtml(ROLES[r.role] || ROLES.educateur),
  title: name,
  subtitle: statusTagOf(r),
})}
<main id="adm-main" class="adm-wrap adm-main adm-educ">
  <section class="adm-surface">
    ${message ? flash(message[0], message[1]) : ''}
    <p class="adm-help">${status === 'complet' ? 'Fiche complète.' : status === 'photo' ? 'Fiche remplie, photo manquante.' : status === 'archive' ? 'Éducateur retiré de l’encadrement.' : 'En attente : l’éducateur remplit sa fiche depuis le lien reçu par e-mail.'}</p>
  </section>
  ${lien}
  ${identity}
  ${contact}
  ${club}
  ${photo}
  ${edit}
  ${note}
  ${danger}
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

export async function onRequestGet({ request, env, params }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  const id = parseId(params.id);
  const row = id && (await getEducateur(env.DB, admin.organizationId, id));
  if (!row) return new Response('Fiche introuvable.', { status: 404 });
  const links = await activeEducateurLinks(env.DB, admin.organizationId, row.id);
  return html(page(row, { links, message: MESSAGES[new URL(request.url).searchParams.get('msg')], badges: await adminBadges(env, admin) }));
}

export async function onRequestPost({ request, env, params }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  const org = admin.organizationId;
  const id = parseId(params.id);
  const row = id && (await getEducateur(env.DB, org, id));
  if (!row) return new Response('Fiche introuvable.', { status: 404 });
  const back = (msg, hash = '') => redirect(`/admin/educateurs/${row.id}?msg=${msg}${hash}`);
  try {
    const form = await request.formData();
    switch (form.get('action')) {
      case 'send-link': {
        if (row.archived_at) return back('error');
        const sent = await sendEducateurLinkEmail(env, row, new URL(request.url).origin).catch(() => false);
        return back(sent ? 'linkSent' : 'linkFailed', '#lien');
      }
      case 'revoke':
        await revokeEducateurLinks(env.DB, org, row.id);
        return back('revoked', '#lien');
      case 'club': {
        const { values, error } = readClubFields(form);
        const licence = cleanLine(String(form.get('numeroLicence') || ''), 40);
        if (error || licence === null || (licence && !/^[A-Za-z0-9][A-Za-z0-9 -]{0,39}$/.test(licence))) return back('invalid', '#modifier');
        const other = await findActiveByEmail(env.DB, org, values.email);
        if (other && other.id !== row.id && !row.archived_at) return back('duplicate', '#modifier');
        await updateClubFields(env.DB, org, row.id, { ...values, numero_licence: licence });
        // E-mail changé : les liens envoyés à l'ancienne adresse ne valent plus.
        if (values.email !== row.email.toLowerCase()) await revokeEducateurLinks(env.DB, org, row.id);
        return back('saved');
      }
      case 'note': {
        const note = String(form.get('note') || '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
        await setNote(env.DB, org, row.id, note);
        return back('noteSaved', '#note');
      }
      case 'archive':
        await setArchived(env.DB, org, row.id, true);
        return back('archived');
      case 'restore':
        if (row.archived_at && (await findActiveByEmail(env.DB, org, row.email))) return back('duplicate');
        await setArchived(env.DB, org, row.id, false);
        return back('restored');
      case 'delete': {
        const result = await deleteEducateurPermanently(env, org, row.id);
        if (result.error === 'actif') return back('deleteActive');
        if (result.error) return back('deleteFiles');
        return redirect('/admin/educateurs?vue=retires&msg=deleted');
      }
      default:
        return back('error');
    }
  } catch {
    return back('error');
  }
}
