// Console plateforme (permission platform.manage, administrateurs listés dans PLATFORM_ADMIN_EMAILS) : liste des clubs,
// création d'un club avec l'invitation de son responsable, ajout d'un domaine, suspension et réactivation. Aucune donnée
// d'adhérent n'est lue ici. Voir functions/_shared/platform.js.
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash, formatDateFr } from '../_shared/admin-auth.js';
import { ensureSchema } from '../_shared/inscriptions-db.js';
import { AccountError, logAudit } from '../_shared/accounts.js';
import { listOrganizations, createOrganization, setOrganizationStatus, addDomain, ORGANIZATION_STATUSES } from '../_shared/platform.js';
import { SPORT_PRESETS, SPORT_KEYS } from '../_shared/sport-profile.js';
import { sendAdminInvitation } from '../_shared/confirmation-email.js';
import { clearOrganizationCache } from '../_shared/organization.js';
import { createStarterSite } from '../_shared/site-editor.js';
import { PLANS, SUBSCRIPTION_STATUSES, PAYMENT_METHODS, listSubscriptions, billingStats, updateSubscription, recordPayment, dueDate, formatEuros, BillingError } from '../_shared/billing.js';

// Abonnement d'un club (billing.js) : état, échéance, formulaires de suivi.
function subscriptionBlock(o, sub) {
  if (!sub?.status) {
    return `<form method="POST" class="adm-domain-form"><input type="hidden" name="action" value="subscription"><input type="hidden" name="organizationId" value="${escapeHtml(o.id)}"><input type="hidden" name="plan" value="club">
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('plus')}Suivre un abonnement</button></form>`;
  }
  const due = dueDate(sub);
  const tone = { trial: 'is-wait', active: 'is-yes', past_due: 'is-no', cancelled: 'is-no' }[sub.status] || '';
  return `<div class="adm-sub">
      <p><span class="adm-tag ${tone}">${escapeHtml(SUBSCRIPTION_STATUSES[sub.status])}</span> ${escapeHtml(PLANS[sub.plan]?.label || sub.plan)} · ${escapeHtml(formatEuros(sub.monthly_price_cents))} / mois${due ? ` · échéance ${escapeHtml(due.split('-').reverse().join('/'))}` : ''}${sub.last_paid_at ? ` · dernier paiement ${escapeHtml(sub.last_paid_at.split('-').reverse().join('/'))}` : ''}</p>
      <details class="adm-fold"><summary><span>Modifier l’abonnement</span></summary>
        <form method="POST"><input type="hidden" name="action" value="subscription"><input type="hidden" name="organizationId" value="${escapeHtml(o.id)}">
          <div class="form-row">
            <div class="form-field"><label for="plan-${escapeHtml(o.id)}">Formule</label><select id="plan-${escapeHtml(o.id)}" name="plan" class="adm-select">${Object.entries(PLANS).map(([k, p]) => `<option value="${k}"${k === sub.plan ? ' selected' : ''}>${escapeHtml(p.label)} (${escapeHtml(formatEuros(p.price))})</option>`).join('')}</select></div>
            <div class="form-field"><label for="status-${escapeHtml(o.id)}">État</label><select id="status-${escapeHtml(o.id)}" name="subStatus" class="adm-select">${Object.entries(SUBSCRIPTION_STATUSES).map(([k, l]) => `<option value="${k}"${k === sub.status ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></div>
          </div>
          <div class="form-field"><label for="price-${escapeHtml(o.id)}">Prix mensuel (€)</label><input type="text" inputmode="decimal" id="price-${escapeHtml(o.id)}" name="price" value="${(Number(sub.monthly_price_cents) / 100).toFixed(2)}"></div>
          <div class="form-field"><label for="notes-${escapeHtml(o.id)}">Notes internes</label><textarea id="notes-${escapeHtml(o.id)}" name="notes" rows="2" maxlength="1000">${escapeHtml(sub.notes || '')}</textarea></div>
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">Enregistrer</button>
        </form>
      </details>
      <details class="adm-fold"><summary><span>Enregistrer un paiement reçu</span></summary>
        <form method="POST"><input type="hidden" name="action" value="payment"><input type="hidden" name="organizationId" value="${escapeHtml(o.id)}">
          <div class="form-row">
            <div class="form-field"><label for="amount-${escapeHtml(o.id)}">Montant (€)</label><input type="text" inputmode="decimal" id="amount-${escapeHtml(o.id)}" name="amount" value="${(Number(sub.monthly_price_cents) / 100).toFixed(2)}" required></div>
            <div class="form-field"><label for="months-${escapeHtml(o.id)}">Mois couverts</label><input type="number" min="1" max="24" id="months-${escapeHtml(o.id)}" name="months" value="1" required></div>
          </div>
          <div class="form-row">
            <div class="form-field"><label for="method-${escapeHtml(o.id)}">Moyen</label><select id="method-${escapeHtml(o.id)}" name="method" class="adm-select">${Object.entries(PAYMENT_METHODS).map(([k, l]) => `<option value="${k}">${escapeHtml(l)}</option>`).join('')}</select></div>
            <div class="form-field"><label for="ref-${escapeHtml(o.id)}">Référence</label><input type="text" id="ref-${escapeHtml(o.id)}" name="reference" maxlength="80"></div>
          </div>
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary" data-once>${icon('check')}Enregistrer le paiement</button>
        </form>
      </details>
    </div>`;
}

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

function clubRow(o, currentId, sub = null) {
  const active = o.status === 'active';
  return `<li class="adm-user-row adm-club-row">
    <div>
      <h3>${escapeHtml(o.name)} <span class="adm-tag ${active ? 'is-yes' : 'is-no'}">${escapeHtml(ORGANIZATION_STATUSES[o.status] || o.status)}</span></h3>
      <p>${escapeHtml(o.slug)} · ${escapeHtml(o.domains || 'aucun domaine')}</p>
      ${subscriptionBlock(o, sub)}
      <p>${Number(o.members) || 0} compte(s) actif(s)${Number(o.invited) ? `, ${Number(o.invited)} invitation(s) en attente` : ''} · créé le ${escapeHtml(formatDateFr(o.created_at, { dateStyle: 'short' }) || o.created_at)}</p>
    </div>
    <div class="adm-user-actions">
      <form method="POST" class="adm-domain-form">
        <input type="hidden" name="action" value="domain"><input type="hidden" name="organizationId" value="${escapeHtml(o.id)}">
        <label class="visually-hidden" for="domain-${escapeHtml(o.id)}">Ajouter un domaine à ${escapeHtml(o.name)}</label>
        <input type="text" id="domain-${escapeHtml(o.id)}" name="domain" placeholder="www.monclub.fr" maxlength="253">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">Ajouter</button>
      </form>
      ${o.id === currentId ? '<p class="form-hint">Club de votre session : non suspendable ici.</p>' : `<form method="POST" class="admin-confirm-form">
        <input type="hidden" name="action" value="status"><input type="hidden" name="organizationId" value="${escapeHtml(o.id)}"><input type="hidden" name="status" value="${active ? 'suspended' : 'active'}">
        <button type="submit" class="adm-btn adm-btn-sm ${active ? 'adm-btn-danger' : 'adm-btn-ghost'}" data-confirm="${active ? `Suspendre ${escapeHtml(o.name)} ? Son site et son admin deviennent inaccessibles (aucune donnée supprimée).` : `Réactiver ${escapeHtml(o.name)} ?`}">${active ? 'Suspendre' : 'Réactiver'}</button>
      </form>`}
    </div>
  </li>`;
}

async function render(env, admin, { message = '', error = '', values = {}, status = 200 } = {}) {
  const clubs = await listOrganizations(env.DB);
  const subscriptions = await listSubscriptions(env.DB);
  const subs = Object.fromEntries(subscriptions.map((s) => [s.organization_id, s]));
  const money = billingStats(subscriptions);
  const badges = await adminBadges(env, admin);
  const v = (k) => escapeHtml(values[k] || '');
  return html(
    `${adminHead('Console plateforme')}
${adminShell({
  active: 'plateforme',
  badges,
  eyebrow: 'Licyo',
  title: 'Console plateforme',
  subtitle: 'Clubs clients, domaines et mise en service. Aucune donnée d’adhérent n’est visible ici.',
  stats: [
    { value: clubs.filter((c) => c.status === 'active').length, label: 'Clubs actifs' },
    { value: formatEuros(money.mrrCents).replace(',00', ''), label: 'Revenu mensuel' },
    { value: money.trials, label: 'En essai' },
    { value: money.pastDue, label: 'En retard' },
  ],
})}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('plus')}Nouveau club</h2>
    ${message ? flash('ok', message) : ''}
    ${error ? flash('error', error) : ''}
    <form method="POST">
      <input type="hidden" name="action" value="create">
      <div class="form-row">
        <div class="form-field"><label for="club-name">Nom du club</label><input type="text" id="club-name" name="name" value="${v('name')}" required maxlength="100"></div>
        <div class="form-field"><label for="club-slug">Identifiant court <small>(facultatif)</small></label><input type="text" id="club-slug" name="slug" value="${v('slug')}" maxlength="50" placeholder="as-tennis-sportville"></div>
      </div>
      <div class="form-row">
        <div class="form-field"><label for="club-domain">Domaine</label><input type="text" id="club-domain" name="domain" value="${v('domain')}" required maxlength="253" placeholder="monclub.licyo.fr"><small class="form-hint">Le domaine doit pointer vers le projet Cloudflare Pages de Licyo.</small></div>
        <div class="form-field"><label for="club-sport">Sport</label><select id="club-sport" name="sport" class="adm-select">${SPORT_KEYS.map((k) => `<option value="${k}"${k === (values.sport || 'autre') ? ' selected' : ''}>${escapeHtml(SPORT_PRESETS[k].label)}</option>`).join('')}</select></div>
      </div>
      <div class="form-field"><label for="club-plan">Formule (essai de 30 jours)</label><select id="club-plan" name="plan" class="adm-select">${Object.entries(PLANS).map(([k, p]) => `<option value="${k}"${k === (values.plan || 'club') ? ' selected' : ''}>${escapeHtml(p.label)} : ${escapeHtml(formatEuros(p.price))} / mois</option>`).join('')}</select></div>
      <div class="form-field"><label for="club-city">Ville</label><input type="text" id="club-city" name="city" value="${v('city')}" required maxlength="60"></div>
      <div class="form-field"><label for="club-owner">E-mail du responsable du club</label><input type="email" id="club-owner" name="ownerEmail" value="${v('ownerEmail')}" required maxlength="200"><small class="form-hint">Il reçoit une invitation (7 jours) pour créer son compte sur le domaine du club. Un site de départ est publié aussitôt, à personnaliser dans « Site web ».</small></div>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('check')}Créer le club</button></div>
    </form>
  </section>
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('users')}Clubs</h2>
    <ul class="adm-users" role="list">${clubs.map((c) => clubRow(c, admin.organizationId, subs[c.id])).join('')}</ul>
  </section>
</main>
${adminScripts('admin-nav')}
</body></html>`,
    status
  );
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  await ensureSchema(env.DB);
  return render(env, admin);
}

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  await ensureSchema(env.DB);
  const form = await request.formData();
  const action = String(form.get('action') || '');
  const values = Object.fromEntries(['name', 'slug', 'domain', 'sport', 'ownerEmail', 'city', 'plan'].map((k) => [k, String(form.get(k) || '').slice(0, 253)]));
  try {
    if (action === 'create') {
      const club = await createOrganization(env, { ...values, actorUserId: admin.userId });
      // Site de départ publié tout de suite (le club le personnalise ensuite dans « Site web »).
      await createStarterSite(env, {
        organizationId: club.organizationId,
        slug: club.slug,
        domain: club.domain,
        profile: { name: club.name, sportLabel: SPORT_PRESETS[values.sport]?.label || 'Sport', city: values.city, email: club.ownerEmail },
      });
      const siteUrl = `https://${club.domain}`;
      const sent = await sendAdminInvitation(env, {
        to: club.ownerEmail,
        roleLabel: 'Responsable du club',
        inviterName: admin.user?.name || 'Licyo',
        clubName: club.name,
        link: `${siteUrl}/admin/invitation/${club.token}`,
        existing: club.existing,
        siteUrl,
        organizationId: club.organizationId,
      });
      await logAudit(env.DB, club.organizationId, { userId: admin.userId, action: 'plateforme.club-cree', target: club.organizationId });
      clearOrganizationCache();
      return render(env, admin, sent
        ? { message: `Club « ${club.name} » créé. Invitation envoyée à ${club.ownerEmail}.` }
        : { error: `Club « ${club.name} » créé, mais l’invitation n’a pas pu partir (service d’envoi). Le responsable pourra demander un nouveau lien au support.` });
    }
    const organizationId = String(form.get('organizationId') || '');
    if (action === 'status') {
      const status = String(form.get('status') || '');
      if (organizationId === admin.organizationId && status !== 'active') {
        return render(env, admin, { error: 'Vous ne pouvez pas suspendre le club depuis lequel vous êtes connecté.', status: 400 });
      }
      await setOrganizationStatus(env.DB, organizationId, status);
      await logAudit(env.DB, organizationId, { userId: admin.userId, action: `plateforme.statut:${status}`, target: organizationId });
      clearOrganizationCache();
      return render(env, admin, { message: status === 'active' ? 'Club réactivé.' : 'Club suspendu.' });
    }
    if (action === 'subscription') {
      await updateSubscription(env.DB, organizationId, { plan: String(form.get('plan') || ''), status: String(form.get('subStatus') || ''), priceEuros: form.get('price'), notes: form.get('notes') });
      await logAudit(env.DB, organizationId, { userId: admin.userId, action: 'plateforme.abonnement', target: organizationId });
      return render(env, admin, { message: 'Abonnement enregistré.' });
    }
    if (action === 'payment') {
      const sub = await recordPayment(env.DB, organizationId, { amountEuros: form.get('amount'), months: form.get('months'), method: String(form.get('method') || ''), reference: form.get('reference'), userId: admin.userId });
      await logAudit(env.DB, organizationId, { userId: admin.userId, action: 'plateforme.paiement', target: organizationId });
      return render(env, admin, { message: `Paiement enregistré : abonnement actif jusqu’au ${sub.current_period_end.split('-').reverse().join('/')}.` });
    }
    if (action === 'domain') {
      const domain = await addDomain(env.DB, organizationId, form.get('domain'));
      await logAudit(env.DB, organizationId, { userId: admin.userId, action: 'plateforme.domaine', target: domain });
      clearOrganizationCache();
      return render(env, admin, { message: `Domaine ${domain} ajouté.` });
    }
  } catch (error) {
    if (error instanceof AccountError || error instanceof BillingError) return render(env, admin, { error: error.message, values, status: 400 });
    throw error;
  }
  return render(env, admin, { error: 'Action inconnue.', status: 400 });
}
