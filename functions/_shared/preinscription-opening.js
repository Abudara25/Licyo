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
//
// Ce comportement est un choix par groupe depuis le 2026-11-04 (case « Créer automatiquement une catégorie… ») :
// décochée, le groupe est une « salle d'attente » (club déjà établi qui libère des places dans une catégorie
// existante, faute de renouvellements). Groupe complet = une alerte au club (une seule fois tant qu'il reste
// complet), aucune catégorie touchée, aucune famille invitée : le club invite chaque famille depuis sa carte
// (inviteWaitingFamily), quand une place est réellement disponible.
import { getPreinscriptionConfig, setPreinscriptionConfig, countPreinscriptions, ensurePreinscriptionsTable } from './preinscriptions.js';
import { getCategoriesConfig, setCategoriesConfig } from './settings-kv.js';
import { sendPreinscriptionGroupOpened, sendPreinscriptionGroupOpenedClub, sendPreinscriptionWaitlistFullClub } from './confirmation-email.js';

// Échéance d'une invitation : maintenant + délai du groupe (preinscription-deadlines.js relance puis libère la place).
const deadlineModifier = (config) => `+${config.inviteDays || 7} days`;

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
export async function ensureCategory(env, organizationId, config) {
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

// Catégorie d'inscription ACTIVE qui couvre au moins une année du groupe : sans elle, une famille invitée ne pourrait
// pas remplir le formulaire d'inscription (la date de naissance ne correspondrait à aucune catégorie).
export async function activeCategoryFor(env, organizationId, config) {
  const cats = await getCategoriesConfig(env, organizationId).catch(() => null);
  return (cats?.categories || []).find((c) => c.active !== false && overlaps(c, config)) || null;
}

// Salle d'attente : invite UNE famille (bouton de sa carte). La réservation de invited_at et la lecture tiennent
// dans la même instruction : deux clics simultanés n'envoient qu'un e-mail. Résultat : 'invited' | 'already' |
// 'no_category' | 'not_found'.
export async function inviteWaitingFamily(env, organizationId, siteUrl, id) {
  await ensurePreinscriptionsTable(env.DB);
  const current = await env.DB.prepare('SELECT groupe, invited_at, inscription_id FROM preinscriptions WHERE organization_id = ? AND id = ?').bind(organizationId, id).first();
  if (!current) return 'not_found';
  // Déjà transférée en inscription par le club : rien à inviter.
  if (current.invited_at || current.inscription_id) return 'already';
  const config = await getPreinscriptionConfig(env, organizationId, current.groupe);
  if (!config) return 'not_found';
  if (!(await activeCategoryFor(env, organizationId, config))) return 'no_category';
  const row = await env.DB
    .prepare("UPDATE preinscriptions SET invited_at = datetime('now'), invite_deadline_at = datetime('now', ?) WHERE organization_id = ? AND id = ? AND invited_at IS NULL AND inscription_id IS NULL RETURNING *")
    .bind(deadlineModifier(config), organizationId, id)
    .first();
  if (!row) return 'already';
  await sendPreinscriptionGroupOpened(env, row, config, siteUrl, organizationId, { waitlist: true }).catch(() => false);
  return 'invited';
}

// Salle d'attente complète : alerte au club une seule fois (fullNotifiedAt), remise à zéro dès qu'une place se libère
// (suppression d'une ligne, plafond relevé) pour prévenir à nouveau la prochaine fois.
async function waitlistCheck(env, organizationId, siteUrl, config, count) {
  if (count < config.capacity) {
    if (config.fullNotifiedAt) await setPreinscriptionConfig(env, organizationId, { ...config, fullNotifiedAt: null });
    return { status: 'not_full', count };
  }
  if (config.fullNotifiedAt) return { status: 'waitlist_full', count, notified: false };
  const saved = await setPreinscriptionConfig(env, organizationId, { ...config, fullNotifiedAt: new Date().toISOString() });
  const category = await activeCategoryFor(env, organizationId, config);
  await sendPreinscriptionWaitlistFullClub(env, saved, { count, category: category?.label || null }, siteUrl, organizationId).catch(() => false);
  return { status: 'waitlist_full', count, notified: true };
}

// Résultat : { status: 'none' | 'not_full' | 'opened' | 'waitlist_full', count, invited, created }. groupe : clé du groupe concerné
// (plusieurs groupes depuis le 2026-11-04) ; sans clé, le premier groupe.
export async function openPreinscriptionGroupIfFull(env, organizationId, siteUrl, groupe = null) {
  const config = await getPreinscriptionConfig(env, organizationId, groupe);
  if (!config || !env.DB) return { status: 'none' };
  await ensurePreinscriptionsTable(env.DB);
  const count = await countPreinscriptions(env.DB, organizationId, config.groupe);
  if (config.autoCategory === false && !config.openedAt) return waitlistCheck(env, organizationId, siteUrl, config, count);
  if (count < config.capacity && !config.openedAt) return { status: 'not_full', count };

  let created = false;
  let opened = config;
  if (!config.openedAt) {
    created = await ensureCategory(env, organizationId, config);
    opened = await setPreinscriptionConfig(env, organizationId, { ...config, open: false, openedAt: new Date().toISOString() });
  }

  const { results } = await env.DB
    .prepare(
      `UPDATE preinscriptions SET invited_at = datetime('now'), invite_deadline_at = datetime('now', ?)
       WHERE organization_id = ? AND groupe = ? AND invited_at IS NULL AND expired_at IS NULL AND inscription_id IS NULL
       RETURNING *`
    )
    .bind(deadlineModifier(config), organizationId, config.groupe)
    .all();
  for (const row of results) {
    await sendPreinscriptionGroupOpened(env, row, opened, siteUrl, organizationId).catch(() => false);
  }
  if (results.length || created) {
    await sendPreinscriptionGroupOpenedClub(env, opened, { count, invited: results.length, created }, siteUrl, organizationId).catch(() => false);
  }
  return { status: 'opened', count, invited: results.length, created };
}
