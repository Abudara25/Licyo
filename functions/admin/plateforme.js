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

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

function clubRow(o, currentId) {
  const active = o.status === 'active';
  return `<li class="adm-user-row adm-club-row">
    <div>
      <h3>${escapeHtml(o.name)} <span class="adm-tag ${active ? 'is-yes' : 'is-no'}">${escapeHtml(ORGANIZATION_STATUSES[o.status] || o.status)}</span></h3>
      <p>${escapeHtml(o.slug)} · ${escapeHtml(o.domains || 'aucun domaine')}</p>
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
  stats: [{ value: clubs.filter((c) => c.status === 'active').length, label: 'Clubs actifs' }, { value: clubs.length, label: 'Clubs au total' }],
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
      <div class="form-field"><label for="club-city">Ville</label><input type="text" id="club-city" name="city" value="${v('city')}" required maxlength="60"></div>
      <div class="form-field"><label for="club-owner">E-mail du responsable du club</label><input type="email" id="club-owner" name="ownerEmail" value="${v('ownerEmail')}" required maxlength="200"><small class="form-hint">Il reçoit une invitation (7 jours) pour créer son compte sur le domaine du club. Un site de départ est publié aussitôt, à personnaliser dans « Site web ».</small></div>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('check')}Créer le club</button></div>
    </form>
  </section>
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('users')}Clubs</h2>
    <ul class="adm-users" role="list">${clubs.map((c) => clubRow(c, admin.organizationId)).join('')}</ul>
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
  const values = Object.fromEntries(['name', 'slug', 'domain', 'sport', 'ownerEmail', 'city'].map((k) => [k, String(form.get(k) || '').slice(0, 253)]));
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
    if (action === 'domain') {
      const domain = await addDomain(env.DB, organizationId, form.get('domain'));
      await logAudit(env.DB, organizationId, { userId: admin.userId, action: 'plateforme.domaine', target: domain });
      clearOrganizationCache();
      return render(env, admin, { message: `Domaine ${domain} ajouté.` });
    }
  } catch (error) {
    if (error instanceof AccountError) return render(env, admin, { error: error.message, values, status: 400 });
    throw error;
  }
  return render(env, admin, { error: 'Action inconnue.', status: 400 });
}
