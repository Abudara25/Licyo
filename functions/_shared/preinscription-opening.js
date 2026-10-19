// Ouverture automatique d'un groupe en pré-inscription (demande de l'utilisateur, 2026-10-08 : « quand on aura atteint
// le quota pour U10, tout le reste sera créé automatiquement comme les autres catégories »).
//
// Dès que les places sont toutes prises (dernière pré-inscription, transfert depuis une fiche, ou plafond abaissé dans
// les réglages) :
//   1. le groupe devient une catégorie d'inscription (D1 `groups`, comme celles de /admin/categories) : créée avec le
//      nom et les années de la pré-inscription, ou réactivée si une catégorie couvre déjà ces années ; jamais modifiée
//      sinon. Le tarif et les créneaux communs s'appliquent ; le lien HelloAsso propre reste à saisir par le club ;
//   2. la pré-inscription est fermée et marquée ouverte (`openedAt`) : la page publique renvoie vers /inscription ;
//   3. chaque famille pré-inscrite reçoit UNE invitation (colonne `invited_at`, réservée par la même instruction que la
//      lecture : jamais deux e-mails, même si deux requêtes passent en même temps), puis le club est prévenu.
// Les pré-inscriptions ne deviennent PAS des inscriptions : il manque consentements, adresse, mode de paiement ;
// chaque famille remplit le formulaire habituel. Rien n'est supprimé.
import { getPreinscriptionConfig, setPreinscriptionConfig, countPreinscriptions, ensurePreinscriptionsTable } from './preinscriptions.js';
import { getCategoriesConfig, setCategoriesConfig } from './settings-kv.js';
import { sendPreinscriptionGroupOpened, sendPreinscriptionGroupOpenedClub } from './confirmation-email.js';

const overlaps = (c, config) =>
  Number.isInteger(c.anneeMin) && Number.isInteger(c.anneeMax) && c.anneeMin <= config.anneeMax && c.anneeMax >= config.anneeMin;

function categoryId(groupe, categories) {
  const base = String(groupe).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'groupe';
  const used = new Set(categories.map((c) => String(c.id)));
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

// Crée (ou réactive) la catégorie ; true si elle a été créée. Un conflit de version (réglage modifié au même instant
// par un responsable) est retenté une fois sur la version à jour.
async function ensureCategory(env, organizationId, config) {
  for (let attempt = 0; ; attempt += 1) {
    const cats = await getCategoriesConfig(env, organizationId);
    const list = cats.categories || [];
    const existing = list.find((c) => overlaps(c, config));
    if (existing && existing.active !== false) return false;
    const categories = existing
      ? list.map((c) => (c === existing ? { ...c, active: true } : c))
      : [...list, { id: categoryId(config.groupe, list), label: config.label, anneeMin: config.anneeMin, anneeMax: config.anneeMax, helloAssoUrl: null, helloAssoWidgetUrl: null, active: true }];
    try {
      await setCategoriesConfig(env, organizationId, { ...cats, categories }, { expectedVersion: cats.configVersion });
      return !existing;
    } catch (error) {
      if (error?.name !== 'ConfigConflictError' || attempt >= 1) throw error;
    }
  }
}

// Résultat : { status: 'none' | 'not_full' | 'opened', count, invited, created }.
export async function openPreinscriptionGroupIfFull(env, organizationId, siteUrl) {
  const config = await getPreinscriptionConfig(env, organizationId);
  if (!config || !env.DB) return { status: 'none' };
  await ensurePreinscriptionsTable(env.DB);
  const count = await countPreinscriptions(env.DB, organizationId, config.groupe);
  if (count < config.capacity && !config.openedAt) return { status: 'not_full', count };

  let created = false;
  let opened = config;
  if (!config.openedAt) {
    created = await ensureCategory(env, organizationId, config);
    opened = await setPreinscriptionConfig(env, organizationId, { ...config, open: false, openedAt: new Date().toISOString() });
  }

  const { results } = await env.DB
    .prepare(
      `UPDATE preinscriptions SET invited_at = datetime('now')
       WHERE organization_id = ? AND groupe = ? AND invited_at IS NULL
       RETURNING *`
    )
    .bind(organizationId, config.groupe)
    .all();
  for (const row of results) {
    await sendPreinscriptionGroupOpened(env, row, opened, siteUrl, organizationId).catch(() => false);
  }
  if (results.length || created) {
    await sendPreinscriptionGroupOpenedClub(env, opened, { count, invited: results.length, created }, siteUrl, organizationId).catch(() => false);
  }
  return { status: 'opened', count, invited: results.length, created };
}
