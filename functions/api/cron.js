// Tâches programmées (relances automatiques, récapitulatif du lundi — voir _shared/automations.js — copie KV
// des catégories et réconciliation CRM). Cloudflare Pages ne sait pas planifier de tâche : le Worker
// workers/cron appelle cette route chaque matin, avec le secret partagé CRON_SECRET (à définir à l'identique
// sur le projet Pages et le Worker).
//
// Les tâches sont INDÉPENDANTES : une panne des automatisations n'empêche pas la réconciliation CRM, et
// inversement. Chacune est exécutée, son résultat est rapporté (sans donnée personnelle) ; si l'une a échoué la
// réponse est un 500 (le Worker programmé le voit), après que toutes ont tourné.
import { runDailyAutomations } from '../_shared/automations.js';
import { resolveOrganization, unknownOrganization } from '../_shared/organization.js';
import { timingSafeEqual } from '../_shared/security.js';
import { rebuildLegacyMirror, getCategoriesConfig, getCronState, setCronState } from '../_shared/settings-kv.js';
import { backfillOrganization, syncCurrentPeriod } from '../_shared/crm.js';
import { DEMO_ORG_ID, DEMO_DOMAINS } from '../_shared/schema.js';
import { sendCronFailureAlert } from '../_shared/confirmation-email.js';
import { purgeExpiredFamilyLinks } from '../_shared/retention.js';

// Nombre d'inscriptions reliées au CRM par passage quotidien (le reste au passage suivant) : borne le temps d'une requête.
const CRM_DAILY_LIMIT = 200;

export const CRON_TASKS = {
  automations: (env, organization, origin) => runDailyAutomations(env, organization.id, origin),
  mirror: async (env, organization) => {
    // Copie KV des catégories de Sportville (compatibilité, retour arrière) : reconstruite chaque jour depuis D1,
    // la source de vérité, pour rattraper une éventuelle panne du KV survenue lors d'une modification.
    if (organization.id !== DEMO_ORG_ID) return null;
    return (await rebuildLegacyMirror(env, organization.id)) ? 'à jour' : 'rien à copier';
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

// Organisation du domaine, avec une seconde tentative : le cron tombe souvent sur une instance neuve dont la
// préparation du schéma D1 peut dépasser son délai (base réveillée le matin), et une nouvelle tentative repart à neuf.
async function resolveWithRetry(request, env) {
  try {
    return await resolveOrganization(request, env);
  } catch {
    return resolveOrganization(request, env);
  }
}

export async function onRequestPost({ request, env, tasks }) {
  if (!env.CRON_SECRET || !timingSafeEqual(request.headers.get('Authorization') || '', `Bearer ${env.CRON_SECRET}`)) {
    return new Response('Forbidden', { status: 403 });
  }
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  // Le Worker appelle https://clubdemo.licyo.fr/api/cron : l'organisation est celle de ce domaine.
  let organization;
  try {
    organization = await resolveWithRetry(request, env);
  } catch (error) {
    // Base indisponible : l'échec est noté pour Sportville (reconnu par son domaine, sans la base).
    if (DEMO_DOMAINS.includes(new URL(request.url).hostname)) await recordCronFailure(env, DEMO_ORG_ID, { step: 'organisation', error, siteUrl: new URL(request.url).origin });
    console.warn(`Cron : organisation non résolue (${error?.name || 'erreur'})`);
    return json({ error: 'organisation' }, 503);
  }
  if (!organization) return unknownOrganization();
  const { results, failed } = await runCronTasks(env, organization, new URL(request.url).origin, tasks);
  if (failed) {
    const names = Object.keys(results).filter((name) => results[name] === 'échec');
    await recordCronFailure(env, organization.id, { step: names.join(', '), error: { name: 'TaskError' }, siteUrl: new URL(request.url).origin });
  }
  // Compatibilité : les champs de runDailyAutomations restent à la racine de la réponse.
  const body = { ...(typeof results.automations === 'object' && results.automations ? results.automations : {}), ...results };
  return json(body, failed ? 500 : 200);
}
