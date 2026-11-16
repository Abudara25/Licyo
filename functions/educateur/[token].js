// Fiche éducateur à remplir (/educateur/<lien>, 2026-11-12) : lien personnel envoyé par le club depuis
// /admin/educateurs (voir _shared/educateurs.js). GET affiche le formulaire prérempli, POST l'enregistre ; la photo a
// sa propre route (./[token]/photo.js). L'éducateur peut revenir modifier sa fiche tant que le lien est valable.
// Signal de même origine exigé pour tout envoi (./_middleware.js).
import { familyShell } from '../depot/[token].js';
import {
  loadEducateurAccess,
  validateEducateurForm,
  saveEducateurForm,
  educateurStatus,
  DIPLOMES,
  DIPLOME_GROUPS,
  TENUES,
  CIVILITES,
  ROLES,
  LINK_DAYS,
  PHOTO_ACCEPT,
} from '../_shared/educateurs.js';
import { sendEducateurClubAlert } from '../_shared/confirmation-email.js';

const escapeHtml = (str = '') =>
  String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const htmlResponse = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin' } });

const flash = (type, message) => `<p class="suivi-flash is-${type}" role="${type === 'error' ? 'alert' : 'status'}"><span>${escapeHtml(message)}</span></p>`;

const header = (title) => `<div class="page-header"><div class="container"><span class="eyebrow">Espace éducateur</span><h1>${escapeHtml(title)}</h1></div></div>`;

export function educateurExpiredPage(token, { sent = false } = {}) {
  const body = sent
    ? '<p>Si ce lien correspond à une fiche éducateur, un nouveau lien vient d’être envoyé à l’adresse e-mail enregistrée par le club. Pensez à regarder dans les indésirables.</p>'
    : `<p>Pour protéger vos informations, les liens vers la fiche éducateur sont valables ${LINK_DAYS} jours.</p>
      <form method="POST" action="/educateur/${escapeHtml(encodeURIComponent(token))}/nouveau-lien" class="suivi-renew">
        <button type="submit" class="btn btn-primary">Recevoir un nouveau lien</button>
      </form>
      <p class="suivi-renew-note">Le lien est envoyé uniquement à l’adresse e-mail enregistrée par le club. Adresse changée ? Écrivez-nous à <a href="mailto:contact@club-exemple.example">contact@club-exemple.example</a>.</p>`;
  return familyShell('Lien expiré', `
  ${header(sent ? 'Lien envoyé' : 'Ce lien a expiré')}
  <section class="bg-cream"><div class="container suivi-wrap"><div class="suivi-card suivi-expired">${body}</div></div></section>
`);
}

// values : saisie à réafficher après une erreur (noms du formulaire), sinon la fiche en base.
function formValues(row, form) {
  if (form) {
    const get = (name) => (typeof form.get(name) === 'string' ? form.get(name) : '');
    return {
      civilite: get('civilite'), prenom: get('prenom'), nom: get('nom'), nom_naissance: get('nomNaissance'), naissance: get('naissance'),
      pays_naissance: get('paysNaissance'), cp_naissance: get('cpNaissance'), ville_naissance: get('villeNaissance'), nationalite: get('nationalite'),
      telephone: get('telephone'), adresse: get('adresse'), code_postal: get('codePostal'), ville: get('ville'),
      urgence_nom: get('urgenceNom'), urgence_lien: get('urgenceLien'), urgence_telephone: get('urgenceTelephone'),
      diplomes: form.getAll('diplomes').join(','), diplomes_autre: get('diplomesAutre'), numero_licence: get('numeroLicence'),
      taille_tenue: get('tailleTenue'), disponibilites: get('disponibilites'), droit_image: get('droitImage') === '1' ? 1 : 0,
      rgpd: get('rgpd') === '1' ? 1 : 0, attestation: get('attestation') === '1' ? 1 : 0,
    };
  }
  return { ...row, pays_naissance: row.pays_naissance || 'France', nationalite: row.nationalite || 'Française' };
}

export function educateurPage(row, token, { messages = {}, form = null } = {}) {
  const t = escapeHtml(encodeURIComponent(token));
  const v = formValues(row, form);
  const val = (key) => escapeHtml(v[key] || '');
  const checked = (cond) => (cond ? ' checked' : '');
  const selected = (a, b) => (a === b ? ' selected' : '');
  const diplomes = new Set(String(v.diplomes || '').split(','));
  const status = educateurStatus(row);
  const role = ROLES[row.role] || ROLES.educateur;
  const field = (id, name, label, attrs = '', key = null) => `<div class="form-field">
          <label for="${id}">${label}</label>
          <input type="text" id="${id}" name="${name}" value="${val(key || name)}"${attrs}>
        </div>`;

  const summary = `<div class="suivi-card educ-intro">
    <p class="educ-role">${escapeHtml(role)}${row.categories ? ` · ${escapeHtml(row.categories)}` : ''}</p>
    <p>Bonjour ${escapeHtml(row.prenom)}, merci de remplir votre fiche : elle sert à préparer votre licence FFF (licence dirigeant ou éducateur) et à vous joindre. Vous pourrez la modifier tant que ce lien est valable.</p>
    <ol class="educ-steps">
      <li class="${row.submitted_at ? 'is-done' : ''}"><strong>Vos informations</strong><span>${row.submitted_at ? 'Envoyées' : 'À remplir ci-dessous'}</span></li>
      <li class="${row.photo_uploaded_at ? 'is-done' : ''}"><strong>Votre photo</strong><span>${row.photo_uploaded_at ? 'Reçue' : '<a href="#photo">À déposer</a>'}</span></li>
    </ol>
    ${status === 'complet' ? flash('ok', 'Votre fiche est complète, merci ! Le club reviendra vers vous pour la licence.') : ''}
  </div>`;

  const formCard = `<div class="suivi-card" id="fiche">
    <div class="suivi-card-head"><h2>Vos informations</h2>${row.submitted_at ? '<span class="suivi-tag is-ok">Envoyées</span>' : '<span class="suivi-tag is-todo">À remplir</span>'}</div>
    ${messages.saved && row.photo_uploaded_at ? flash('ok', 'Fiche enregistrée, merci !') : ''}
    ${messages.errors ? flash('error', `À vérifier : ${messages.errors.join(', ')}.`) : ''}
    <form method="POST" action="/educateur/${t}" class="educ-form" novalidate>
      <fieldset>
        <legend>Identité</legend>
        <div class="form-field">
          <span class="educ-label" id="civilite-label">Civilité</span>
          <div class="educ-inline" role="radiogroup" aria-labelledby="civilite-label">
            ${CIVILITES.map((c) => `<label class="form-check"><input type="radio" name="civilite" value="${c}" required${checked(v.civilite === c)}><span>${c}</span></label>`).join('')}
          </div>
        </div>
        <div class="form-row">
          ${field('educ-prenom', 'prenom', 'Prénom', ' autocomplete="given-name" maxlength="100" required', 'prenom')}
          ${field('educ-nom', 'nom', 'Nom', ' autocomplete="family-name" maxlength="100" required', 'nom')}
        </div>
        <div class="form-field">
          <label for="educ-nom-naissance">Nom de naissance <small>(si différent)</small></label>
          <input type="text" id="educ-nom-naissance" name="nomNaissance" value="${val('nom_naissance')}" maxlength="100" autocomplete="off">
        </div>
        <div class="form-row">
          <div class="form-field">
            <label for="educ-naissance">Date de naissance</label>
            <input type="date" id="educ-naissance" name="naissance" value="${val('naissance')}" required autocomplete="bday">
          </div>
          ${field('educ-nationalite', 'nationalite', 'Nationalité', ' maxlength="60" required', 'nationalite')}
        </div>
      </fieldset>

      <fieldset>
        <legend>Lieu de naissance</legend>
        <p class="form-hint">Demandé par la FFF pour la licence et le contrôle d’honorabilité des encadrants de mineurs.</p>
        <div class="form-row">
          ${field('pays-naissance', 'paysNaissance', 'Pays', ' maxlength="100" required autocomplete="off"', 'pays_naissance')}
          <div class="form-field">
            <label for="cp-naissance">Code postal</label>
            <input type="text" id="cp-naissance" name="cpNaissance" value="${val('cp_naissance')}" placeholder="5 chiffres" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" autocomplete="off">
          </div>
        </div>
        <div class="form-field address-field">
          <label for="ville-naissance">Ville</label>
          <input type="text" id="ville-naissance" name="villeNaissance" value="${val('ville_naissance')}" placeholder="Ville de naissance" maxlength="100" required autocomplete="off">
          <ul id="ville-naissance-suggestions" class="address-suggestions" role="listbox" aria-label="Communes suggérées" hidden></ul>
        </div>
      </fieldset>

      <fieldset>
        <legend>Coordonnées</legend>
        <div class="form-field">
          <label for="educ-email">E-mail</label>
          <input type="email" id="educ-email" value="${escapeHtml(row.email)}" disabled>
          <small class="form-hint">Pour la changer, écrivez au club.</small>
        </div>
        <div class="form-field">
          <label for="educ-telephone">Téléphone</label>
          <input type="tel" id="educ-telephone" name="telephone" value="${val('telephone')}" maxlength="30" required autocomplete="tel" inputmode="tel">
        </div>
        <div class="form-field address-field">
          <label for="adresse">Adresse</label>
          <input type="text" id="adresse" name="adresse" value="${val('adresse')}" placeholder="Numéro et nom de la rue" maxlength="200" required autocomplete="street-address">
          <ul id="adresse-suggestions" class="address-suggestions" role="listbox" aria-label="Adresses suggérées" hidden></ul>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label for="code-postal">Code postal</label>
            <input type="text" id="code-postal" name="codePostal" value="${val('code_postal')}" placeholder="5 chiffres" maxlength="10" required autocomplete="postal-code" inputmode="numeric">
          </div>
          <div class="form-field address-field">
            <label for="ville">Ville</label>
            <input type="text" id="ville" name="ville" value="${val('ville')}" placeholder="Ville" maxlength="100" required autocomplete="address-level2">
            <ul id="ville-suggestions" class="address-suggestions" role="listbox" aria-label="Communes suggérées" hidden></ul>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Personne à prévenir en cas d’urgence</legend>
        <div class="form-row">
          ${field('educ-urgence-nom', 'urgenceNom', 'Prénom et nom', ' maxlength="100" required autocomplete="off"', 'urgence_nom')}
          ${field('educ-urgence-lien', 'urgenceLien', 'Lien <small>(facultatif)</small>', ' maxlength="60" placeholder="Conjoint, parent…" autocomplete="off"', 'urgence_lien')}
        </div>
        <div class="form-field">
          <label for="educ-urgence-tel">Téléphone</label>
          <input type="tel" id="educ-urgence-tel" name="urgenceTelephone" value="${val('urgence_telephone')}" maxlength="30" required inputmode="tel" autocomplete="off">
        </div>
      </fieldset>

      <fieldset>
        <legend>Diplômes et formations</legend>
        <p class="form-hint">Cochez uniquement les diplômes ou certifications obtenus. Une formation suivie sans certification se précise dans le champ ci-dessous. Aucun diplôme ? Vous pouvez quand même envoyer votre fiche.</p>
        ${DIPLOME_GROUPS.map((group) => `<fieldset class="educ-diplome-group"><legend>${group.label}</legend><div class="educ-checks">${group.keys.map((key) => `<label class="form-check"><input type="checkbox" name="diplomes" value="${key}"${checked(diplomes.has(key))}><span>${DIPLOMES[key]}</span></label>`).join('')}</div></fieldset>`).join('')}
        <div class="form-field">
          <label for="educ-diplomes-autre">Autres certifications, formations en cours ou expérience <small>(facultatif)</small></label>
          <textarea id="educ-diplomes-autre" name="diplomesAutre" rows="3" maxlength="200" aria-describedby="educ-diplomes-hint">${val('diplomes_autre')}</textarea>
          <small class="form-hint" id="educ-diplomes-hint">Précisez l’intitulé, l’organisme, l’année et si la certification est obtenue ou en cours (200 caractères maximum). Le club vérifiera les qualifications déclarées.</small>
        </div>
        <div class="form-field">
          <label for="educ-licence">Numéro de licence FFF <small>(si vous en avez déjà un)</small></label>
          <input type="text" id="educ-licence" name="numeroLicence" value="${val('numero_licence')}" maxlength="40" autocomplete="off">
        </div>
      </fieldset>

      <fieldset>
        <legend>Tenue et disponibilités</legend>
        <div class="form-field">
          <label for="educ-tenue">Taille de tenue</label>
          <select id="educ-tenue" name="tailleTenue" required>
            <option value="" disabled${v.taille_tenue ? '' : ' selected'}>Choisir une taille</option>
            ${TENUES.map((s) => `<option value="${s}"${selected(v.taille_tenue, s)}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label for="educ-dispo">Disponibilités ou remarques <small>(facultatif)</small></label>
          <textarea id="educ-dispo" name="disponibilites" rows="3" maxlength="500">${val('disponibilites')}</textarea>
        </div>
      </fieldset>

      <div class="form-checks">
        <label class="form-check">
          <input type="checkbox" name="droitImage" value="1"${checked(Number(v.droit_image))}>
          <span>J’autorise le club à utiliser des photos ou vidéos de moi prises lors des activités du club, pour sa communication (site, réseaux sociaux). <em>Facultatif.</em></span>
        </label>
        <label class="form-check">
          <input type="checkbox" name="rgpd" value="1" required${checked(Number(v.rgpd))}>
          <span>J’accepte que ces informations soient utilisées par le club pour gérer mon activité d’encadrant et ma licence (voir la <a href="/confidentialite" target="_blank" rel="noopener">politique de confidentialité</a>).</span>
        </label>
        <label class="form-check">
          <input type="checkbox" name="attestation" value="1" required${checked(Number(v.attestation))}>
          <span>Je certifie l’exactitude de ces informations et je suis informé(e) que la FFF vérifie l’honorabilité des encadrants de mineurs à partir de mon identité.</span>
        </label>
      </div>
      <button type="submit" class="btn btn-primary">${row.submitted_at ? 'Enregistrer les modifications' : 'Envoyer ma fiche'}</button>
    </form>
  </div>`;

  const photoCard = `<div class="suivi-card" id="photo">
    <div class="suivi-card-head"><h2>Votre photo</h2>${row.photo_uploaded_at ? '<span class="suivi-tag is-ok">Reçue</span>' : '<span class="suivi-tag is-todo">À déposer</span>'}</div>
    ${messages.saved && !row.photo_uploaded_at ? flash('ok', 'Fiche enregistrée, merci ! Dernière étape : votre photo.') : ''}
    ${messages.photoOk ? flash('ok', 'Photo bien reçue, merci !') : ''}
    ${messages.photoError ? flash('error', messages.photoError) : ''}
    <div class="educ-photo">
      ${row.photo_uploaded_at ? `<img src="/educateur/${t}/photo?v=${escapeHtml(encodeURIComponent(row.photo_uploaded_at))}" alt="Votre photo" width="120" height="150">` : ''}
      <div>
        <p class="suivi-help">Photo d’identité pour la licence : de face, sur fond clair, visage bien visible, sans lunettes de soleil ni casquette.</p>
        <form method="POST" action="/educateur/${t}/photo" enctype="multipart/form-data" class="educ-photo-form">
          <label for="educ-photo-file">${row.photo_uploaded_at ? 'Remplacer la photo' : 'Choisir une photo'} <small>(JPG, PNG ou WebP, 10 Mo au plus)</small></label>
          <input type="file" id="educ-photo-file" name="photo" accept="${PHOTO_ACCEPT}" required>
          <button type="submit" class="btn btn-primary">Envoyer la photo</button>
        </form>
      </div>
    </div>
  </div>`;

  return familyShell('Fiche éducateur', `
  ${header(`Fiche éducateur de ${row.prenom}`)}
  <section class="bg-cream"><div class="container suivi-wrap">
    ${summary}
    ${formCard}
    ${photoCard}
  </div></section>
`);
}

async function notFound(request, env) {
  const res = await env.ASSETS.fetch(new URL('/404.html', new URL(request.url).origin));
  return new Response(res.body, { status: 404, headers: res.headers });
}

export async function onRequestGet({ request, env, params }) {
  const access = await loadEducateurAccess(request, env, params.token);
  const { searchParams } = new URL(request.url);
  if (searchParams.get('envoye') === '1' && access.status !== 'ok') return htmlResponse(educateurExpiredPage(params.token, { sent: true }));
  if (access.status === 'unknown') return notFound(request, env);
  if (access.status !== 'ok') return htmlResponse(educateurExpiredPage(params.token), 410);
  return htmlResponse(
    educateurPage(access.row, params.token, {
      messages: { saved: searchParams.get('ok') === '1', photoOk: searchParams.get('photoOk') === '1', photoError: searchParams.get('photoError') },
    })
  );
}

export async function onRequestPost({ request, env, params, waitUntil }) {
  const access = await loadEducateurAccess(request, env, params.token);
  if (access.status === 'unknown') return notFound(request, env);
  if (access.status !== 'ok') return new Response('', { status: 303, headers: { Location: `/educateur/${encodeURIComponent(params.token)}` } });
  let form;
  try {
    form = await request.formData();
  } catch {
    return htmlResponse(educateurPage(access.row, params.token, { messages: { errors: ['envoi invalide, réessayez'] } }), 400);
  }
  const { values, errors } = validateEducateurForm(form);
  if (errors) return htmlResponse(educateurPage(access.row, params.token, { messages: { errors }, form }), 400);
  const first = !access.row.submitted_at;
  const saved = await saveEducateurForm(env.DB, access.row, values);
  // Alerte au club au premier envoi seulement (les modifications suivantes ne préviennent personne).
  if (first) waitUntil(sendEducateurClubAlert(env, saved, new URL(request.url).origin).catch(() => {}));
  return new Response('', { status: 303, headers: { Location: `/educateur/${encodeURIComponent(params.token)}?ok=1${saved.photo_uploaded_at ? '' : '#photo'}` } });
}
