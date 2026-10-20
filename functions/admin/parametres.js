// Réglages du club : l'adresse qui reçoit les e-mails du site (voir _shared/settings-kv.js), les infos envoyées aux
// familles, les automatisations (_shared/automations.js) et la durée de conservation. Depuis les comptes nominatifs
// (phase 3, 2026-10-20), il n'y a plus de mot de passe partagé ici : chacun gère le sien dans « Mon compte »
// (/admin/compte) et les accès se gèrent dans « Utilisateurs » (/admin/utilisateurs).
import { getCustomFields, setCustomFields, SPORT_SUGGESTIONS, MAX_CUSTOM_FIELDS, slugKey } from '../_shared/custom-fields.js';
import { retentionDue, RETENTION_YEARS } from '../_shared/retention.js';
import { getSportProfile, setSportProfile, SPORT_PRESETS, SPORT_KEYS } from '../_shared/sport-profile.js';
import {
  isAuthed,
  loginPage,
  escapeHtml,
  adminHead,
  adminShell,
  adminScripts,
  adminBadges,
  icon,
  flash,
  statusTag,
  formatDateFr,
} from '../_shared/admin-auth.js';
import {
  getNotificationEmail,
  setNotificationEmail,
  getAutomationsConfig,
  setAutomationsConfig,
  getCronState,
  DEFAULT_AUTOMATIONS,
  getFamilyInfo,
  setFamilyInfo,
  normalizeWhatsappUrl,
} from '../_shared/settings-kv.js';
import { sendWeeklySummary, mailConfigured } from '../_shared/confirmation-email.js';
import { runReminders, buildWeeklySummary } from '../_shared/automations.js';
import { helloAssoCredentials, saveHelloAssoCredentials, generateWebhookSecret, secretsConfigured } from '../_shared/integrations.js';

const AUTOMATIONS = [
  {
    key: 'familyEmails',
    title: 'E-mails de suivi aux familles',
    description: 'Quand le club valide une étape (paiement reçu, dossier ou photo reçus par e-mail), puis « Dossier complet » une seule fois.',
    needs: ['brevo'],
  },
  {
    key: 'clubUploadAlerts',
    title: 'Alerte au club à chaque dépôt',
    description: 'E-mail aux adresses ci-dessus dès qu’une famille dépose son dossier signé ou la photo de l’enfant.',
    needs: ['brevo'],
  },
  {
    key: 'helloassoAutoPay',
    title: 'Paiements HelloAsso validés automatiquement',
    description: 'L’étape « Paiement » passe au vert dès que HelloAsso confirme la commande. Si la fiche n’est pas reconnue, le club reçoit un e-mail pour la rattacher à la main.',
    needs: ['helloasso'],
  },
  {
    key: 'autoReminders',
    title: 'Relances automatiques',
    description: 'E-mail aux familles dont le dossier est incomplet, 3 puis 7 jours après l’inscription (2 relances au plus, jamais moins de 3 jours après la précédente).',
    needs: ['brevo', 'cron'],
  },
  {
    key: 'weeklySummary',
    title: 'Récapitulatif chaque lundi',
    description: 'Nouvelles inscriptions de la semaine et dossiers à compléter, envoyés aux adresses ci-dessus.',
    needs: ['brevo', 'cron'],
  },
];

function automationsSection(auto) {
  const ready = { brevo: auto.brevo, helloasso: Boolean(auto.webhookSecret), cron: auto.cronSecret };
  const webhookUrl = auto.webhookSecret ? `${auto.siteUrl}/api/helloasso-notification?key=${auto.webhookSecret}` : '';
  const kv = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const setup = (ok) => statusTag(ok, { yes: 'Configuré', no: 'À configurer' });

  return `<section class="adm-surface" id="automatisations">
    <h2 class="adm-h2">${icon('refresh')}Automatisations</h2>
    <p class="adm-help" style="margin-top:8px;">Chaque automatisation peut être coupée à tout moment. Celles dont un prérequis manque ne font rien tant qu’il n’est pas configuré (voir « Mise en service » plus bas).</p>
    ${auto.message ? flash('ok', auto.message) : ''}
    ${auto.error ? flash('error', auto.error) : ''}
    <form method="POST">
      <input type="hidden" name="action" value="automations">
      ${AUTOMATIONS.map((a) => {
        const missing = a.needs.filter((n) => !ready[n]);
        return `<label class="adm-check adm-toggle"><input type="checkbox" name="${a.key}" ${auto.config[a.key] ? 'checked' : ''}><span><strong>${a.title}</strong><small>${a.description}${
          missing.length ? ' <em>Prérequis à configurer.</em>' : ''
        }</small></span></label>`;
      }).join('')}
      <div class="adm-form-actions" style="margin-top:16px;"><button type="submit" class="adm-btn adm-btn-primary">${icon('check')}Enregistrer</button></div>
    </form>

    <hr class="adm-divider">
    <h3 class="adm-h3">Mise en service</h3>
    <dl class="adm-kv">
      ${kv(`E-mails (${auto.mailVia})`, setup(auto.brevo))}
      ${kv('Notification HelloAsso', setup(Boolean(auto.webhookSecret)))}
      ${kv('Vérification via l’API HelloAsso', statusTag(auto.helloassoApi, { yes: 'Active', no: 'Inactive' }))}
      ${kv('Tâches programmées', auto.cronSecret ? cronStatus(auto.cron) : setup(false))}
    </dl>
    ${
      webhookUrl
        ? `<div class="form-field" style="margin-top:12px;">
      <label for="webhook-url">URL à enregistrer chez HelloAsso (Mon compte › Intégrations et API › Notifications)</label>
      <input type="text" id="webhook-url" class="adm-copy" readonly value="${escapeHtml(webhookUrl)}">
    </div>`
        : ''
    }

    <hr class="adm-divider">
    <h3 class="adm-h3" id="helloasso">Identifiants HelloAsso du club</h3>
    <p class="adm-help" style="margin-top:6px;">Chiffrés et propres à votre club. Ils ne sont jamais réaffichés : laissez un champ vide pour garder la valeur enregistrée. L’identifiant et le secret API se trouvent chez HelloAsso dans Mon compte › Intégrations et API.</p>
    ${auto.secretsReady ? '' : flash('error', 'La plateforme n’a pas encore de clé de chiffrement (SECRETS_KEY) : les identifiants ne peuvent pas être enregistrés.')}
    <form method="POST">
      <input type="hidden" name="action" value="helloasso">
      <div class="form-row">
        <div class="form-field">
          <label for="ha-client-id">Identifiant API (client id) ${auto.helloassoClientId ? '<small>· enregistré</small>' : ''}</label>
          <input type="text" id="ha-client-id" name="clientId" autocomplete="off" maxlength="200" ${auto.secretsReady ? '' : 'disabled'}>
        </div>
        <div class="form-field">
          <label for="ha-client-secret">Secret API (client secret) ${auto.helloassoClientSecret ? '<small>· enregistré</small>' : ''}</label>
          <input type="password" id="ha-client-secret" name="clientSecret" autocomplete="new-password" maxlength="200" ${auto.secretsReady ? '' : 'disabled'}>
        </div>
      </div>
      <label class="adm-check"><input type="checkbox" name="newWebhook" ${auto.webhookSecret ? '' : 'checked'} ${auto.secretsReady ? '' : 'disabled'}><span>${auto.webhookSecret ? 'Générer une nouvelle URL de notification (l’ancienne cessera de fonctionner)' : 'Générer l’URL de notification'}</span></label>
      <div class="adm-form-actions" style="margin-top:12px;"><button type="submit" class="adm-btn adm-btn-primary" ${auto.secretsReady ? '' : 'disabled'}>${icon('lock')}Enregistrer</button></div>
    </form>
    ${auto.helloassoClientId || auto.webhookSecret ? `<form method="POST" class="admin-confirm-form" style="margin-top:8px;"><input type="hidden" name="action" value="helloasso-clear"><button type="submit" class="adm-btn adm-btn-sm adm-btn-danger" data-confirm="Effacer tous les identifiants HelloAsso du club ? Les paiements ne seront plus validés automatiquement.">${icon('trash')}Effacer les identifiants</button></form>` : ''}

    <hr class="adm-divider">
    <h3 class="adm-h3">Lancer maintenant</h3>
    <p class="adm-help" style="margin-top:6px;">Utile pour tester, ou si le service programmé n’est pas encore installé.</p>
    <div class="adm-inline-forms">
      <form method="POST" class="admin-confirm-form">
        <input type="hidden" name="action" value="run-reminders">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="Envoyer maintenant les relances automatiques dues (dossiers incomplets depuis 3 ou 7 jours) ?">${icon('send')}Envoyer les relances dues</button>
      </form>
      <form method="POST" class="admin-confirm-form">
        <input type="hidden" name="action" value="send-summary">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="Envoyer maintenant le récapitulatif aux adresses de notification ?">${icon('mail')}Envoyer le récapitulatif</button>
      </form>
    </div>
  </section>`;
}

function familyInfoSection({ whatsappUrl, whatsappInput, familyOk, familyError }) {
  return `<section class="adm-surface" id="infos-familles">
    <h2 class="adm-h2">${icon('users')}Infos envoyées aux familles</h2>
    <p class="adm-help" style="margin-top:8px;">Ajoutées aux e-mails de suivi dès que le paiement est reçu (« Marquer payé », HelloAsso, puis « Dossier complet »), avec l’annonce de l’e-mail de la FFF pour la licence et les infos pratiques des entraînements.</p>
    ${familyOk ? flash('ok', 'Infos enregistrées.') : ''}
    ${familyError ? flash('error', familyError) : ''}
    <form method="POST">
      <input type="hidden" name="action" value="family-info">
      <div class="form-field">
        <label for="whatsapp-url">Lien d’invitation au groupe WhatsApp</label>
        <input type="url" id="whatsapp-url" name="whatsappUrl" inputmode="url" placeholder="https://chat.whatsapp.com/…" value="${escapeHtml(whatsappInput ?? whatsappUrl)}">
      </div>
      <p class="adm-help">Dans WhatsApp : infos du groupe › Inviter via un lien › Copier le lien. Laisser vide pour ne pas l’envoyer.</p>
      <p class="adm-help"><strong>Pensez à réinitialiser le lien</strong> (même écran › Réinitialiser le lien) à chaque nouvelle saison, ou s’il a circulé en dehors des familles : toute personne qui a ce lien peut rejoindre le groupe et voir les numéros de téléphone des parents. L’ancien lien cesse alors de fonctionner : collez le nouveau ici, sinon les e-mails enverront un lien mort. Vous pouvez aussi activer « Approuver les nouveaux membres » dans les paramètres du groupe.</p>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('check')}Enregistrer</button></div>
    </form>
  </section>`;
}

// Durée de conservation (_shared/retention.js) : revue des fiches à supprimer, jamais de suppression automatique.
function retentionSection(due) {
  const list = due === null
    ? flash('error', 'Liste momentanément indisponible.')
    : due.length
      ? `<p class="adm-help">${due.length} fiche${due.length > 1 ? 's ont' : ' a'} dépassé la durée de conservation. Pour chacune : archiver (motif « Autre » : durée de conservation), puis « Supprimer définitivement » depuis la corbeille.</p>
        <ul class="adm-people">${due.map((r) => `<li class="adm-person"><a class="adm-link" href="/admin/inscriptions/${r.id}">${escapeHtml(`${r.enfant_prenom} ${r.enfant_nom}`)}</a> <span class="adm-row-sub">saison ${escapeHtml(r.saison)} · à supprimer depuis le ${escapeHtml(formatDateFr(r.retentionEnd))}${r.archived_at ? ' · dans la corbeille' : ''}</span></li>`).join('')}</ul>`
      : '<p class="adm-help">Aucune fiche à supprimer pour le moment.</p>';
  return `<section class="adm-surface" id="conservation">
    <h2 class="adm-h2">${icon('archive')}Durée de conservation</h2>
    <p class="adm-help" style="margin-top:8px;">Les fiches sont conservées jusqu'à ${RETENTION_YEARS} ans après la fin de leur saison (30 juin), comme l'annonce la politique de confidentialité. Rien n'est supprimé automatiquement : la suppression définitive efface la fiche, le dossier, la photo et leurs copies de sauvegarde.</p>
    ${list}
  </section>`;
}

function sportSection(sport, { sportOk = false } = {}) {
  const field = (id, name, label, help = '') => `<div class="form-field">
        <label for="${id}">${label}</label>
        <input type="text" id="${id}" name="${name}" value="${escapeHtml(sport[name] || '')}" maxlength="120" placeholder="${escapeHtml(SPORT_PRESETS[sport.sport][name] || '')}">
        ${help ? `<small class="form-hint">${help}</small>` : ''}
      </div>`;
  return `<section class="adm-surface" id="sport">
    <h2 class="adm-h2">${icon('tag')}Sport et fédération</h2>
    <p class="adm-help" style="margin-top:8px;">Adapte les mots de l’admin et des e-mails à votre sport (licence, fédération, plateforme où le club enregistre les licences). Laissez un champ vide pour reprendre la valeur proposée.</p>
    ${sportOk ? flash('ok', 'Sport enregistré.') : ''}
    <form method="POST">
      <input type="hidden" name="action" value="sport">
      <div class="form-field">
        <label for="sport-key">Sport principal</label>
        <select id="sport-key" name="sport" class="adm-select">${SPORT_KEYS.map((k) => `<option value="${k}"${k === sport.sport ? ' selected' : ''}>${escapeHtml(SPORT_PRESETS[k].label)}</option>`).join('')}</select>
        <small class="form-hint">Après un changement de sport, enregistrez puis vérifiez les champs ci-dessous.</small>
      </div>
      <div class="form-row">
        ${field('sport-fed', 'federation', 'Sigle de la fédération', 'Ex. : celui qui délivre les licences.')}
        ${field('sport-platform', 'platform', 'Plateforme des licences', 'Vide : « l’espace en ligne de la fédération ».')}
      </div>
      ${field('sport-fed-name', 'federationName', 'Nom complet de la fédération')}
      <div class="form-row">
        ${field('sport-tagline', 'tagline', 'Sous-titre du club dans les e-mails')}
        ${field('sport-equipment', 'equipment', 'Équipement à commander', 'Ex. : taille de maillot, de kimono. Vide si aucun.')}
      </div>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('check')}Enregistrer</button></div>
    </form>
  </section>`;
}

// Champs propres au club (custom-fields.js) : liste, ajout, suppression, suggestions du sport.
function customFieldsSection(fields, sport, { customOk = '', customError = '' } = {}) {
  const suggestions = (SPORT_SUGGESTIONS[sport.sport] || []).filter((s) => !fields.some((f) => f.key === s.key));
  const typeLabel = { text: 'Texte', select: 'Liste de choix', number: 'Nombre' };
  const rows = fields.length
    ? fields
        .map(
          (f) => `<li class="adm-user-row adm-club-row">
        <div><h3>${escapeHtml(f.label)} ${f.required ? '<span class="adm-tag is-no">Obligatoire</span>' : ''}</h3>
        <p>${escapeHtml(typeLabel[f.type])}${f.options.length ? ` : ${escapeHtml(f.options.join(', '))}` : ''}</p></div>
        <div class="adm-user-actions"><form method="POST" class="admin-confirm-form"><input type="hidden" name="action" value="custom-remove"><input type="hidden" name="key" value="${escapeHtml(f.key)}">
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-danger" data-confirm="Retirer le champ « ${escapeHtml(f.label)} » du formulaire ? Les réponses déjà enregistrées sont conservées.">${icon('trash')}Retirer</button></form></div>
      </li>`
        )
        .join('')
    : '<p class="adm-help">Aucun champ pour le moment.</p>';
  return `<section class="adm-surface" id="champs">
    <h2 class="adm-h2">${icon('edit')}Champs du formulaire d’inscription</h2>
    <p class="adm-help" style="margin-top:8px;">Informations propres à votre sport (ceinture, classement, niveau…), demandées à l’inscription et visibles sur chaque fiche. ${MAX_CUSTOM_FIELDS} au plus.</p>
    ${customOk ? flash('ok', customOk) : ''}
    ${customError ? flash('error', customError) : ''}
    <ul class="adm-users" role="list">${rows}</ul>
    ${
      suggestions.length
        ? `<form method="POST" style="margin-top:12px;"><input type="hidden" name="action" value="custom-suggest">
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('plus')}Ajouter les champs suggérés (${escapeHtml(suggestions.map((s) => s.label).join(', '))})</button></form>`
        : ''
    }
    ${
      fields.length < MAX_CUSTOM_FIELDS
        ? `<details class="adm-fold" style="margin-top:12px;"><summary><span>Ajouter un champ</span></summary>
      <form method="POST">
        <input type="hidden" name="action" value="custom-add">
        <div class="form-row">
          <div class="form-field"><label for="cf-label">Libellé</label><input type="text" id="cf-label" name="label" maxlength="80" required></div>
          <div class="form-field"><label for="cf-type">Type</label><select id="cf-type" name="type" class="adm-select"><option value="text">Texte</option><option value="select">Liste de choix</option><option value="number">Nombre</option></select></div>
        </div>
        <div class="form-field"><label for="cf-options">Choix possibles (liste de choix : un par ligne)</label><textarea id="cf-options" name="options" rows="4" maxlength="1500"></textarea></div>
        <label class="form-check adm-scope-check"><input type="checkbox" name="required"> <span>Réponse obligatoire</span></label>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('plus')}Ajouter le champ</button></div>
      </form></details>`
        : ''
    }
  </section>`;
}

function page({ notificationEmail, emailError, emailOk, auto, badges, family, sport, sportOk, customFields = [], customOk = '', customError = '', due = [] }) {
  return `${adminHead('Paramètres')}
${adminShell({
  active: 'parametres',
  badges,
  eyebrow: 'Espace admin',
  title: 'Paramètres',
  subtitle: 'E-mails du site, automatisations et conservation des données.',
})}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('mail')}Adresses du club</h2>
    <p class="adm-help" style="margin-top:8px;">Reçoivent les nouvelles inscriptions, les alertes de dépôt, les paiements HelloAsso à rattacher et le récapitulatif du lundi.</p>
    ${emailOk ? flash('ok', 'Adresse mise à jour.') : ''}
    ${emailError ? flash('error', emailError) : ''}
    <form method="POST">
      <input type="hidden" name="action" value="notification-email">
      <div class="form-field">
        <label for="notification-email">E-mail(s) du club (séparés par une virgule)</label>
        <input type="text" id="notification-email" name="notificationEmail" value="${escapeHtml(notificationEmail)}" required>
      </div>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('check')}Enregistrer</button></div>
    </form>
  </section>

  ${sportSection(sport, { sportOk })}
  ${customFieldsSection(customFields, sport, { customOk, customError })}

  ${familyInfoSection(family)}

  ${automationsSection(auto)}

  ${retentionSection(due)}

  <section class="adm-surface">
    <h2 class="adm-h2">${icon('lock')}Accès à l’espace admin</h2>
    <p class="adm-help" style="margin-top:8px;">Chaque responsable a son propre compte. Invitez une personne, changez son rôle ou retirez son accès dans <a class="adm-link" href="/admin/utilisateurs">Utilisateurs</a> ; changez votre mot de passe dans <a class="adm-link" href="/admin/compte">Mon compte</a>.</p>
  </section>
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

async function render(request, env, organizationId, props, { status = 200, headers = {}, message, error } = {}) {
  const credentials = await helloAssoCredentials(env, organizationId);
  const auto = {
    config: await getAutomationsConfig(env, organizationId),
    cron: await getCronState(env, organizationId),
    siteUrl: new URL(request.url).origin,
    brevo: mailConfigured(env),
    mailVia: env.SMTP_PASSWORD ? (env.BREVO_API_KEY ? 'Infomaniak, secours Brevo' : 'Infomaniak') : 'Brevo',
    webhookSecret: credentials.webhookSecret || '',
    helloassoApi: Boolean(credentials.clientId && credentials.clientSecret),
    helloassoClientId: Boolean(credentials.clientId),
    helloassoClientSecret: Boolean(credentials.clientSecret),
    secretsReady: secretsConfigured(env),
    cronSecret: Boolean(env.CRON_SECRET),
    message,
    error,
  };
  const badges = await adminBadges(env, { organizationId });
  let family = { whatsappUrl: '' };
  try {
    family = await getFamilyInfo(env, organizationId);
  } catch {
    // KV indisponible : champ vide.
  }
  const due = await retentionDue(env.DB, organizationId).catch(() => null);
  const sport = await getSportProfile(env, organizationId);
  const customFields = await getCustomFields(env, organizationId);
  return new Response(page({ ...props, auto, badges, due, sport, customFields, family: { ...family, ...(props.family || {}) } }), { status, headers: { 'Content-Type': 'text/html;charset=UTF-8', ...headers } });
}

// Dernier passage du cron, et dernier échec s'il est plus récent (voir recordCronFailure dans functions/api/cron.js).
const cronDate = (iso) => formatDateFr(String(iso).replace('T', ' ').slice(0, 19), { dateStyle: 'short', timeStyle: 'short' });
function cronStatus(cron) {
  const last = cron.lastRun ? `Dernier passage réussi : ${cronDate(cron.lastRun)}` : 'Jamais exécutées';
  const failure = cron.lastFailure;
  if (!failure || (cron.lastRun && cron.lastRun >= failure.at)) return last;
  return `<span class="adm-tag is-no">${icon('alert')}Échec le ${cronDate(failure.at)} (${escapeHtml(failure.step || '—')})</span> ${last}`;
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }
  const notificationEmail = await getNotificationEmail(env, admin.organizationId);
  return render(request, env, admin.organizationId, { notificationEmail });
}

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  const form = await request.formData();
  const action = form.get('action');
  const org = admin.organizationId;
  const notificationEmail = await getNotificationEmail(env, org);
  const siteUrl = new URL(request.url).origin;

  if (action === 'notification-email') {
    const value = String(form.get('notificationEmail') || '').trim();
    const addresses = value.split(',').map((a) => a.trim()).filter(Boolean);
    const allValid = addresses.length > 0 && addresses.every((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
    if (!allValid) {
      return render(request, env, admin.organizationId, { notificationEmail: value, emailError: 'Une ou plusieurs adresses ne sont pas valides.' }, { status: 400 });
    }
    await setNotificationEmail(env, org, addresses.join(', '));
    return render(request, env, admin.organizationId, { notificationEmail: addresses.join(', '), emailOk: true });
  }

  if (action === 'family-info') {
    const input = String(form.get('whatsappUrl') || '').trim().slice(0, 300);
    const whatsappUrl = normalizeWhatsappUrl(input);
    if (input && !whatsappUrl) {
      return render(request, env, org, { notificationEmail, family: { whatsappInput: input, familyError: 'Ce lien n’est pas un lien d’invitation WhatsApp (il doit commencer par https://chat.whatsapp.com/).' } }, { status: 400 });
    }
    await setFamilyInfo(env, org, { whatsappUrl: whatsappUrl || '' });
    return render(request, env, org, { notificationEmail, family: { whatsappUrl: whatsappUrl || '', familyOk: true } });
  }

  if (action === 'automations') {
    const config = Object.fromEntries(Object.keys(DEFAULT_AUTOMATIONS).map((key) => [key, form.get(key) === 'on']));
    await setAutomationsConfig(env, org, config);
    return render(request, env, admin.organizationId, { notificationEmail }, { message: 'Automatisations enregistrées.' });
  }

  if (action === 'sport') {
    const previous = await getSportProfile(env, org);
    const sport = String(form.get('sport') || '');
    // Sport changé : les champs affichés étaient ceux de l'ancien sport, on repart du nouveau préréglage.
    const fields = sport === previous.sport ? Object.fromEntries(['federation', 'federationName', 'platform', 'tagline', 'equipment'].map((f) => [f, form.get(f)])) : {};
    await setSportProfile(env, org, { sport, ...fields });
    return render(request, env, org, { notificationEmail, sportOk: true });
  }

  if (action === 'custom-add' || action === 'custom-remove' || action === 'custom-suggest') {
    const current = await getCustomFields(env, org);
    let next = current;
    if (action === 'custom-remove') next = current.filter((f) => f.key !== String(form.get('key') || ''));
    if (action === 'custom-suggest') next = [...current, ...(SPORT_SUGGESTIONS[(await getSportProfile(env, org)).sport] || []).filter((s) => !current.some((f) => f.key === s.key))];
    if (action === 'custom-add') {
      const type = String(form.get('type') || 'text');
      const options = String(form.get('options') || '').split(/\r?\n/).map((o) => o.trim()).filter(Boolean);
      if (type === 'select' && options.length < 2) return render(request, env, org, { notificationEmail, customError: 'Une liste de choix demande au moins deux choix.' }, { status: 400 });
      const label = String(form.get('label') || '').trim();
      if (!label) return render(request, env, org, { notificationEmail, customError: 'Libellé requis.' }, { status: 400 });
      next = [...current, { label, type, options, required: form.get('required') === 'on', key: slugKey(label) }];
    }
    const saved = await setCustomFields(env, org, next);
    return render(request, env, org, { notificationEmail, customOk: action === 'custom-remove' ? 'Champ retiré du formulaire.' : `Champs du formulaire : ${saved.length}.` });
  }

  if (action === 'helloasso' || action === 'helloasso-clear') {
    if (!secretsConfigured(env)) return render(request, env, org, { notificationEmail }, { error: 'Enregistrement impossible : clé de chiffrement de la plateforme absente.', status: 503 });
    try {
      if (action === 'helloasso-clear') {
        await saveHelloAssoCredentials(env, org, { webhookSecret: null, clientId: null, clientSecret: null });
        return render(request, env, org, { notificationEmail }, { message: 'Identifiants HelloAsso effacés.' });
      }
      const clientId = String(form.get('clientId') || '').trim();
      const clientSecret = String(form.get('clientSecret') || '').trim();
      await saveHelloAssoCredentials(env, org, {
        clientId: clientId || undefined,
        clientSecret: clientSecret || undefined,
        webhookSecret: form.get('newWebhook') === 'on' ? generateWebhookSecret() : undefined,
      });
    } catch {
      return render(request, env, org, { notificationEmail }, { error: 'Identifiant ou secret invalide (lettres, chiffres et . _ - ~ + / = uniquement).', status: 400 });
    }
    return render(request, env, org, { notificationEmail }, { message: 'Identifiants HelloAsso enregistrés.' });
  }

  if (action === 'run-reminders') {
    if (!mailConfigured(env)) return render(request, env, admin.organizationId, { notificationEmail }, { error: 'Aucun service d’envoi configuré (SMTP_PASSWORD ou BREVO_API_KEY) : aucun e-mail ne peut partir.' });
    const { sent, failed } = await runReminders(env, admin.organizationId, siteUrl);
    return render(request, env, admin.organizationId, { notificationEmail }, {
      message: `${sent} relance${sent > 1 ? 's' : ''} envoyée${sent > 1 ? 's' : ''}${failed ? `, ${failed} échec${failed > 1 ? 's' : ''}` : ''}.`,
    });
  }

  if (action === 'send-summary') {
    const ok = await sendWeeklySummary(env, siteUrl, await buildWeeklySummary(env, admin.organizationId), 'manuel');
    return render(request, env, admin.organizationId, { notificationEmail }, ok ? { message: 'Récapitulatif envoyé.' } : { error: 'Échec de l’envoi du récapitulatif (vérifiez le service d’envoi et les adresses du club).' });
  }

  return render(request, env, admin.organizationId, { notificationEmail });
}
