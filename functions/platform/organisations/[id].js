// Fiche d'une organisation (maquette : pages/organization-detail.js) : aperçu, domaines, accès du bureau, journal,
// et actions sensibles (suspendre / réactiver). Les droits sont vérifiés par le middleware (orgs.manage ; renvoyer
// l'accès du président : orgs.support) puis rappelés ici pour l'affichage.
import { html } from '../../_shared/platform-ui/html.js';
import { icon } from '../../_shared/platform-ui/icons.js';
import { pageHeader, card, kvList } from '../../_shared/platform-ui/card.js';
import { emptyState } from '../../_shared/platform-ui/feedback.js';
import { badge, signal, orgLogo, consolePage, notice, formatDate, respond } from '../../_shared/platform-ui/kit.js';
import { getOrganization, orgStatus, sportLabel, setOrganizationStatus, addDomain, removeDomain, invitePresident } from '../../_shared/platform-data.js';
import { canPlatform, auditEntries, AUDIT_LABELS, PlatformError } from '../../_shared/platform-auth.js';
import { ROLE_LABELS } from '../../_shared/admin-users.js';

const notFound = () => respond('<!doctype html><title>Introuvable</title><p>Organisation introuvable.</p>', 404);

function inviteBox(invite) {
  if (!invite) return '';
  return card({
    title: 'Accès du président à transmettre',
    subtitle: `Pour ${invite.name} (${invite.email}) : lien personnel, valable 7 jours, une seule fois. Il ne sera plus affiché.`,
    className: 'section-gap',
    body: html`<div class="copy-row"><label class="sr-only" for="invite-link">Lien d’accès du président</label><input class="input" id="invite-link" readonly value="${invite.url}"><button type="button" class="btn btn-secondary" data-copy="invite-link">${icon('copy', 16)}Copier</button></div>
      <p class="muted small" style="margin-top:10px">L’envoi automatique par e-mail sera actif quand l’envoi d’e-mails sera configuré. En attendant, transmettez ce lien au président vous-même.</p>`,
  });
}

export async function renderOrganization(context, id, { message = '', error = '', invite = null, status = 200 } = {}) {
  const db = context.env.DB;
  const operator = context.data.operator;
  const org = await getOrganization(db, id);
  if (!org) return notFound();
  const journal = canPlatform(operator, 'audit.read') ? await auditEntries(db, { limit: 10, organizationId: id }) : [];
  const manage = canPlatform(operator, 'orgs.manage');
  const support = canPlatform(operator, 'orgs.support');
  const st = orgStatus(org.status);

  const domains = card({
    title: 'Domaines',
    subtitle: 'Le site et l’espace admin du club répondent sur ces adresses.',
    flush: true,
    body: html`${org.domainList.map(
      (d) => html`<div class="list-row between"><div class="grow"><div class="strong mono">${d.domain}</div><div class="muted small">ajouté le ${formatDate(d.created_at)}</div></div>
        <a class="btn btn-ghost btn-sm" href="https://${d.domain}" target="_blank" rel="noopener noreferrer">${icon('external', 14)}Ouvrir</a>
        ${manage && org.domainList.length > 1 ? html`<form method="POST" class="inline-form" data-confirm="Retirer ${d.domain} ? Le site ne répondra plus à cette adresse."><input type="hidden" name="action" value="domain-remove"><input type="hidden" name="domain" value="${d.domain}"><button class="btn btn-ghost btn-sm" type="submit">Retirer</button></form>` : ''}</div>`
    )}
    ${manage ? html`<form method="POST" class="list-row"><input type="hidden" name="action" value="domain-add"><label class="sr-only" for="new-domain">Nouveau domaine</label><input class="input" id="new-domain" name="domain" placeholder="www.monclub.fr" maxlength="253" autocapitalize="off" spellcheck="false" required style="flex:1 1 200px"><button class="btn btn-secondary" type="submit">${icon('plus', 16)}Ajouter</button></form>` : ''}`,
  });

  const access = card({
    title: 'Accès du bureau',
    subtitle: 'Comptes nominatifs du club. Le président invite lui-même le reste du bureau.',
    flush: true,
    body: html`${org.accountList.length
      ? org.accountList.map((a) => html`<div class="list-row"><div class="grow"><div class="strong">${a.name}</div><div class="muted small">${a.email} · ${ROLE_LABELS[a.role] ?? a.role} · ${a.last_login_at ? `dernière connexion le ${formatDate(a.last_login_at)}` : 'jamais connecté'}</div></div>${a.status === 'active' ? badge('Actif', 'success') : badge('Désactivé', 'neutral')}</div>`)
      : html`<div class="list-row"><span class="muted">Aucun compte pour le moment.</span></div>`}
    ${org.inviteList.map((i) => html`<div class="list-row"><div class="grow"><div class="strong">${i.name}</div><div class="muted small">${i.email} · ${ROLE_LABELS[i.role] ?? i.role} · invitation jusqu’au ${formatDate(i.expires_at)}</div></div>${badge('Invité', 'violet')}</div>`)}
    ${support
      ? html`<form method="POST" class="list-row" style="gap:10px"><input type="hidden" name="action" value="president-invite">
          <label class="sr-only" for="p-name">Nom du président</label><input class="input" id="p-name" name="name" placeholder="Prénom et nom du président" maxlength="120" required style="flex:1 1 180px">
          <label class="sr-only" for="p-email">E-mail du président</label><input class="input" id="p-email" name="email" type="email" placeholder="president@monclub.fr" maxlength="200" required style="flex:1 1 200px">
          <button class="btn btn-secondary" type="submit">${icon('mail', 16)}Envoyer l’accès président</button></form>`
      : ''}`,
  });

  const overview = card({
    title: 'Aperçu',
    body: kvList([
      ['État', badge(st.label, st.tone)],
      ['Sport', sportLabel(org.sport)],
      ['Inscriptions en cours', String(org.members)],
      ['Comptes du bureau', `${org.accounts} actif${org.accounts > 1 ? 's' : ''}`],
      ['E-mail du club', org.email || '—'],
      ['Identifiant', html`<span class="mono">${org.id}</span>`],
      ['Créée le', formatDate(org.created_at)],
    ]),
  });

  const sensitive = manage
    ? card({
        title: 'Zone sensible',
        body: org.status === 'active'
          ? html`<p class="muted small" style="margin-bottom:12px">Suspendre ferme aussitôt le site public et l’espace admin du club, et déconnecte son bureau. Rien n’est supprimé ; la réactivation rétablit tout.</p>
              <form method="POST" data-confirm="Suspendre ${org.name} ? Son site et son espace admin seront fermés immédiatement."><input type="hidden" name="action" value="suspend"><button class="btn btn-danger btn-block" type="submit">${icon('pause', 16)}Suspendre l’organisation</button></form>`
          : html`<p class="muted small" style="margin-bottom:12px">L’organisation est suspendue : son site et son espace admin sont fermés. Les données sont intactes.</p>
              <form method="POST"><input type="hidden" name="action" value="reactivate"><button class="btn btn-primary btn-block" type="submit">${icon('refresh', 16)}Réactiver l’organisation</button></form>`,
      })
    : '';

  const log = journal.length
    ? card({
        title: 'Journal',
        flush: true,
        body: html`<ul class="feed">${journal.map((a) => html`<li><span class="icon-bubble tone-info">${icon('scroll', 15)}</span><div><div class="what"><strong>${a.operator_name}</strong> ${AUDIT_LABELS[a.action] ?? a.action}</div><div class="when">${formatDate(a.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div></li>`)}</ul>`,
      })
    : '';

  const content = html`
    <div class="org-hero">
      ${orgLogo(org, 'lg', { presence: true })}
      ${pageHeader({ title: org.name, description: html`${org.domain || 'aucun domaine'} · ${sportLabel(org.sport)}`, actions: badge(st.label, st.tone) })}
    </div>
    ${org.issue ? notice(org.issue.tone === 'danger' ? 'danger' : 'warning', signal(org.issue), 'alert') : ''}
    ${message ? notice('success', message, 'check') : ''}
    ${error ? notice('danger', error, 'alert') : ''}
    ${inviteBox(invite)}
    <div class="grid grid-main section-gap">
      <div class="stack">${access}${domains}</div>
      <div class="stack">${overview}${sensitive}${log}</div>
    </div>`;
  return consolePage(context, { title: org.name, active: 'organizations', trail: [{ label: 'Organisations', href: '/platform/organisations' }, { label: org.name }], content, status });
}

export const onRequestGet = (context) => renderOrganization(context, String(context.params.id || ''));

export async function onRequestPost(context) {
  const { env, request } = context;
  const id = String(context.params.id || '');
  const operator = context.data.operator;
  const form = await request.formData();
  const action = String(form.get('action') || '');
  const origin = new URL(request.url).protocol === 'http:' ? 'http' : 'https';
  try {
    if (action === 'suspend' || action === 'reactivate') {
      await setOrganizationStatus(env, operator, id, action === 'suspend' ? 'suspended' : 'active');
      return renderOrganization(context, id, { message: action === 'suspend' ? 'Organisation suspendue : site et espace admin fermés.' : 'Organisation réactivée.' });
    }
    if (action === 'domain-add') {
      const host = await addDomain(env, operator, id, form.get('domain'));
      return renderOrganization(context, id, { message: `Domaine ${host} ajouté. Pensez au réglage DNS chez le registraire.` });
    }
    if (action === 'domain-remove') {
      await removeDomain(env, operator, id, String(form.get('domain') || ''));
      return renderOrganization(context, id, { message: 'Domaine retiré.' });
    }
    if (action === 'president-invite') {
      const invite = await invitePresident(env, operator, id, { name: form.get('name'), email: form.get('email') }, { origin });
      return renderOrganization(context, id, { message: 'Accès du président créé.', invite });
    }
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    return renderOrganization(context, id, { error: error.message, status: 400 });
  }
  return renderOrganization(context, id);
}
