// Newsletter (2026-11-13) : le club écrit un texte, toutes les familles le reçoivent (une adresse = un e-mail, personne
// ne voit les autres adresses), avec un lien de désinscription tout en bas. Trois étapes comme /admin/email :
// rédaction → vérification (aperçu exact, nombre d'adresses, essai au club) → envoi. Règles dans _shared/newsletter.js.
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash } from '../_shared/admin-auth.js';
import { ensureInscriptionsTable } from '../_shared/inscriptions-db.js';
import { mailConfigured, sendNewsletter, buildNewsletter, clubRecipientsFor } from '../_shared/confirmation-email.js';
import {
  newsletterAudience,
  recordNewsletter,
  listNewsletters,
  unsubscribeUrl,
  MAX_RECIPIENTS,
  SUBJECT_MAX,
  MESSAGE_MAX,
  listScheduled,
  scheduleNewsletter,
  cancelScheduled,
  parisToDate,
  parisToday,
  checkSchedule,
  formatParis,
  toSqlUtc,
  SCHEDULE_MAX_DAYS,
} from '../_shared/newsletter.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

function readForm(form) {
  return {
    subject: String(form.get('subject') || '').replace(/[\r\n]+/g, ' ').trim(),
    message: String(form.get('message') || '').trim(),
    greet: form.get('greet') === '1',
    day: String(form.get('jour') || ''),
    time: String(form.get('heure') || ''),
  };
}

function validate(input) {
  if (!input.subject) return 'Indiquez un objet.';
  if (input.subject.length > SUBJECT_MAX) return `Objet trop long (${SUBJECT_MAX} caractères au plus).`;
  if (!input.message) return 'Écrivez le texte de la newsletter.';
  if (input.message.length > MESSAGE_MAX) return `Texte trop long (${MESSAGE_MAX} caractères au plus).`;
  return null;
}

const hidden = (input) => `<input type="hidden" name="subject" value="${escapeHtml(input.subject)}">
        <input type="hidden" name="message" value="${escapeHtml(input.message)}">
        <input type="hidden" name="greet" value="${input.greet ? '1' : '0'}">`;

const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

function shell(title, badges) {
  return `${adminHead(title)}
${adminShell({ active: 'newsletter', badges, eyebrow: 'Communication', title: 'Newsletter', subtitle: 'Un message à toutes les familles, avec un lien de désinscription en bas de chaque e-mail.' })}`;
}

function audienceSummary(audience) {
  const n = audience.recipients.length;
  const off = audience.unsubscribed.length;
  return `<p class="adm-email-to"><span>À</span><strong>Toutes les familles : ${plural(n, 'adresse')}</strong></p>
    <p class="adm-help">Responsables des inscriptions en cours et des pré-inscriptions en attente, une seule fois par adresse.${
      off ? ` ${plural(off, 'adresse désinscrite', 'adresses désinscrites')} ne la ${off > 1 ? 'recevront' : 'recevra'} pas.` : ''
    }</p>`;
}

function historyStatus(h) {
  if (h.status === 'annulee') return `Programmée pour ${formatParis(h.scheduled_for)}, annulée`;
  if (h.status === 'echec') return `Non envoyée : ${h.error || 'erreur'}`;
  if (h.status === 'en_cours') return 'Envoi en cours ou interrompu (vérifiez le journal avant de la renvoyer)';
  return `${formatParis(h.sent_at || h.created_at)} · ${plural(h.sent_count, 'envoi')}${h.failed_count ? `, ${h.failed_count} en échec` : ''}`;
}

function scheduledSection(scheduled) {
  if (!scheduled.length) return '';
  const rows = scheduled
    .map(
      (n) => `<li class="adm-nl-sched">
        <div class="adm-nl-sched-head">
          <p><span class="adm-nl-when">${icon('calendar')}${escapeHtml(formatParis(n.scheduled_for))}</span><strong>${escapeHtml(n.subject)}</strong></p>
          <form method="POST" class="admin-confirm-form">
            <input type="hidden" name="action" value="cancel">
            <input type="hidden" name="id" value="${n.id}">
            <button type="submit" class="adm-btn adm-btn-ghost adm-btn-sm" data-confirm="Annuler l’envoi programmé de « ${escapeHtml(n.subject)} » ?">Annuler l’envoi</button>
          </form>
        </div>
        <details class="adm-fold"><summary>Voir le texte</summary><p class="adm-help adm-nl-text">${escapeHtml(n.message).replace(/\n/g, '<br>')}</p></details>
      </li>`
    )
    .join('');
  return `<section class="adm-surface adm-nl-scheduled">
    <h2 class="adm-h2">${icon('calendar')}Programmées (${scheduled.length})</h2>
    <ul class="adm-nl-sched-list">${rows}</ul>
    <p class="adm-help">Envoyées automatiquement à l’heure prévue (à 15 minutes près), aux familles inscrites à ce moment-là. Pour changer le texte : annulez, puis programmez la nouvelle version.</p>
  </section>`;
}

function historySection(history) {
  if (!history.length) return '';
  const rows = history
    .map(
      (h) => `<details class="adm-fold">
        <summary><strong>${escapeHtml(h.subject)}</strong> · ${escapeHtml(historyStatus(h))}</summary>
        <p class="adm-help adm-nl-text">${escapeHtml(h.message).replace(/\n/g, '<br>')}</p>
      </details>`
    )
    .join('');
  return `<section class="adm-surface">
    <h2 class="adm-h2">${icon('activity')}Newsletters envoyées</h2>
    ${rows}
    <p class="adm-help"><a href="/admin/events?type=newsletter">Voir chaque envoi dans le journal des e-mails</a></p>
  </section>`;
}

function unsubscribedSection(audience) {
  if (!audience.unsubscribed.length) return '';
  const items = audience.unsubscribed
    .map((u) => `<li>${escapeHtml(`${u.prenom} ${u.nom}`.trim() || u.email)} <span class="adm-help">(${escapeHtml(u.email)} · ${escapeHtml(u.children.join(', '))})</span></li>`)
    .join('');
  return `<section class="adm-surface">
    <details class="adm-fold">
      <summary class="adm-h2">${icon('mail')}Désinscrits de la newsletter (${audience.unsubscribed.length})</summary>
      <p class="adm-help">Ils continuent de recevoir les e-mails liés à l’inscription (dossier, paiement, relances). Seule la personne peut se réinscrire, depuis le lien de désinscription.</p>
      <ul class="adm-nl-list">${items}</ul>
    </details>
  </section>`;
}

// Barre d'outils : chaque bouton insère un repère simple (voir newsletterBlocks dans confirmation-email.js).
const TOOLS = [
  ['h2', 'Titre', 'Titre de section'],
  ['h3', 'Sous-titre', 'Sous-titre'],
  ['bold', 'Gras', 'Mettre en gras le texte sélectionné'],
  ['list', 'Liste', 'Liste à puces'],
  ['link', 'Lien', 'Lien dans le texte'],
  ['button', 'Bouton', 'Bouton vers une page'],
  ['hr', 'Séparateur', 'Ligne de séparation'],
];

const SYNTAX_HELP = `<details class="adm-nl-help">
        <summary>Mise en forme : comment ça marche ?</summary>
        <ul>
          <li><code>## Titre</code> : titre de section (souligné) ; <code>### Sous-titre</code></li>
          <li><code>**texte**</code> : gras</li>
          <li><code>- élément</code> en début de ligne : liste à puces</li>
          <li><code>[texte](https://…)</code> : lien ; seul sur sa ligne, il devient un bouton</li>
          <li><code>---</code> seul sur sa ligne : séparateur</li>
          <li>Une ligne vide sépare deux paragraphes. Les adresses https:// deviennent cliquables.</li>
        </ul>
      </details>`;

function composePage(input, audience, history, { error = null, notice = null, badges, siteUrl, scheduled = [] }) {
  const first = audience.recipients[0];
  const initial = first && (input.subject || input.message)
    ? buildNewsletter(first, { ...input, siteUrl, unsubscribeUrl: unsubscribeUrl(siteUrl, first.token) }).html
    : '';
  return `${shell('Newsletter', badges)}
<main id="adm-main" class="adm-wrap adm-main adm-nl-main">
  ${error ? flash('error', error) : ''}
  ${notice ? flash('ok', notice) : ''}
  ${scheduledSection(scheduled)}
  <div class="adm-nl-views" role="tablist" aria-label="Rédaction ou aperçu" hidden data-nl-views>
    <button type="button" role="tab" aria-selected="true" data-nl-view="edit">${icon('edit')}Texte</button>
    <button type="button" role="tab" aria-selected="false" data-nl-view="preview">${icon('eye')}Aperçu</button>
  </div>
  <form method="POST" class="adm-nl-layout" data-nl-editor>
    <input type="hidden" name="action" value="preview">
    <section class="adm-surface adm-nl-edit">
      <h2 class="adm-h2">${icon('edit')}Nouvelle newsletter</h2>
      ${audienceSummary(audience)}
      <p class="adm-nl-draft" data-nl-draft hidden><span>Brouillon retrouvé sur cet appareil.</span> <button type="button" class="adm-btn adm-btn-ghost adm-btn-sm" data-nl-discard>Repartir d’une page blanche</button></p>
      <div class="form-field">
        <label for="nl-subject">Objet</label>
        <input type="text" id="nl-subject" name="subject" maxlength="${SUBJECT_MAX}" value="${escapeHtml(input.subject)}" required placeholder="Ex. : Les nouvelles du club, novembre">
      </div>
      <div class="form-field">
        <label for="nl-message">Texte</label>
        <div class="adm-nl-toolbar" role="toolbar" aria-label="Mise en forme" aria-controls="nl-message" hidden data-nl-toolbar>
          ${TOOLS.map(([key, label, title]) => `<button type="button" class="adm-nl-tool adm-nl-tool-${key}" data-nl-insert="${key}" title="${title}">${label}</button>`).join('')}
        </div>
        <textarea id="nl-message" name="message" rows="18" maxlength="${MESSAGE_MAX}" required spellcheck="true" placeholder="## Titre de la première rubrique&#10;&#10;Votre texte…&#10;&#10;## Deuxième rubrique&#10;&#10;- un point&#10;- un autre point">${escapeHtml(input.message)}</textarea>
        <p class="adm-nl-count" data-nl-count aria-live="polite"></p>
      </div>
      ${SYNTAX_HELP}
      <label class="adm-check"><input type="checkbox" name="greet" value="1"${input.greet ? ' checked' : ''}><span>Commencer par « Bonjour [prénom], »</span></label>
      <p class="adm-help">Le lien « Se désinscrire de la newsletter » est ajouté automatiquement tout en bas de chaque e-mail. Le texte est gardé en brouillon sur cet appareil jusqu’à l’envoi.</p>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('send')}Vérifier, envoyer ou programmer</button></div>
    </section>
    <section class="adm-surface adm-nl-live" aria-label="Aperçu en direct">
      <h2 class="adm-h2">${icon('eye')}Aperçu en direct</h2>
      <p class="adm-help" data-nl-live-note>${first ? `Tel que ${escapeHtml(first.prenom || 'la première famille')} le recevra.` : 'Aucune famille pour le moment.'}</p>
      <iframe class="adm-email-preview adm-nl-frame" title="Aperçu en direct de la newsletter" sandbox srcdoc="${escapeHtml(initial || "<p style='font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#636d7a;padding:24px;margin:0;'>L’aperçu apparaît ici pendant que vous écrivez.</p>")}" data-nl-frame></iframe>
      <div class="adm-form-actions adm-nl-live-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('send')}Vérifier, envoyer ou programmer</button></div>
    </section>
  </form>
  <div class="adm-nl-below">
    ${historySection(history)}
    ${unsubscribedSection(audience)}
  </div>
</main>
${adminScripts('admin-nav', 'admin-newsletter')}
</body></html>`;
}

function previewPage(input, audience, siteUrl, { badges, notice = null, scheduleError = null }) {
  const first = audience.recipients[0];
  const { html: emailHtml } = buildNewsletter(first, { ...input, siteUrl, unsubscribeUrl: unsubscribeUrl(siteUrl, first.token) });
  const n = audience.recipients.length;
  return `${shell('Vérifier la newsletter', badges)}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  ${notice ? flash(notice.type, notice.text) : ''}
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('send')}Vérifier avant d’envoyer</h2>
    ${audienceSummary(audience)}
    <p class="adm-email-to"><span>Objet</span><strong>${escapeHtml(input.subject)}</strong></p>
    <p class="adm-help">Aperçu tel que ${escapeHtml(first.prenom || 'la première famille')} le recevra${n > 1 && input.greet ? ' (le prénom change pour chaque adresse)' : ''} :</p>
    <iframe class="adm-email-preview" title="Aperçu de la newsletter" sandbox srcdoc="${escapeHtml(emailHtml)}"></iframe>
    <div class="adm-form-actions adm-email-actions">
      <form method="POST" data-once>
        <input type="hidden" name="action" value="send">
        ${hidden(input)}
        <button type="submit" class="adm-btn adm-btn-primary">${icon('send')}Envoyer à ${plural(n, 'adresse')}</button>
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
    <p class="adm-help">L’essai part aux adresses du club (Paramètres). L’envoi peut prendre une à deux minutes : gardez la page ouverte.</p>
  </section>
  <section class="adm-surface" id="programmer">
    <h2 class="adm-h2">${icon('calendar')}Ou programmer l’envoi</h2>
    ${scheduleError ? flash('error', scheduleError) : ''}
    <form method="POST" class="adm-nl-schedule" data-once>
      <input type="hidden" name="action" value="schedule">
      ${hidden(input)}
      <div class="form-field">
        <label for="nl-jour">Date</label>
        <input type="date" id="nl-jour" name="jour" required min="${parisToday()}" max="${parisToday(new Date(Date.now() + SCHEDULE_MAX_DAYS * 86400000))}" value="${escapeHtml(input.day || parisToday(new Date(Date.now() + 86400000)))}">
      </div>
      <div class="form-field">
        <label for="nl-heure">Heure</label>
        <input type="time" id="nl-heure" name="heure" required step="900" value="${escapeHtml(input.time || '18:00')}">
      </div>
      <button type="submit" class="adm-btn adm-btn-primary">${icon('calendar')}Programmer</button>
    </form>
    <p class="adm-help">Heure de Paris. Envoi à l’heure choisie, à 15 minutes près, aux familles inscrites à ce moment-là (les désinscriptions faites d’ici là sont respectées). Annulable jusqu’à l’envoi.</p>
  </section>
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

function donePage(input, { sent, failed }, badges) {
  return `${shell('Newsletter envoyée', badges)}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  ${
    failed.length
      ? flash('error', `${plural(sent, 'envoi')} réussi${sent > 1 ? 's' : ''}, ${failed.length} en échec : ${failed.join(', ')}.`)
      : flash('ok', `Newsletter « ${input.subject} » envoyée à ${plural(sent, 'adresse')}.`)
  }
  <span data-nl-sent hidden></span>
  <section class="adm-surface">
    <div class="adm-form-actions">
      <a class="adm-btn adm-btn-ghost" href="/admin/events?type=newsletter">${icon('activity')}Voir le journal</a>
      <a class="adm-btn adm-btn-primary" href="/admin/newsletter">${icon('edit')}Nouvelle newsletter</a>
    </div>
  </section>
</main>
${adminScripts('admin-nav', 'admin-newsletter')}
</body></html>`;
}

function scheduledDonePage(input, when, badges) {
  return `${shell('Newsletter programmée', badges)}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  ${flash('ok', `Newsletter « ${input.subject} » programmée pour ${when}.`)}
  <span data-nl-sent hidden></span>
  <section class="adm-surface">
    <p class="adm-help">Elle partira automatiquement. Vous pouvez l’annuler depuis la page Newsletter jusqu’à l’envoi.</p>
    <div class="adm-form-actions">
      <a class="adm-btn adm-btn-primary" href="/admin/newsletter">${icon('arrowLeft')}Retour à la newsletter</a>
    </div>
  </section>
</main>
${adminScripts('admin-nav', 'admin-newsletter')}
</body></html>`;
}

async function loadAudience(env, organizationId) {
  await ensureInscriptionsTable(env.DB);
  return newsletterAudience(env.DB, organizationId);
}

async function compose(env, admin, input, error = null, status = 200, siteUrl = '', notice = null) {
  const [badges, audience, history, scheduled] = await Promise.all([
    adminBadges(env, admin),
    loadAudience(env, admin.organizationId),
    listNewsletters(env.DB, admin.organizationId),
    listScheduled(env.DB, admin.organizationId),
  ]);
  return html(composePage(input, audience, history, { error, notice, badges, siteUrl, scheduled }), status);
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  return compose(env, admin, { subject: '', message: '', greet: true }, null, 200, new URL(request.url).origin);
}

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  const form = await request.formData();
  const action = String(form.get('action') || '');
  const input = readForm(form);
  const siteUrl = new URL(request.url).origin;
  // Aperçu en direct pendant la saisie (assets/js/admin-newsletter.js) : rendu exact pour la première adresse, rien d'envoyé.
  if (action === 'render') {
    const audience = await loadAudience(env, admin.organizationId);
    const first = audience.recipients[0] || { email: '', prenom: 'Prénom', nom: '', token: '0'.repeat(64) };
    const message = input.message.slice(0, MESSAGE_MAX);
    const { html: body } = buildNewsletter(first, { ...input, message, subject: input.subject || 'Objet de la newsletter', siteUrl, unsubscribeUrl: unsubscribeUrl(siteUrl, first.token) });
    return Response.json({ html: body }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (action === 'edit') return compose(env, admin, input, null, 200, siteUrl);
  if (action === 'cancel') {
    const ok = await cancelScheduled(env.DB, admin.organizationId, Number(form.get('id')) || 0);
    const blank = { subject: '', message: '', greet: true };
    return ok
      ? compose(env, admin, blank, null, 200, siteUrl, 'Envoi programmé annulé : rien ne partira.')
      : compose(env, admin, blank, 'Cette newsletter n’est plus programmée (déjà envoyée ou annulée).', 409, siteUrl);
  }

  const fail = (message, status) => compose(env, admin, input, message, status, siteUrl);
  const error = validate(input);
  if (error) return fail(error, 400);
  if (!mailConfigured(env)) return fail('Aucun service d’envoi configuré : aucun e-mail ne peut partir.', 503);
  const audience = await loadAudience(env, admin.organizationId);
  if (!audience.recipients.length) return fail('Aucune famille à qui envoyer la newsletter.', 400);
  if (audience.recipients.length > MAX_RECIPIENTS) {
    return fail(`Trop d’adresses pour un seul envoi (${MAX_RECIPIENTS} au plus par jour avec la messagerie du club).`, 400);
  }

  const badges = await adminBadges(env, admin);
  if (action === 'preview') return html(previewPage(input, audience, siteUrl, { badges }));

  if (action === 'schedule') {
    const date = parisToDate(input.day, input.time);
    const problem = checkSchedule(date);
    if (problem) return html(previewPage(input, audience, siteUrl, { badges, scheduleError: problem }), 400);
    await scheduleNewsletter(env.DB, admin.organizationId, { ...input, date });
    return html(scheduledDonePage(input, formatParis(toSqlUtc(date)), badges));
  }

  if (action === 'test') {
    const to = await clubRecipientsFor(env, admin.organizationId);
    const first = audience.recipients[0];
    const ok = to.length
      ? await sendNewsletter(env, first, { ...input, siteUrl, unsubscribeUrl: unsubscribeUrl(siteUrl, first.token), to, organizationId: admin.organizationId })
      : false;
    const notice = ok ? { type: 'ok', text: `Essai envoyé à ${to.map((r) => r.email).join(', ')}.` } : { type: 'error', text: 'L’essai n’a pas pu partir.' };
    return html(previewPage(input, audience, siteUrl, { badges, notice }));
  }

  if (action === 'send') {
    let sent = 0;
    const failed = [];
    for (const recipient of audience.recipients) {
      const ok = await sendNewsletter(env, recipient, {
        ...input,
        siteUrl,
        unsubscribeUrl: unsubscribeUrl(siteUrl, recipient.token),
        inscriptionId: recipient.inscriptionId,
        organizationId: admin.organizationId,
      });
      if (ok) sent += 1;
      else failed.push(recipient.email);
    }
    await recordNewsletter(env.DB, admin.organizationId, { subject: input.subject, message: input.message, greet: input.greet, sent, failed: failed.length });
    return html(donePage(input, { sent, failed }, badges));
  }
  return fail('Action inconnue.', 400);
}
