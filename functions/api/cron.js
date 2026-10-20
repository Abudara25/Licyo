// Plateforme multi-clubs (2026-10-20) : un seul appel quotidien traite TOUS les clubs actifs, chacun avec ses tâches,
// son état et ses alertes ; l'adresse de chaque club (liens des e-mails) est son premier domaine enregistré.
//
// Tâches programmées (relances automatiques, récapitulatif du lundi — voir _shared/automations.js — copie KV
// des catégories et réconciliation CRM). Cloudflare Pages ne sait pas planifier de tâche : le Worker
// workers/cron appelle cette route chaque matin, avec le secret partagé CRON_SECRET (à définir à l'identique
// sur le projet Pages et le Worker).
//
// Les tâches sont INDÉPENDANTES : une panne des automatisations n'empêche pas la réconciliation CRM, et
// inversement. Chacune est exécutée, son résultat est rapporté (sans donnée personnelle) ; si l'une a échoué la
// réponse est un 500 (le Worker programmé le voit), après que toutes ont tourné.
import { markOverdue } from '../_shared/billing.js';
import { runDailyAutomations } from '../_shared/automations.js';
import { resolveOrganization } from '../_shared/organization.js';
import { ensureSchema } from '../_shared/inscriptions-db.js';
import { timingSafeEqual } from '../_shared/security.js';
import { rebuildCategoriesCopy, getCategoriesConfig, getCronState, setCronState } from '../_shared/settings-kv.js';
import { backfillOrganization, syncCurrentPeriod } from '../_shared/crm.js';
import { sendCronFailureAlert } from '../_shared/confirmation-email.js';
import { purgeExpiredFamilyLinks } from '../_shared/retention.js';

// Nombre d'inscriptions reliées au CRM par passage quotidien (le reste au passage suivant) : borne le temps d'une requête.
const CRM_DAILY_LIMIT = 200;

export const CRON_TASKS = {
  automations: (env, organization, origin) => runDailyAutomations(env, organization.id, origin),
  mirror: async (env, organization) => {
    // Copie KV des catégories (secours si D1 est en panne) : reconstruite chaque jour depuis D1, la source de vérité,
    // pour rattraper une éventuelle panne du KV survenue lors d'une modification. Pour chaque organisation.
    return (await rebuildCategoriesCopy(env, organization.id)) ? 'à jour' : 'rien à copier';
  },
  crm: async (env, organization) => {
    // CRM (phase 3) : relie les inscriptions pas encore reliées, remet en concordance celles qui ont divergé et règle
    // la période courante. Idempotent.
    const { saison } = await getCategoriesConfig(env, organization.id);
    const summary = await backfillOrganization(env, organization.id, { dryRun: false, limit: CRM_DAILY_LIMIT });
    await syncCurrentPeriod(env, organization.id, saison);
    return { pending: summary.pending, processed: summary.processed, failed: summary.failed, remaining: summary.remaining };
  },
  // Liens de l'espace famille expirés depuis plus de 90 jours (empreintes seulement) : voir _shared/retention.js.
  familyLinks: async (env, organization) => ({ purged: await purgeExpiredFamilyLinks(env.DB, organization.id) }),
};

// Exécute chaque tâche isolément. Renvoie { results, failed } (résultats sans donnée personnelle).
export async function runCronTasks(env, organization, origin, tasks = CRON_TASKS) {
  const results = {};
  let failed = 0;
  for (const [name, task] of Object.entries(tasks)) {
    try {
      results[name] = await task(env, organization, origin);
    } catch (error) {
      failed += 1;
      results[name] = 'échec';
      console.warn(`Cron : tâche « ${name} » en échec (${error?.name || 'erreur'})`);
    }
  }
  return { results, failed };
}

// Échec enregistré dans l'état du cron (affiché dans /admin/parametres) : sans cela, une panne restait invisible (du
// 27 septembre au 8 octobre 2026, /api/cron a répondu 500 chaque matin sans que personne ne le voie). Type d'erreur et
// nom de tâche seulement, jamais de message (il peut citer une valeur). Au mieux : ne lève jamais.
// Le club est aussi prévenu par e-mail (sendCronFailureAlert), au plus une fois par jour (UTC) : la date du dernier
// envoi réussi est gardée dans l'état du cron (lastFailureAlertAt).
export async function recordCronFailure(env, organizationId, { step, error, siteUrl, now = new Date() }) {
  let state;
  try {
    state = await getCronState(env, organizationId);
  } catch {
    return; // KV indisponible : rien de plus à faire (ni état, ni moyen de garantir un seul e-mail par jour).
  }
  const at = now.toISOString();
  const next = { ...state, lastFailure: { at, step, error: error?.name || 'Error' } };
  if (siteUrl && String(state.lastFailureAlertAt || '').slice(0, 10) !== at.slice(0, 10)) {
    try {
      if (await sendCronFailureAlert(env, siteUrl, { at, step, organizationId })) next.lastFailureAlertAt = at;
    } catch {
      // Envoi au mieux : l'échec reste noté dans l'état.
    }
  }
  try {
    await setCronState(env, organizationId, next);
  } catch {
    // KV indisponible : rien de plus à faire.
  }
}

// Clubs actifs et leur adresse publique (premier domaine enregistré), avec une seconde tentative : le cron tombe souvent
// sur une instance neuve dont la préparation du schéma D1 peut dépasser son délai (base réveillée le matin).
async function activeOrganizations(env) {
  const load = async () => {
    await ensureSchema(env.DB);
    const { results } = await env.DB.prepare(
      `SELECT o.id, o.slug, o.name, o.status,
              (SELECT d.domain FROM organization_domains d WHERE d.organization_id = o.id ORDER BY d.rowid LIMIT 1) AS domain
       FROM organizations o /* toutes-organisations */ WHERE o.status = 'active' ORDER BY o.created_at, o.id`
    ).all();
    return results;
  };
  try {
    return await load();
  } catch {
    return load();
  }
}

const originFor = (organization, fallback) =>
  organization.domain && !organization.domain.endsWith('.pages.dev') ? `https://${organization.domain}` : fallback;

export async function onRequestPost({ request, env, tasks }) {
  if (!env.CRON_SECRET || !timingSafeEqual(request.headers.get('Authorization') || '', `Bearer ${env.CRON_SECRET}`)) {
    return new Response('Forbidden', { status: 403 });
  }
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const requestOrigin = new URL(request.url).origin;
  let organizations;
  try {
    organizations = await activeOrganizations(env);
  } catch (error) {
    console.warn(`Cron : clubs non lus (${error?.name || 'erreur'})`);
    return json({ error: 'organisation' }, 503);
  }
  // Club du domaine appelé : ses résultats restent à la racine de la réponse (compatibilité).
  const here = await resolveOrganization(request, env).catch(() => null);
  const all = {};
  let failedTotal = 0;
  let rootResults = null;
  for (const organization of organizations) {
    const origin = here?.id === organization.id ? requestOrigin : originFor(organization, requestOrigin);
    const { results, failed } = await runCronTasks(env, organization, origin, tasks);
    if (failed) {
      failedTotal += failed;
      const names = Object.keys(results).filter((name) => results[name] === 'échec');
      await recordCronFailure(env, organization.id, { step: names.join(', '), error: { name: 'TaskError' }, siteUrl: origin });
    }
    all[organization.id] = results;
    if (here?.id === organization.id || (!here && !rootResults)) rootResults = results;
  }
  // Abonnements Licyo : essais terminés et périodes échues passés « En retard » (jamais de suspension automatique).
  let billing = 0;
  try {
    billing = await markOverdue(env.DB);
  } catch (error) {
    console.warn(`Cron : abonnements non contrôlés (${error?.name || 'erreur'})`);
    failedTotal += 1;
  }
  const results = rootResults || {};
  const body = { ...(typeof results.automations === 'object' && results.automations ? results.automations : {}), ...results, organizations: all, billingOverdue: billing };
  return json(body, failedTotal ? 500 : 200);
}
