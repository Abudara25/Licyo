// Recherche globale (2026-11-13, auparavant « Trouver un enfant ») : enfants, responsables légaux, éducateurs,
// pré-inscriptions et catégories, rangés par type et filtrables (?type=). ?format=json renvoie les suggestions
// affichées pendant la frappe dans la barre du haut (assets/js/admin-search.js). Lecture seule ; organisation de la
// session uniquement (voir _shared/global-search.js).
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, avatar } from '../_shared/admin-auth.js';
import { searchAll, SEARCH_TYPES, SEARCH_MIN, normalize, matches } from '../_shared/global-search.js';

export { SEARCH_MIN, normalize, matches };

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
const SHOWN = 50;
const SUGGESTED = 3;

function resultRow(item) {
  const lead = item.avatar ? avatar(item.avatar) : `<span class="adm-find-ico">${icon(item.icon)}</span>`;
  const children = item.children?.length
    ? `<div class="adm-find-chips">${item.children.map((c) => `<a href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a>`).join('')}</div>`
    : '';
  return `<li class="adm-find-row">
    ${lead}
    <div class="adm-find-main"><a class="adm-find-title" href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a><p>${item.sub.map(escapeHtml).join(' · ')}</p>${children}</div>
    <span class="adm-tag is-${item.tone}">${escapeHtml(item.tag)}</span>
    <div class="adm-find-actions">${item.mail ? `<a class="adm-btn adm-btn-sm adm-btn-ghost" href="${escapeHtml(item.mail)}">${icon('mail')}E-mail</a>` : ''}<a class="adm-btn adm-btn-sm adm-btn-ghost" href="${escapeHtml(item.href)}">${escapeHtml(item.cta)}</a></div>
  </li>`;
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  const url = new URL(request.url);
  const json = url.searchParams.get('format') === 'json';
  if (!admin) return json ? Response.json({ error: 'auth' }, { status: 401 }) : html(loginPage());
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 100);
  const type = Object.hasOwn(SEARCH_TYPES, url.searchParams.get('type') || '') ? url.searchParams.get('type') : '';
  const found = await searchAll(env, admin.organizationId, q);
  const total = Object.values(found).reduce((n, list) => n + list.length, 0);

  // Suggestions : quelques résultats par type, sans donnée au-delà de ce que la page affiche.
  if (json) {
    const groups = Object.entries(SEARCH_TYPES)
      .filter(([key]) => found[key].length)
      .map(([key, label]) => ({
        type: key,
        label,
        count: found[key].length,
        items: found[key].slice(0, SUGGESTED).map((i) => ({ title: i.title, sub: i.sub.slice(0, 2).join(' · '), tag: i.tag, tone: i.tone, href: i.href })),
      }));
    return Response.json({ q, total, groups }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const form = `<form method="GET" class="adm-surface adm-toolbar" role="search">
    <div class="adm-toolbar-row"><div class="adm-search">${icon('search')}<label for="find-q" class="visually-hidden">Nom d'un enfant, d'un parent ou d'un éducateur, e-mail, téléphone ou catégorie</label>
      <input type="search" id="find-q" name="q" value="${escapeHtml(q)}" placeholder="Enfant, parent, éducateur, e-mail, téléphone…" autocomplete="off" autofocus>
      ${type ? `<input type="hidden" name="type" value="${escapeHtml(type)}">` : ''}
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">Chercher</button>
    </div></div>
  </form>`;
  const enc = encodeURIComponent(q);
  const chips = total
    ? `<nav class="adm-chips adm-find-types" aria-label="Filtrer par type"><a class="adm-chip${type ? '' : ' is-active'}" href="/admin/recherche?q=${enc}"${type ? '' : ' aria-current="true"'}>Tout <b>${total}</b></a>${Object.entries(SEARCH_TYPES)
        .map(([key, label]) => (found[key].length ? `<a class="adm-chip${type === key ? ' is-active' : ''}" href="/admin/recherche?q=${enc}&amp;type=${key}"${type === key ? ' aria-current="true"' : ''}>${label} <b>${found[key].length}</b></a>` : ''))
        .join('')}</nav>`
    : '';
  const sections = Object.entries(SEARCH_TYPES)
    .filter(([key]) => found[key].length && (!type || type === key))
    .map(([key, label]) => {
      const list = found[key];
      return `<li class="adm-find-section"><h2>${escapeHtml(label)} <em>${list.length}${list.length > SHOWN ? ` · les ${SHOWN} premiers` : ''}</em></h2><ul>${list.slice(0, SHOWN).map(resultRow).join('')}</ul></li>`;
    })
    .join('');
  const body = !q
    ? `<p class="adm-help adm-find-help">Cherche partout : enfants (inscriptions, adhérents, réinscriptions, corbeille), responsables légaux, éducateurs, pré-inscriptions et catégories. Un nom, un e-mail ou un numéro de téléphone suffit.</p>`
    : normalize(q).length < SEARCH_MIN
      ? `<section class="adm-surface adm-empty"><p>Tapez au moins ${SEARCH_MIN} lettres.</p></section>`
      : total
        ? `${chips}<p class="adm-help adm-find-help">${total} résultat${total > 1 ? 's' : ''} pour « ${escapeHtml(q)} ».</p><ul class="adm-find-results">${sections}</ul>`
        : `<section class="adm-surface adm-empty">${icon('search')}<p>Aucun résultat pour « ${escapeHtml(q)} » : ni enfant, ni responsable, ni éducateur, ni catégorie.</p></section>`;

  return html(`${adminHead('Recherche')}
${adminShell({
  active: 'recherche',
  badges: await adminBadges(env, admin),
  eyebrow: 'Recherche',
  title: q ? `Résultats pour « ${escapeHtml(q)} »` : 'Rechercher',
  subtitle: 'Enfants, responsables, éducateurs, pré-inscriptions et catégories, quel que soit l’état de la fiche.',
})}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  ${form}
  ${body}
</main>
${adminScripts('admin-nav')}
</body></html>`);
}
