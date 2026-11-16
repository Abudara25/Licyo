// Éducateurs (2026-11-12, _shared/educateurs.js) : liste des encadrants, ajout d'une fiche (prénom, nom, e-mail, rôle,
// catégories) avec envoi du lien personnel, export CSV. L'éducateur remplit lui-même le reste sur /educateur/<lien>.
// Tout est filtré par l'organisation de la session ; le jeton CSRF est injecté dans les formulaires par le middleware.
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash, formatDateFr, avatar, phoneLinks } from '../_shared/admin-auth.js';
import {
  listEducateurs,
  createEducateur,
  findActiveByEmail,
  educateurStatus,
  STATUS_LABELS,
  ROLES,
  diplomeLabels,
  cleanLine,
  isEmail,
  createInvite,
  listActiveInvites,
  revokeInvite,
  inviteUrl,
  INVITE_DAYS,
  INVITE_DEFAULT_DAYS,
  INVITE_MAX_USES,
} from '../_shared/educateurs.js';
import { sendEducateurLinkEmail, mailConfigured } from '../_shared/confirmation-email.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
const redirect = (location) => new Response('', { status: 303, headers: { Location: location } });

const STATUS_TONES = { invite: 'wait', photo: 'wait', complet: 'yes', archive: 'neutral' };
export const statusTagOf = (row) => {
  const s = educateurStatus(row);
  return `<span class="adm-tag is-${STATUS_TONES[s]}">${STATUS_LABELS[s]}</span>`;
};

const MESSAGES = {
  added: ['ok', 'Éducateur ajouté et lien envoyé par e-mail.'],
  addedNoMail: ['error', 'Éducateur ajouté, mais l’e-mail n’a pas pu partir. Ouvrez sa fiche puis utilisez « Envoyer le lien ».'],
  invalid: ['error', 'Vérifiez le prénom, le nom et l’adresse e-mail.'],
  duplicate: ['error', 'Un éducateur actif utilise déjà cette adresse e-mail.'],
  deleted: ['ok', 'Fiche supprimée définitivement.'],
  inviteRevoked: ['ok', 'Lien de groupe désactivé : il ne permet plus de créer de fiche.'],
  inviteInvalid: ['error', 'Vérifiez le rôle, la durée et le nombre de places du lien de groupe.'],
  error: ['error', 'Opération impossible pour le moment. Réessayez.'],
};

// Une cellule qui commence par = + - @ serait interprétée comme une formule par un tableur.
const csvCell = (value) => {
  const text = String(value ?? '');
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};

export function educateursCsv(rows) {
  const header = ['Civilité', 'Prénom', 'Nom', 'Nom de naissance', 'Rôle', 'Catégories', 'E-mail', 'Téléphone', 'Naissance', 'Pays de naissance', 'Code postal de naissance',
    'Ville de naissance', 'Nationalité', 'Adresse', 'Code postal', 'Ville', 'Personne à prévenir', 'Lien', 'Téléphone urgence', 'Diplômes', 'Autres diplômes',
    'N° de licence', 'Tenue', 'Droit à l’image', 'Fiche remplie le', 'Photo reçue'];
  const lines = rows.map((r) =>
    [r.civilite, r.prenom, r.nom, r.nom_naissance, ROLES[r.role] || r.role, r.categories, r.email, r.telephone, r.naissance, r.pays_naissance, r.cp_naissance,
      r.ville_naissance, r.nationalite, r.adresse, r.code_postal, r.ville, r.urgence_nom, r.urgence_lien, r.urgence_telephone, diplomeLabels(r).join(', '),
      r.diplomes_autre, r.numero_licence, r.taille_tenue, r.submitted_at ? (r.droit_image ? 'Oui' : 'Non') : '', r.submitted_at || '', r.photo_uploaded_at ? 'Oui' : 'Non']
      .map(csvCell)
      .join(';')
  );
  return new Response(`﻿${[header.map(csvCell).join(';'), ...lines].join('\r\n')}\r\n`, {
    headers: { 'Content-Type': 'text/csv;charset=UTF-8', 'Content-Disposition': 'attachment; filename="educateurs.csv"', 'Cache-Control': 'no-store' },
  });
}

// Avatar : photo de l'éducateur si elle existe (route admin), sinon initiales.
const educAvatar = (r) =>
  r.photo_uploaded_at
    ? `<img class="adm-avatar adm-avatar-photo" src="/admin/educateurs/${r.id}/photo?v=${escapeHtml(encodeURIComponent(r.photo_uploaded_at))}" alt="" loading="lazy">`
    : avatar({ id: r.id, enfant_prenom: r.prenom, enfant_nom: r.nom });

// Ligne compacte (lot 3, 2026-11-13) : photo, nom, rôle, catégories encadrées, diplômes déclarés, état de la fiche, Ouvrir.
function card(r) {
  const name = escapeHtml(`${r.prenom} ${r.nom}`);
  const diplomes = diplomeLabels(r);
  const cats = String(r.categories || '').split(/[,;/]+/).map((c) => c.trim()).filter(Boolean);
  return `<li class="adm-erow">
    ${educAvatar(r)}
    <div class="adm-irow-id"><h3><a href="/admin/educateurs/${r.id}">${name}</a></h3><p>${escapeHtml(ROLES[r.role] || ROLES.educateur)}${r.invite_id ? ' · via le lien de groupe' : ''}${!r.submitted_at && r.link_sent_at ? ` · lien envoyé le ${formatDateFr(r.link_sent_at, { dateStyle: 'short' })}` : ''}</p></div>
    <div class="adm-mrow-cell"><span>Catégories</span>${cats.length ? `<span class="adm-erow-cats">${cats.map((c) => `<em>${escapeHtml(c)}</em>`).join('')}</span>` : '<small>—</small>'}</div>
    <div class="adm-mrow-cell"><span>Diplômes déclarés</span><small>${r.submitted_at ? (diplomes.length ? escapeHtml(diplomes.join(', ')) : 'Aucun déclaré') : '—'}</small></div>
    <div class="adm-mrow-cell"><span>Fiche</span>${statusTagOf(r)}</div>
    <div class="adm-irow-actions"><a class="adm-btn adm-btn-ghost" href="/admin/educateurs/${r.id}">Ouvrir</a>${r.telephone ? phoneLinks(r.telephone).join('') : ''}</div>
  </li>`;
}

// « À faire maintenant » : fiches pas encore remplies (lien à envoyer ou à relancer) et photos manquantes.
function todoPanel(rows) {
  const notSent = rows.filter((r) => educateurStatus(r) === 'invite' && !r.link_sent_at);
  const waiting = rows.filter((r) => educateurStatus(r) === 'invite' && r.link_sent_at);
  const photo = rows.filter((r) => educateurStatus(r) === 'photo');
  const names = (list) => list.slice(0, 3).map((r) => escapeHtml(`${r.prenom} ${r.nom}`)).join(', ') + (list.length > 3 ? '…' : '');
  const items = [
    notSent.length && { icon: 'send', tone: 'no', title: `${notSent.length} ${notSent.length > 1 ? 'fiches dont le lien n’est pas encore envoyé' : 'fiche dont le lien n’est pas encore envoyé'}`, text: names(notSent), href: '/admin/educateurs?etat=invite', button: 'Voir' },
    waiting.length && { icon: 'file', tone: 'wait', title: `${waiting.length} ${waiting.length > 1 ? 'fiches pas encore remplies' : 'fiche pas encore remplie'}`, text: names(waiting), href: '/admin/educateurs?etat=invite', button: 'Relancer' },
    photo.length && { icon: 'camera', tone: 'wait', title: `${photo.length} ${photo.length > 1 ? 'photos manquantes' : 'photo manquante'}`, text: names(photo), href: '/admin/educateurs?etat=photo', button: 'Voir' },
  ].filter(Boolean);
  if (!items.length) return `<section class="adm-surface adm-pi-todo is-empty"><h2 class="adm-h2">${icon('check')}Rien à faire pour le moment</h2><p class="adm-help">Les fiches à remplir et les photos manquantes apparaîtront ici.</p></section>`;
  return `<section class="adm-surface adm-pi-todo"><h2 class="adm-h2">${icon('activity')}À faire maintenant</h2><ul>${items
    .map((t) => `<li class="adm-pi-todo-item is-${t.tone}"><span class="adm-pi-todo-ico">${icon(t.icon)}</span><div><strong>${t.title}</strong><p>${t.text}</p></div><a class="adm-btn adm-btn-sm adm-btn-ghost" href="${t.href}">${t.button}</a></li>`)
    .join('')}</ul></section>`;
}

const ETATS = { invite: 'À remplir', photo: 'Photo manquante', complet: 'Complètes' };

function addForm(open) {
  return `<section class="adm-surface" id="ajouter">
    <details class="adm-prein-add"${open ? ' open' : ''}>
      <summary class="adm-btn adm-btn-sm adm-btn-ghost">${icon('plus')}Ajouter un éducateur</summary>
      <form method="POST" class="adm-prein-settings">
        <input type="hidden" name="action" value="add">
        <div class="form-row">
          <div class="form-field"><label for="educ-new-prenom">Prénom</label><input type="text" id="educ-new-prenom" name="prenom" maxlength="100" required autocomplete="off"></div>
          <div class="form-field"><label for="educ-new-nom">Nom</label><input type="text" id="educ-new-nom" name="nom" maxlength="100" required autocomplete="off"></div>
        </div>
        <div class="form-field"><label for="educ-new-email">E-mail</label><input type="email" id="educ-new-email" name="email" maxlength="200" required autocomplete="off" inputmode="email"></div>
        <div class="form-row">
          <div class="form-field"><label for="educ-new-role">Rôle</label>
            <select id="educ-new-role" name="role">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <div class="form-field"><label for="educ-new-cat">Catégorie(s) encadrée(s) <small>(facultatif)</small></label><input type="text" id="educ-new-cat" name="categories" maxlength="100" autocomplete="off"></div>
        </div>
        <label class="form-check"><input type="checkbox" name="send" value="1" checked><span>Envoyer tout de suite le lien pour remplir sa fiche (valable 30 jours)</span></label>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary" data-once>${icon('send')}Ajouter</button></div>
      </form>
    </details>
  </section>`;
}

// Lien de groupe (2026-11-13) : le lien n'est affiché qu'une fois, juste après sa création (seule son empreinte est en
// base). Perdu ? On en crée un autre et on désactive l'ancien.
function inviteSection(invites, created) {
  const createdBox = created
    ? `<div class="adm-invite-new" role="status">
        <p><strong>Lien créé pour : ${escapeHtml(ROLES[created.role] || created.role)}.</strong> Copiez-le maintenant et partagez-le dans votre groupe : il ne sera plus affiché ensuite.</p>
        <input type="text" readonly class="adm-copy" value="${escapeHtml(created.url)}" aria-label="Lien d’invitation de groupe">
        <div class="adm-form-actions">
          <button type="button" class="adm-btn adm-btn-sm adm-btn-primary" data-copy="${escapeHtml(created.url)}">${icon('copy')}<span>Copier le lien</span></button>
          <a class="adm-btn adm-btn-sm adm-btn-ghost" href="https://wa.me/?text=${escapeHtml(encodeURIComponent(`Pour créer votre fiche au club, remplissez ce formulaire : ${created.url}`))}" target="_blank" rel="noopener">${icon('sms')}Partager</a>
        </div>
      </div>`
    : '';
  const list = invites.length
    ? `<ul class="adm-invite-list">${invites
        .map(
          (i) => `<li><div><strong>${escapeHtml(ROLES[i.role] || i.role)}</strong><small>Valable jusqu’au ${formatDateFr(i.expires_at, { dateStyle: 'short' })} · ${i.uses} / ${i.max_uses} ${i.max_uses > 1 ? 'places utilisées' : 'place utilisée'}</small></div>
          <form method="POST" class="admin-confirm-form"><input type="hidden" name="action" value="invite-revoke"><input type="hidden" name="invite" value="${i.id}"><button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="Désactiver ce lien ? Il ne permettra plus de créer de fiche.">Désactiver</button></form></li>`
        )
        .join('')}</ul>`
    : '';
  return `<section class="adm-surface" id="invitation">
    <h2 class="adm-h2">${icon('send')}Inviter par un lien de groupe</h2>
    <p class="adm-help">Un seul lien à partager dans un groupe (dirigeants, bénévoles…) : chacun indique son nom et son e-mail, sa fiche est créée avec le rôle choisi et il reçoit son lien personnel pour la compléter.</p>
    ${createdBox}
    ${list}
    <details class="adm-prein-add">
      <summary class="adm-btn adm-btn-sm adm-btn-ghost">${icon('plus')}Créer un lien de groupe</summary>
      <form method="POST" class="adm-prein-settings">
        <input type="hidden" name="action" value="invite-create">
        <div class="form-row">
          <div class="form-field"><label for="invite-role">Rôle donné aux inscrits</label>
            <select id="invite-role" name="role">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}"${k === 'dirigeant' ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="form-field"><label for="invite-days">Valable</label>
            <select id="invite-days" name="days">${INVITE_DAYS.map((d) => `<option value="${d}"${d === INVITE_DEFAULT_DAYS ? ' selected' : ''}>${d} jours</option>`).join('')}</select></div>
        </div>
        <div class="form-field"><label for="invite-places">Nombre de places</label><input type="number" id="invite-places" name="places" min="1" max="${INVITE_MAX_USES}" value="20" required inputmode="numeric"></div>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary" data-once>${icon('send')}Créer le lien</button></div>
      </form>
    </details>
  </section>`;
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  return renderList(request, env, admin);
}

async function renderList(request, env, admin, { created = null } = {}) {
  const url = new URL(request.url);
  const archived = url.searchParams.get('vue') === 'retires';
  const rows = await listEducateurs(env.DB, admin.organizationId, { archived });
  if (url.searchParams.get('format') === 'csv') return educateursCsv(rows);
  const message = MESSAGES[url.searchParams.get('msg')];
  const etat = Object.hasOwn(ETATS, url.searchParams.get('etat') || '') ? url.searchParams.get('etat') : '';
  const visible = etat ? rows.filter((r) => educateurStatus(r) === etat) : rows;
  const count = (k) => rows.filter((r) => educateurStatus(r) === k).length;
  const chips = archived
    ? ''
    : `<nav class="adm-chips" aria-label="Filtrer par état de la fiche"><a class="adm-chip${etat ? '' : ' is-active'}" href="/admin/educateurs"${etat ? '' : ' aria-current="true"'}>Actifs <b>${rows.length}</b></a>${Object.entries(ETATS)
        .filter(([k]) => count(k) || k === etat)
        .map(([k, label]) => `<a class="adm-chip${k === etat ? ' is-active' : ''}" href="/admin/educateurs?etat=${k}"${k === etat ? ' aria-current="true"' : ''}>${label} <b>${count(k)}</b></a>`)
        .join('')}</nav>`;
  return html(`${adminHead('Éducateurs')}
${adminShell({
  active: 'educateurs',
  badges: await adminBadges(env, admin),
  eyebrow: 'Encadrement',
  title: archived ? 'Éducateurs retirés' : 'Éducateurs',
  subtitle: archived ? 'Fiches retirées de l’encadrement, réactivables depuis leur fiche.' : `${rows.length} ${rows.length > 1 ? 'éducateurs actifs' : 'éducateur actif'} · ${count('complet')} ${count('complet') > 1 ? 'fiches complètes' : 'fiche complète'}. Chaque éducateur remplit sa fiche depuis le lien reçu par e-mail.`,
})}
<main id="adm-main" class="adm-wrap adm-main adm-pi">
  ${message ? flash(message[0], message[1]) : ''}
  ${!archived && !mailConfigured(env) ? '<p class="adm-help">L’envoi d’e-mails n’est pas configuré : les liens ne pourront pas partir.</p>' : ''}
  ${archived ? '' : todoPanel(rows)}
  <div class="adm-section-head adm-list-head">
    <h2 class="adm-h2">${icon('user')}${archived ? 'Retirés' : 'Encadrement'} <span class="adm-count">${visible.length}</span></h2>
    <div class="adm-list-tools">
      <a href="/admin/educateurs${archived ? '' : '?vue=retires'}" class="adm-btn adm-btn-sm adm-btn-ghost">${archived ? 'Éducateurs actifs' : 'Retirés'}</a>
      ${rows.length ? `<a href="/admin/educateurs?${archived ? 'vue=retires&amp;' : ''}format=csv" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('download')}CSV</a>` : ''}
    </div>
  </div>
  ${chips}
  ${visible.length ? `<ol class="adm-irows adm-educ-list">${visible.map(card).join('')}</ol>` : `<section class="adm-surface"><p class="adm-help">${archived ? 'Aucun éducateur retiré.' : etat ? 'Aucun éducateur dans ce filtre.' : 'Aucun éducateur pour le moment : ajoutez-en un.'}</p></section>`}
  ${archived ? '' : addForm(!rows.length)}
  ${archived ? '' : inviteSection(await listActiveInvites(env.DB, admin.organizationId), created)}
</main>
${adminScripts('admin-nav')}
</body></html>`);
}

// Champs gérés par le club (création et fiche) : { values } ou { error }.
export function readClubFields(form) {
  const prenom = cleanLine(String(form.get('prenom') || ''), 100);
  const nom = cleanLine(String(form.get('nom') || ''), 100);
  const email = String(form.get('email') || '').trim().toLowerCase();
  const categories = cleanLine(String(form.get('categories') || ''), 100);
  const role = Object.hasOwn(ROLES, String(form.get('role'))) ? String(form.get('role')) : 'educateur';
  if (!prenom || !nom || !isEmail(email) || email.length > 200 || categories === null) return { error: 'invalid' };
  return { values: { prenom, nom, email, role, categories } };
}

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  const org = admin.organizationId;
  try {
    const form = await request.formData();
    const action = form.get('action');
    if (action === 'invite-create') {
      const role = String(form.get('role') || '');
      const days = Number(form.get('days'));
      const places = Number(form.get('places'));
      if (!Object.hasOwn(ROLES, role) || !INVITE_DAYS.includes(days) || !Number.isInteger(places) || places < 1 || places > INVITE_MAX_USES) {
        return redirect('/admin/educateurs?msg=inviteInvalid#invitation');
      }
      const token = await createInvite(env.DB, org, { role, days, maxUses: places });
      // Page rendue directement (pas de redirection) : le lien n'est jamais mis dans une adresse ni stocké en clair.
      return renderList(new Request(new URL('/admin/educateurs', request.url)), env, admin, { created: { role, url: inviteUrl(new URL(request.url).origin, token) } });
    }
    if (action === 'invite-revoke') {
      const id = Number(form.get('invite'));
      if (Number.isInteger(id) && id > 0) await revokeInvite(env.DB, org, id);
      return redirect('/admin/educateurs?msg=inviteRevoked#invitation');
    }
    if (action !== 'add') return redirect('/admin/educateurs?msg=error');
    const { values, error } = readClubFields(form);
    if (error) return redirect('/admin/educateurs?msg=invalid#ajouter');
    if (await findActiveByEmail(env.DB, org, values.email)) return redirect('/admin/educateurs?msg=duplicate#ajouter');
    const row = await createEducateur(env.DB, org, values);
    if (form.get('send') !== '1') return redirect(`/admin/educateurs/${row.id}?msg=created`);
    const sent = await sendEducateurLinkEmail(env, row, new URL(request.url).origin).catch(() => false);
    return redirect(`/admin/educateurs?msg=${sent ? 'added' : 'addedNoMail'}`);
  } catch {
    return redirect('/admin/educateurs?msg=error');
  }
}
