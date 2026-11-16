// Vue d'ensemble (refonte du lot 3, 2026-11-13, maquette validée par l'utilisateur) : le PILOTAGE du club, sans liste
// d'actions (elles sont toutes dans « À traiter », un seul bouton y mène). Finances de la saison, effectifs par
// catégorie, rythme des inscriptions, licences, tenues à commander par taille, pré-inscriptions. Tout est calculé à
// l'affichage depuis les fiches existantes (buildOverview, pure et testée) ; lecture seule.
import { amountDueCents, formatEuros, isPartiallyPaid, isPaymentExempt, ensureChequesTable, chequesToCash } from '../_shared/payments.js';
import { ensureInscriptionsTable, isInscriptionComplete, ageGroup, sortAgeGroups, reinscriptionIds, SHIRT_SIZES } from '../_shared/inscriptions-db.js';
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon } from '../_shared/admin-auth.js';
import { getCategoriesConfig, getCronState } from '../_shared/settings-kv.js';
import { loadAgeContext, ensurePreinscriptionsTable, listAllPreinscriptions, preinscriptionDedupKey, getPreinscriptionGroups } from '../_shared/preinscriptions.js';
import { buildTodo, todoCount } from '../_shared/todo.js';
import { listEducateurs } from '../_shared/educateurs.js';
import { licenceStage } from '../_shared/club-followup.js';

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
const DAY = 86400000;
const toMs = (v) => (v ? Date.parse(String(v).includes('T') ? v : `${String(v).replace(' ', 'T')}Z`) : NaN);

// Panne silencieuse de l'automatisation quotidienne (2026-10-09) : si le Worker programmé ne s'exécute plus du tout,
// /api/cron n'est jamais appelé et aucun échec n'est noté (ni e-mail). Le tableau de bord le signale quand le dernier
// passage réussi date de plus de 36 h (un passage par jour à 7 h UTC, plus une marge). Sans aucun passage connu
// (organisation sans automatisation), rien n'est affiché.
export const CRON_STALE_HOURS = 36;
export function cronStaleSince(state, now = new Date()) {
  const last = Date.parse(state?.lastRun || '');
  if (!Number.isFinite(last)) return null;
  return now.getTime() - last > CRON_STALE_HOURS * 3600 * 1000 ? new Date(last) : null;
}

function cronBanner(since) {
  if (!since) return '';
  const when = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(since);
  return `<p class="adm-flash adm-flash-error" role="alert">${icon('alert')}<span><strong>Automatisations à l'arrêt.</strong> Dernier passage réussi le ${escapeHtml(when)}&nbsp;: relances automatiques et récapitulatif du lundi ne partent plus.<a class="adm-btn adm-btn-sm adm-btn-ghost adm-flash-action" href="/admin/parametres">${icon('settings')}Voir les paramètres</a></span></p>`;
}

// Lundi (UTC) de la semaine d'une date, en millisecondes.
const weekStart = (ms) => {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
};

const PAY_MODES = ['HelloAsso', 'Carte bancaire', 'Espèces', 'Chèque'];

/**
 * Indicateurs de la saison. rows : fiches actives (non archivées) de la saison en cours ; all : toutes les fiches de
 * l'organisation (réinscriptions) ; cheques : chèques non encaissés { montant_cents, encaissement_prevu } ;
 * preinscriptions, groups : pré-inscriptions et groupes ; educateurs : éducateurs actifs.
 */
export function buildOverview(rows, { all = rows, saison = '', prix = 0, ageCtx = null, cheques = [], preinscriptions = [], groups = [], educateurs = [], now = Date.now() } = {}) {
  // Finances : dû = montant dû enregistré, sinon tarif (Pass'Sport déduit) ; une fiche exemptée ne doit rien.
  const finance = { due: 0, received: 0, partial: { count: 0, received: 0 }, installments: { count: 0, cents: 0 }, unpaidCount: 0, byMode: Object.fromEntries(PAY_MODES.map((m) => [m, 0])), other: 0 };
  let passSport = 0;
  let exempt = 0;
  for (const r of rows) {
    if (isPaymentExempt(r)) {
      exempt += 1;
      continue;
    }
    if (r.pass_sport_code) passSport += 1;
    const due = amountDueCents(r, prix) || 0;
    const recu = Number(r.montant_recu_cents) || 0;
    // Payée avec un montant reçu inférieur au dû : paiement HelloAsso en plusieurs fois en cours (import des paiements,
    // helloasso-import.js) ; seules les échéances reçues sont encaissées, les suivantes sont « à venir ».
    const inProgress = r.paye && recu > 0 && recu < due;
    const got = r.paye && !inProgress ? Math.max(recu, due) : recu;
    if (inProgress) {
      finance.installments.count += 1;
      finance.installments.cents += due - recu;
    }
    finance.due += due;
    finance.received += got;
    if (isPartiallyPaid(r)) {
      finance.partial.count += 1;
      finance.partial.received += got;
    }
    if (!r.paye) finance.unpaidCount += 1;
    if (got) {
      if (Object.hasOwn(finance.byMode, r.mode_paiement)) finance.byMode[r.mode_paiement] += got;
      else finance.other += got;
    }
  }
  finance.rest = Math.max(0, finance.due - finance.received);
  finance.passSport = { count: passSport, cents: passSport * 5000 };
  finance.exempt = { count: exempt, cents: exempt * Math.round(Number(prix) * 100) };

  // Chèques à encaisser, regroupés par mois prévu.
  const chequeMonths = new Map();
  for (const c of cheques) {
    const m = chequeMonths.get(c.encaissement_prevu) || { month: c.encaissement_prevu, count: 0, cents: 0 };
    m.count += 1;
    m.cents += Number(c.montant_cents) || 0;
    chequeMonths.set(c.encaissement_prevu, m);
  }

  // Effectifs par catégorie d'âge : adhérents (complets), inscriptions en cours, pré-inscrits en attente.
  const complete = rows.filter(isInscriptionComplete);
  const ageOf = (naissance, fallback) => ageGroup(naissance, ageCtx) || fallback || '—';
  const waitingPre = preinscriptions.filter((p) => !p.inscription_id && !p.expired_at && !p.completed_at);
  const cats = new Map();
  const cat = (a) => cats.get(a) || cats.set(a, { age: a, members: 0, pending: 0, pre: 0 }).get(a);
  for (const r of rows) cat(ageOf(r.naissance, r.categorie))[isInscriptionComplete(r) ? 'members' : 'pending'] += 1;
  for (const p of waitingPre) cat(ageOf(p.naissance, p.groupe)).pre += 1;
  const categories = sortAgeGroups(new Set(cats.keys())).map((a) => cats.get(a));

  // Rythme : inscriptions de la saison par semaine (10 dernières semaines), réinscriptions, délai moyen pour être complet.
  const thisWeek = weekStart(now);
  const weeks = Array.from({ length: 10 }, (_, i) => ({ start: thisWeek - (9 - i) * 7 * DAY, count: 0 }));
  for (const r of rows) {
    const at = toMs(r.created_at);
    if (!Number.isFinite(at)) continue;
    const w = weeks.find((x) => at >= x.start && at < x.start + 7 * DAY);
    if (w) w.count += 1;
  }
  const delays = rows
    .map((r) => (toMs(r.complete_notified_at) - toMs(r.created_at)) / DAY)
    .filter((d) => Number.isFinite(d) && d >= 0);
  const reinscrits = reinscriptionIds(all, saison);

  // Licences (adhérents) et tenues (adhérents) : tailles à commander pour passer commande.
  const licence = { validee: 0, enCours: 0, aDemander: 0 };
  for (const r of complete) {
    const st = licenceStage(r);
    if (st === 'validee') licence.validee += 1;
    else if (st === 'a_demander') licence.aDemander += 1;
    else licence.enCours += 1;
  }
  const tenues = { sizes: Object.fromEntries(SHIRT_SIZES.map((t) => [t, 0])), toOrder: 0, ordered: 0, given: 0 };
  for (const r of complete) {
    if (r.tenue_remise_at) tenues.given += 1;
    else if (r.tenue_commandee_at) tenues.ordered += 1;
    else {
      tenues.toOrder += 1;
      if (Object.hasOwn(tenues.sizes, r.taille_maillot)) tenues.sizes[r.taille_maillot] += 1;
    }
  }

  return {
    finance,
    cheques: [...chequeMonths.values()].sort((a, b) => a.month.localeCompare(b.month)),
    members: complete.length,
    pending: rows.length - complete.length,
    categories,
    weeks,
    seasonCount: rows.length,
    reinscriptions: rows.filter((r) => reinscrits.has(r.id)).length,
    averageDays: delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null,
    licence,
    tenues,
    educateurs: educateurs.length,
    pre: { groups: groups.filter((g) => g.open && !g.openedAt).length, waiting: waitingPre.filter((p) => !p.invited_at).length, invited: waitingPre.filter((p) => p.invited_at).length },
  };
}

const MONTHS = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthName = (ym) => {
  const [y, m] = String(ym).split('-').map(Number);
  const label = Number.isFinite(y) && Number.isFinite(m) ? MONTHS.format(new Date(Date.UTC(y, m - 1, 1))) : ym;
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const shortDate = (ms) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date(ms));
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function page({ o, todo, saison, prix, badges, cronStale, today }) {
  const f = o.finance;
  const share = pct(f.received, f.due);
  const fullShare = pct(f.received - f.partial.received, f.due);
  const partialShare = pct(f.partial.received, f.due);
  const modeMax = Math.max(1, ...Object.values(f.byMode));
  const catMax = Math.max(1, ...o.categories.map((c) => c.members + c.pending + c.pre));
  const weekMax = Math.max(1, ...o.weeks.map((w) => w.count));
  const licTotal = o.licence.validee + o.licence.enCours + o.licence.aDemander;
  const n = todoCount(todo);
  const ratio = o.educateurs ? Math.round(o.members / o.educateurs) : null;
  const legend = (items) => `<div class="adm-ov-legend">${items.map(([cls, label]) => `<span><i class="${cls}"></i>${label}</span>`).join('')}</div>`;

  return `${adminHead('Vue d’ensemble')}
${adminShell({
  active: 'dashboard',
  badges,
  eyebrow: `Saison ${escapeHtml(saison)} · au ${escapeHtml(today)}`,
  title: 'Vue d’ensemble',
  subtitle: 'Le pilotage du club : finances, effectifs, licences et tenues. Les actions sont dans « À traiter ».',
  actions: `<a href="/admin/a-traiter" class="adm-btn adm-btn-primary adm-ov-todo">${icon('check')}À traiter <b>${n}</b><span class="visually-hidden"> : ${n > 1 ? `${n} actions à traiter` : `${n} action à traiter`}</span></a>`,
})}
<main id="adm-main" class="adm-wrap adm-main adm-ov">
  ${cronBanner(cronStale)}
  <div class="adm-ov-kpis">
    <div class="adm-surface adm-ov-kpi"><span>${icon('card')}Encaissé</span><strong>${escapeHtml(formatEuros(f.received))}</strong><small>sur ${escapeHtml(formatEuros(f.due))} attendus</small><span class="adm-ov-bar" role="img" aria-label="${share} %"><i style="width:${share}%"></i></span></div>
    <div class="adm-surface adm-ov-kpi"><span>${icon('calendar')}Reste à encaisser</span><strong>${escapeHtml(formatEuros(f.rest))}</strong><small>${plural(f.unpaidCount, 'famille', 'familles')}${f.partial.count ? ` · dont ${plural(f.partial.count, 'acompte', 'acomptes')}` : ''}${f.installments.cents ? ` · dont ${escapeHtml(formatEuros(f.installments.cents))} d’échéances HelloAsso à venir` : ''}</small></div>
    <div class="adm-surface adm-ov-kpi"><span>${icon('users')}Adhérents</span><strong>${o.members}</strong><small>+ ${plural(o.pending, 'inscription en cours', 'inscriptions en cours')}</small></div>
    <div class="adm-surface adm-ov-kpi"><span>${icon('award')}Licences validées</span><strong>${o.licence.validee} / ${o.members}</strong><span class="adm-ov-bar is-yes" role="img" aria-label="${pct(o.licence.validee, o.members)} %"><i style="width:${pct(o.licence.validee, o.members)}%"></i></span></div>
  </div>

  <div class="adm-ov-grid">
    <section class="adm-surface adm-ov-card" aria-labelledby="ov-finances">
      <h2 class="adm-h2" id="ov-finances">${icon('card')}Finances de la saison<small>tarif ${escapeHtml(formatEuros(Math.round(Number(prix) * 100)))}</small></h2>
      <p class="adm-ov-big"><strong>${share} %</strong><span>des cotisations encaissées</span></p>
      <div class="adm-ov-stack" role="img" aria-label="Encaissé ${share} %, reste ${100 - share} %"><i class="is-yes" style="width:${fullShare}%"></i><i class="is-wait" style="width:${partialShare}%"></i></div>
      ${legend([['is-yes', `Encaissé ${escapeHtml(formatEuros(f.received - f.partial.received))}`], ['is-wait', `Acomptes ${escapeHtml(formatEuros(f.partial.received))}`], ['is-none', `Pas encore payé ${escapeHtml(formatEuros(f.rest))}`]])}
      <ul class="adm-ov-rows">${PAY_MODES.map((m) => `<li><span>${m === 'Carte bancaire' ? 'Carte au club' : m === 'Chèque' ? 'Chèques' : m}</span><span class="adm-ov-track"><i style="width:${pct(f.byMode[m], modeMax)}%"></i></span><b>${escapeHtml(formatEuros(f.byMode[m]))}</b></li>`).join('')}${f.other ? `<li><span>Autre</span><span class="adm-ov-track"><i style="width:${pct(f.other, modeMax)}%"></i></span><b>${escapeHtml(formatEuros(f.other))}</b></li>` : ''}</ul>
      <p class="adm-help">Montants enregistrés dans l’admin (versements, chèques, paiements HelloAsso), d’après le mode de paiement de chaque fiche. Les sommes HelloAsso arrivent sur le compte du club selon le calendrier HelloAsso.</p>
      <p><a href="/admin/helloasso" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('upload')}Importer les paiements HelloAsso</a></p>
    </section>
    <section class="adm-surface adm-ov-card" aria-labelledby="ov-venir">
      <h2 class="adm-h2" id="ov-venir">${icon('calendar')}À venir et à récupérer</h2>
      <table class="adm-ov-table"><thead><tr><th>Chèques à encaisser</th><th>Montant</th></tr></thead><tbody>${
        o.cheques.length
          ? o.cheques.map((c) => `<tr><td>${escapeHtml(monthName(c.month))} · ${plural(c.count, 'chèque', 'chèques')}</td><td>${escapeHtml(formatEuros(c.cents))}</td></tr>`).join('')
          : '<tr><td colspan="2">Aucun chèque en attente d’encaissement.</td></tr>'
      }</tbody></table>
      <table class="adm-ov-table"><thead><tr><th>Aides et exemptions</th><th></th></tr></thead><tbody>
        <tr><td>Pass’Sport déclarés · ${plural(f.passSport.count, 'code', 'codes')}</td><td>${escapeHtml(formatEuros(f.passSport.cents))} à se faire rembourser</td></tr>
        <tr><td>Exemptions de paiement · ${f.exempt.count}</td><td>${escapeHtml(formatEuros(f.exempt.cents))} non demandés</td></tr>
      </tbody></table>
    </section>

    <section class="adm-surface adm-ov-card" aria-labelledby="ov-effectifs">
      <h2 class="adm-h2" id="ov-effectifs">${icon('users')}Effectifs par catégorie<a href="/admin/categories" class="adm-link">Catégories</a></h2>
      ${legend([['is-yes', 'Adhérents'], ['is-wait', 'Inscriptions en cours'], ['is-none', 'Pré-inscrits']])}
      ${
        o.categories.length
          ? `<ul class="adm-ov-cats">${o.categories
              .map((c) => `<li><b>${escapeHtml(c.age)}</b><span class="adm-ov-stack" role="img" aria-label="${c.members} adhérents, ${c.pending} en cours, ${c.pre} pré-inscrits"><i class="is-yes" style="width:${pct(c.members, catMax)}%"></i><i class="is-wait" style="width:${pct(c.pending, catMax)}%"></i><i class="is-none" style="width:${pct(c.pre, catMax)}%"></i></span><span>${c.members}${c.pending ? ` + ${c.pending}` : ''}${c.pre ? ` + ${c.pre}` : ''}</span></li>`)
              .join('')}</ul>`
          : '<p class="adm-help">Aucune inscription pour le moment.</p>'
      }
      <p class="adm-help">${o.educateurs ? `${plural(o.educateurs, 'éducateur', 'éducateurs')}${ratio ? `, soit 1 pour ${ratio} enfants` : ''}.` : 'Aucun éducateur enregistré.'}</p>
    </section>
    <section class="adm-surface adm-ov-card" aria-labelledby="ov-rythme">
      <h2 class="adm-h2" id="ov-rythme">${icon('activity')}Rythme des inscriptions<small>10 dernières semaines</small></h2>
      <div class="adm-ov-weeks" role="img" aria-label="Inscriptions par semaine : ${o.weeks.map((w) => w.count).join(', ')}">${o.weeks.map((w) => `<span style="height:${Math.max(2, pct(w.count, weekMax))}%"><em>${w.count}</em></span>`).join('')}</div>
      <div class="adm-ov-weeks-labels">${o.weeks.map((w) => `<span>${escapeHtml(shortDate(w.start))}</span>`).join('')}</div>
      <div class="adm-ov-minis"><div><strong>${o.seasonCount}</strong><small>inscriptions cette saison</small></div><div><strong>${o.reinscriptions}</strong><small>réinscriptions</small></div><div><strong>${o.averageDays == null ? '—' : `${o.averageDays} j`}</strong><small>délai moyen pour être complet</small></div></div>
    </section>
  </div>

  <div class="adm-ov-grid3">
    <section class="adm-surface adm-ov-card" aria-labelledby="ov-licences">
      <h2 class="adm-h2" id="ov-licences">${icon('award')}Licences FFF<a href="/admin/adherents" class="adm-link">Adhérents</a></h2>
      <div class="adm-ov-stack" role="img" aria-label="${o.licence.validee} validées, ${o.licence.enCours} en cours, ${o.licence.aDemander} à demander"><i class="is-yes" style="width:${pct(o.licence.validee, licTotal)}%"></i><i class="is-wait" style="width:${pct(o.licence.enCours, licTotal)}%"></i><i class="is-none" style="width:${pct(o.licence.aDemander, licTotal)}%"></i></div>
      ${legend([['is-yes', `Validées ${o.licence.validee}`], ['is-wait', `En cours ${o.licence.enCours}`], ['is-none', `À demander ${o.licence.aDemander}`]])}
    </section>
    <section class="adm-surface adm-ov-card" aria-labelledby="ov-tenues">
      <h2 class="adm-h2" id="ov-tenues">${icon('tag')}Tenues à commander<small>par taille</small></h2>
      <div class="adm-ov-sizes">${Object.entries(o.tenues.sizes).map(([t, k]) => `<div><strong>${k}</strong><small>${escapeHtml(t)}</small></div>`).join('')}</div>
      <p class="adm-help">${o.tenues.toOrder} à commander · ${o.tenues.ordered} commandée${o.tenues.ordered > 1 ? 's' : ''} à remettre · ${o.tenues.given} remise${o.tenues.given > 1 ? 's' : ''}</p>
    </section>
    <section class="adm-surface adm-ov-card" aria-labelledby="ov-pre">
      <h2 class="adm-h2" id="ov-pre">${icon('calendar')}Pré-inscriptions<a href="/admin/preinscriptions" class="adm-link">Voir</a></h2>
      <div class="adm-ov-minis"><div><strong>${o.pre.groups}</strong><small>${o.pre.groups > 1 ? 'groupes ouverts' : 'groupe ouvert'}</small></div><div><strong>${o.pre.waiting}</strong><small>familles en attente</small></div><div><strong>${o.pre.invited}</strong><small>invitées</small></div></div>
    </section>
  </div>
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }
  const org = admin.organizationId;
  await ensureInscriptionsTable(env.DB);
  await ensurePreinscriptionsTable(env.DB);
  await ensureChequesTable(env.DB);
  const { results } = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ?').bind(org).all();
  const categoriesConfig = await getCategoriesConfig(env, org);
  const { saison, prix } = categoriesConfig;
  // Fiches actives de la saison en cours (les fiches sans saison sont antérieures à la gestion des saisons).
  const active = results.filter((r) => !r.archived_at && (!r.saison || r.saison === saison));
  const [ageCtx, preinscriptions, groups, educateurs, chequesRows, toCash] = await Promise.all([
    loadAgeContext(env, org, categoriesConfig),
    listAllPreinscriptions(env.DB, org).catch(() => []),
    getPreinscriptionGroups(env, org).catch(() => []),
    listEducateurs(env.DB, org),
    env.DB.prepare('SELECT montant_cents, encaissement_prevu FROM cheques WHERE organization_id = ? AND encaisse_at IS NULL ORDER BY encaissement_prevu').bind(org).all().then((r) => r.results, () => []),
    chequesToCash(env.DB, org).catch(() => []),
  ]);
  // Nombre d'actions pour le bouton « À traiter » (même calcul que la page À traiter).
  const todo = buildTodo(results.filter((r) => !r.archived_at), {
    educateurs,
    cheques: toCash,
    preinscriptionKeys: new Set(preinscriptions.filter((p) => !p.inscription_id).map((p) => preinscriptionDedupKey({ enfantPrenom: p.enfant_prenom, enfantNom: p.enfant_nom, naissance: p.naissance }))),
  });
  const o = buildOverview(active, { all: results, saison, prix, ageCtx, cheques: chequesRows, preinscriptions, groups, educateurs });
  const today = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(new Date());
  return new Response(
    page({ o, todo, saison, prix, badges: await adminBadges(env, admin), cronStale: await getCronState(env, org).then((state) => cronStaleSince(state), () => null), today }),
    { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  );
}
