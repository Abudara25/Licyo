// Liste des adhérents (CRM, phase 3) : les personnes ayant une adhésion, période et groupe compris. Lit le
// NOUVEAU modèle (_shared/crm.js) ; les statuts de dossier et de paiement sont lus dans l'inscription source.
// Lecture seule, à une exception : « Synchroniser maintenant » relie les inscriptions pas encore reliées (opération
// idempotente qui ne modifie jamais les inscriptions). L'organisation vient de la session, jamais du navigateur.
//
// Bouton de synchronisation : requête de même origine uniquement, un seul lancement à la fois par organisation
// (verrou de 30 s), et travail BORNÉ par requête (SYNC_LIMIT inscriptions) : s'il en reste, la page l'indique et
// on relance ; le service quotidien (api/cron) termine de toute façon.
import { ensureSchema, ageGroup } from '../_shared/inscriptions-db.js';
import { loadAgeContext } from '../_shared/preinscriptions.js';
import { isAuthed, loginPage, adminBadges } from '../_shared/admin-auth.js';
import { listMembers, memberFilterOptions, memberStats, inscriptionsNeedingSync, backfillOrganization, syncCurrentPeriod } from '../_shared/crm.js';
import { getCategoriesConfig } from '../_shared/settings-kv.js';
import { isSameOrigin, hitRateLimit } from '../_shared/security.js';
import { membersPage, html } from '../_shared/crm-ui.js';

export const SYNC_LIMIT = 25;
const SYNC_LOCK = { limit: 1, windowSeconds: 30 };
const text = (value, max) => String(value ?? '').trim().slice(0, max);
const redirect = (query) => new Response('', { status: 302, headers: { Location: `/admin/adherents${query}` } });

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  await ensureSchema(env.DB);
  const org = admin.organizationId;
  const params = new URL(request.url).searchParams;
  const period = Number.parseInt(params.get('periode') ?? '', 10);
  const categoriesConfig = await getCategoriesConfig(env, org);
  const { saison } = categoriesConfig;
  const ageCtx = await loadAgeContext(env, org, categoriesConfig);
  // Catégorie (?age=U6 - U7) → années de naissance qu'elle couvre pour la saison en cours.
  const ageParam = /^[\w -]{1,40}$/.test(params.get('age') || '') ? params.get('age') : '';
  const seasonEnd = Number(String(saison || '').split('-')[1]) || new Date().getFullYear() + 1;
  const birthYears = ageParam ? Array.from({ length: 30 }, (_, i) => seasonEnd - 1 - i).filter((y) => ageGroup(`${y}-01-01`, ageCtx) === ageParam) : [];
  const filters = {
    age: birthYears.length ? ageParam : '',
    birthYears,
    q: text(params.get('q'), 80),
    periodId: Number.isInteger(period) ? period : null,
    groupLabel: text(params.get('groupe'), 80),
    status: text(params.get('statut'), 20),
    suivi: text(params.get('suivi'), 40),
    page: params.get('page'),
    // Adhérents = inscriptions complètes uniquement ; les autres restent dans Inscriptions / Réinscription.
    completeOnly: true,
  };
  const [list, options, stats, needs] = await Promise.all([
    listMembers(env.DB, org, filters),
    memberFilterOptions(env.DB, org),
    memberStats(env.DB, org),
    inscriptionsNeedingSync(env.DB, org),
  ]);
  const number = (key) => {
    const value = Number.parseInt(params.get(key) ?? '', 10);
    return Number.isInteger(value) && value >= 0 ? value : null;
  };
  const synced = number('synced');
  const remaining = number('remaining');
  const messages = {
    synced: synced !== null ? `Synchronisation terminée : ${synced} inscription${synced > 1 ? 's' : ''} traitée${synced > 1 ? 's' : ''}.` : '',
    syncRemaining: remaining ? `Il en reste ${remaining} : relancez la synchronisation (ou laissez le service quotidien terminer).` : '',
    syncError: params.get('syncError') ? 'La synchronisation a rencontré une erreur : les inscriptions sont intactes, réessayez ou contactez le support.' : '',
    syncBusy: params.get('syncBusy') ? "Une synchronisation vient d'être lancée : patientez quelques secondes avant de recommencer." : '',
  };
  return html(membersPage({ list, options, filters, stats, unmapped: needs.unmapped.length + needs.stale.length, messages, saison, ageCtx, badges: await adminBadges(env, admin) }));
}

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  if (!isSameOrigin(request)) return new Response('Requête refusée (origine inattendue).', { status: 403 });
  const form = await request.formData();
  if (form.get('action') !== 'sync') return redirect('');
  try {
    await ensureSchema(env.DB);
    const { allowed } = await hitRateLimit(env.DB, `crm-sync:${admin.organizationId}`, SYNC_LOCK);
    if (!allowed) return redirect('?syncBusy=1');
    const { saison } = await getCategoriesConfig(env, admin.organizationId);
    const summary = await backfillOrganization(env, admin.organizationId, { dryRun: false, limit: SYNC_LIMIT });
    await syncCurrentPeriod(env, admin.organizationId, saison);
    const flags = `${summary.failed ? '&syncError=1' : ''}${summary.remaining ? `&remaining=${summary.remaining}` : ''}`;
    return redirect(`?synced=${summary.processed}${flags}`);
  } catch (error) {
    console.error(`CRM : synchronisation manuelle en échec (organisation ${admin.organizationId}) : ${error?.name || 'erreur'}`);
    return redirect('?syncError=1');
  }
}
