// Page « À traiter » : la file de travail du club (refonte « boîte de traitement », 2026-11-13). Tout ce qui attend une
// action, groupé par type, avec l'action directe sur chaque ligne et, sur grand écran, un aperçu de l'enfant à droite
// (étapes, coordonnées, mêmes actions) sans quitter la page. Règles dans _shared/todo.js, jamais recodées ici.
// Lecture seule : chaque bouton mène à l'écran où l'action se fait. Organisation de la session uniquement.
import { chequesToCash, formatEuros, paymentBalance } from '../_shared/payments.js';
import { ensureInscriptionsTable, dossierStatus, isInscriptionComplete, hasPaymentStarted } from '../_shared/inscriptions-db.js';
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, formatDateFr, formatBirth, avatar } from '../_shared/admin-auth.js';
import { ensurePreinscriptionsTable, listAllPreinscriptions, preinscriptionDedupKey } from '../_shared/preinscriptions.js';
import { buildTodo, todoCount } from '../_shared/todo.js';
import { listEducateurs } from '../_shared/educateurs.js';
import { licenceStage } from '../_shared/club-followup.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
const SHOWN = 30;
const DAY = 86400000;

// Filtres par type (puces en haut de la file) : lien GET, fonctionne sans JavaScript.
export const TODO_TYPES = [
  { key: 'dossiers', label: 'Dossiers', sections: ['dossiers', 'doublons'] },
  { key: 'paiements', label: 'Paiements', sections: ['paiements', 'cheques'] },
  { key: 'licences', label: 'Licences', sections: ['licence_refusee', 'licence_a_verifier', 'licence_a_signer', 'licence_relance', 'licence_a_demander'] },
  { key: 'relances', label: 'Relances', sections: ['relances'] },
  { key: 'autres', label: 'Tenues et encadrement', sections: ['tenues', 'educateurs'] },
];
const SECTION_ICON = { dossiers: 'file', doublons: 'users', paiements: 'card', cheques: 'card', relances: 'send', tenues: 'tag', educateurs: 'user' };

const time = (v) => (v ? Date.parse(String(v).includes('T') ? v : `${String(v).replace(' ', 'T')}Z`) : NaN);
// Retard : plus de 3 jours pour ce qui bloque (ton « no »), plus de 7 jours pour le reste ; jamais pour les tenues.
export function isLate(section, since, now = Date.now()) {
  const t = time(since);
  if (!Number.isFinite(t) || section.tone === 'neutral') return false;
  return now - t > (section.tone === 'no' ? 3 : 7) * DAY;
}
function ago(since, now) {
  const t = time(since);
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((now - t) / DAY);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 60) return `il y a ${days} j`;
  return formatDateFr(since, { day: 'numeric', month: 'short' });
}

// Étapes de l'enfant pour l'aperçu : done, wait (en cours / attend le club), bad (refusé), todo (rien reçu).
function steps(r) {
  const dossier = { valide: 'done', a_verifier: 'wait', refuse: 'bad', manquant: 'todo' }[dossierStatus(r)];
  const photo = r.photo_uploaded_at ? 'done' : r.photo_refused_at ? 'bad' : 'todo';
  const paiement = r.paye ? 'done' : hasPaymentStarted(r) ? 'wait' : 'todo';
  let licence = 'todo';
  if (isInscriptionComplete(r)) {
    const stage = licenceStage(r);
    licence = stage === 'validee' ? 'done' : stage === 'refusee' ? 'bad' : 'wait';
  }
  return [['Inscription', 'done'], ['Dossier', dossier], ['Photo', photo], ['Paiement', paiement], ['Licence', licence]];
}
const STEP_TEXT = { done: 'fait', wait: 'en cours', bad: 'à corriger', todo: 'à faire' };

function actionLinks(actions, size = 'adm-btn-sm') {
  return actions
    .map((a) => `<a href="${escapeHtml(a.href)}" class="adm-btn ${size} ${a.primary ? 'adm-btn-primary' : 'adm-btn-ghost'}">${escapeHtml(a.label)}</a>`)
    .join('');
}

function peek(it, row, now) {
  if (!row) {
    return `<div class="adm-peek-head"><div><h2>${escapeHtml(it.name)}</h2><p>${escapeHtml(it.detail)}</p></div></div>
      <div class="adm-peek-actions">${actionLinks(it.actions, '')}</div>`;
  }
  const st = steps(row);
  const balance = paymentBalance(row);
  const phone = row.telephone ? `<a href="tel:${escapeHtml(String(row.telephone).replace(/[^\d+]/g, ''))}">${escapeHtml(row.telephone)}</a>` : '—';
  return `<div class="adm-peek-head">${avatar(row, 'lg')}<div><h2>${escapeHtml(it.name)}</h2><p>${escapeHtml(row.categorie || '')} · né(e) le ${formatBirth(row.naissance)}</p></div></div>
    <ol class="adm-peek-steps">${st.map(([label, state]) => `<li class="is-${state}"><span></span>${label}<span class="visually-hidden"> : ${STEP_TEXT[state]}</span></li>`).join('')}</ol>
    <p class="adm-peek-why">${icon('alert')}<span>${escapeHtml(it.detail)}${it.since ? ` · ${ago(it.since, now)}` : ''}</span></p>
    <dl class="adm-peek-kv">
      <dt>Responsable</dt><dd>${escapeHtml(`${row.parent_prenom || ''} ${row.parent_nom || ''}`.trim() || '—')}</dd>
      <dt>Téléphone</dt><dd>${phone}</dd>
      <dt>Paiement</dt><dd>${row.paye ? 'Payé' : balance ? `Reste ${formatEuros(balance.reste)}` : escapeHtml(row.mode_paiement || 'Non payé')}</dd>
      <dt>Inscrit(e) le</dt><dd>${formatDateFr(row.created_at, { day: 'numeric', month: 'long' }) || '—'}</dd>
    </dl>
    <div class="adm-peek-actions">${actionLinks(it.actions, '')}<a href="/admin/inscriptions/${row.id}" class="adm-btn adm-btn-ghost">${icon('eye')}Ouvrir la fiche</a></div>`;
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  const org = admin.organizationId;
  const now = Date.now();
  await ensureInscriptionsTable(env.DB);
  await ensurePreinscriptionsTable(env.DB);
  const [{ results: rows }, preinscriptions, educateurs] = await Promise.all([
    env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND archived_at IS NULL').bind(org).all(),
    listAllPreinscriptions(env.DB, org),
    listEducateurs(env.DB, org),
  ]);
  const sections = buildTodo(rows, {
    now,
    educateurs,
    cheques: await chequesToCash(env.DB, org).catch(() => []),
    preinscriptionKeys: new Set(preinscriptions.filter((p) => !p.inscription_id).map((p) => preinscriptionDedupKey({ enfantPrenom: p.enfant_prenom, enfantNom: p.enfant_nom, naissance: p.naissance }))),
  });
  const total = todoCount(sections);
  const late = sections.reduce((n, s) => n + s.items.filter((it) => isLate(s, it.since, now)).length, 0);


  const type = TODO_TYPES.find((t) => t.key === new URL(request.url).searchParams.get('type')) || null;
  const visible = type ? sections.filter((s) => type.sections.includes(s.key)) : sections;
  const countOf = (t) => sections.filter((s) => t.sections.includes(s.key)).reduce((n, s) => n + s.items.length, 0);
  const chips = `<nav class="adm-chips" aria-label="Filtrer par type">
    <a href="/admin/a-traiter" class="adm-chip${type ? '' : ' is-active" aria-current="true'}">Tout <b>${total}</b></a>
    ${TODO_TYPES.map((t) => ({ t, n: countOf(t) }))
      .filter(({ n }) => n > 0)
      .map(({ t, n }) => `<a href="/admin/a-traiter?type=${t.key}" class="adm-chip${type?.key === t.key ? ' is-active" aria-current="true' : ''}">${escapeHtml(t.label)} <b>${n}</b></a>`)
      .join('')}
  </nav>`;

  const byId = new Map(rows.map((r) => [r.id, r]));
  const peeks = [];
  const rowHtml = (s, it) => {
    const r = it.kind === 'educateur' ? null : byId.get(it.id);
    const index = peeks.length;
    peeks.push(peek(it, r, now));
    const lateItem = isLate(s, it.since, now);
    const target = it.actions.find((a) => a.primary)?.href || it.actions[0]?.href || '#';
    return `<li class="adm-q-row${index === 0 ? ' is-selected' : ''}" data-peek-row="${index}">
        ${r ? avatar(r) : `<span class="adm-avatar adm-tone-${Math.abs(Number(it.id) || 0) % 5}" aria-hidden="true">${escapeHtml(it.name.trim().charAt(0).toUpperCase() || '?')}</span>`}
        <div class="adm-q-who"><a href="${escapeHtml(r ? `/admin/inscriptions/${r.id}` : target)}" class="adm-q-name" data-peek="${index}">${escapeHtml(it.name)}</a>${r?.categorie ? `<span class="adm-q-cat">${escapeHtml(r.categorie)}</span>` : ''}<p>${escapeHtml(it.detail)}</p></div>
        <span class="adm-q-age${lateItem ? ' is-late' : ''}">${it.since ? ago(it.since, now) : ''}${lateItem ? '<span class="visually-hidden"> (en retard)</span>' : ''}</span>
        <div class="adm-q-actions">${actionLinks(it.actions)}</div>
      </li>`;
  };
  const sectionHtml = (s) => `<li class="adm-q-section is-${s.tone}" id="${s.key}">
      <h2>${icon(SECTION_ICON[s.key] || 'check')}<span>${escapeHtml(s.title)} <em>· ${s.items.length}</em></span></h2>
      <p>${escapeHtml(s.hint)}</p>
    </li>
    ${s.items.slice(0, SHOWN).map((it) => rowHtml(s, it)).join('')}
    ${s.items.length > SHOWN ? `<li class="adm-q-more">Et ${s.items.length - SHOWN} autre${s.items.length - SHOWN > 1 ? 's' : ''} : traitez les premiers, la liste se met à jour.</li>` : ''}`;

  const list = visible.length
    ? `<ul class="adm-queue" aria-label="Actions à traiter">${visible.map(sectionHtml).join('')}</ul>`
    : `<section class="adm-surface adm-empty">${icon('check')}<p>${type ? 'Rien de ce type à traiter.' : 'Rien à traiter pour le moment : tout est à jour.'}</p></section>`;

  return html(`${adminHead('À traiter')}
${adminShell({
  active: 'a-traiter',
  badges: await adminBadges(env, admin),
  eyebrow: 'Aujourd’hui',
  title: total ? `${total} action${total > 1 ? 's' : ''} à traiter` : 'À traiter',
  subtitle: total
    ? `${late ? `${late} en retard. ` : ''}Commencez par les dossiers : ils bloquent les licences.`
    : 'Tout ce qui attend une action du club apparaît ici, du plus urgent au moins urgent.',
})}
<main id="adm-main" class="adm-wrap adm-main adm-queue-page">
  ${chips}
  <div class="adm-queue-layout">
    <div class="adm-queue-list">${list}</div>
    ${peeks.length ? `<aside class="adm-peek adm-surface" aria-label="Aperçu" aria-live="polite">${peeks[0]}</aside>
    ${peeks.map((p, i) => `<template data-peek-template="${i}">${p}</template>`).join('')}` : ''}
  </div>
</main>
${adminScripts('admin-nav', 'admin-queue')}
</body></html>`);
}
