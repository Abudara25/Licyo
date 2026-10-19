// Réglages du club : l'adresse qui reçoit les e-mails du site (voir _shared/settings-kv.js), les infos envoyées aux
// familles, les automatisations (_shared/automations.js) et la durée de conservation. Depuis les comptes nominatifs
// (phase 3, 2026-10-20), il n'y a plus de mot de passe partagé ici : chacun gère le sien dans « Mon compte »
// (/admin/compte) et les accès se gèrent dans « Utilisateurs » (/admin/utilisateurs).
import { retentionDue, RETENTION_YEARS } from '../_shared/retention.js';
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
import { helloAssoCredentials } from '../_shared/integrations.js';

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

function page({ notificationEmail, emailError, emailOk, auto, badges, family, due = [] }) {
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
  const auto = {
    config: await getAutomationsConfig(env, organizationId),
    cron: await getCronState(env, organizationId),
    siteUrl: new URL(request.url).origin,
    brevo: mailConfigured(env),
    mailVia: env.SMTP_PASSWORD ? (env.BREVO_API_KEY ? 'Infomaniak, secours Brevo' : 'Infomaniak') : 'Brevo',
    webhookSecret: helloAssoCredentials(env, organizationId).webhookSecret || '',
    helloassoApi: Boolean(helloAssoCredentials(env, organizationId).clientId && helloAssoCredentials(env, organizationId).clientSecret),
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
  return new Response(page({ ...props, auto, badges, due, family: { ...family, ...(props.family || {}) } }), { status, headers: { 'Content-Type': 'text/html;charset=UTF-8', ...headers } });
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
