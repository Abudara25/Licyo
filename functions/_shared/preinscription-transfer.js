// Transfert de pré-inscriptions vers une catégorie d'inscription, par le club (demande de l'utilisateur, 2026-11-09 :
// « envoyer les enfants sélectionnés vers la catégorie qui leur convient ; si la catégorie n'existe pas, proposer de
// la créer ; garder les pré-inscrits dans le décompte »).
//
// Pour chaque enfant sélectionné dans /admin/preinscriptions :
//   - la catégorie est celle, ACTIVE, qui couvre son année de naissance (jamais choisie par le navigateur) ; si aucune
//     ne la couvre, l'écran de confirmation propose de créer celle du groupe (ensureCategory, mêmes nom et années) ;
//   - une fiche d'inscription est créée avec les informations de la pré-inscription (enfant, lieu de naissance, tenue,
//     responsables). Adresse, mode de paiement et autorisations manquent : la fiche porte infos_famille_requises = 1
//     et la famille les donne depuis son espace (functions/depot/[token]/infos.js) ; tant qu'ils manquent, la fiche
//     reste « à compléter » (hasFamilyDetails) ;
//   - enfant déjà inscrit (fiche active) : simple rattachement, rien n'est recréé ; fiche mise à la corbeille par un
//     transfert inverse (« Transférée en pré-inscription ») : restaurée dans la nouvelle catégorie, avec ses données ;
//   - la ligne de pré-inscription n'est JAMAIS supprimée ni expirée : elle garde inscription_id et compte toujours
//     dans les places du groupe.
// Tout est filtré par l'organisation de la session.
import { ensureInscriptionsTable, buildDedupKey, SHIRT_SIZES } from './inscriptions-db.js';
import { ensurePreinscriptionsTable, getPreinscriptionGroups, findActiveInscriptionForChild } from './preinscriptions.js';
import { ensureCategory } from './preinscription-opening.js';
import { getCategoriesConfig } from './settings-kv.js';
import { syncInscriptionSafe } from './crm.js';
import { sendPreinscriptionTransferEmail } from './confirmation-email.js';

export const MAX_TRANSFER = 60;

// Identifiants reçus du formulaire : entiers positifs, sans doublon, bornés.
export function parseIds(values) {
  const ids = [...new Set(values.map((v) => Number.parseInt(String(v), 10)).filter((n) => Number.isInteger(n) && n > 0))];
  return ids.slice(0, MAX_TRANSFER);
}

const yearOf = (row) => Number(String(row.naissance || '').slice(0, 4));
const categoryFor = (categories, year) => categories.find((c) => c.active !== false && Number.isInteger(c.anneeMin) && year >= c.anneeMin && year <= c.anneeMax) || null;

async function loadRows(db, organizationId, ids) {
  if (!ids.length) return [];
  const { results } = await db
    .prepare(`SELECT * FROM preinscriptions WHERE organization_id = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .bind(organizationId, ...ids)
    .all();
  return results;
}

// Ce qui se passera pour chaque enfant, sans rien écrire (écran de confirmation).
// items : [{ row, category, issue }] ; issue : null | 'already' | 'size' | 'no_category'.
// toCreate : groupes dont la catégorie manque (à proposer de créer).
export async function planTransfer(env, organizationId, ids) {
  await ensurePreinscriptionsTable(env.DB);
  const rows = await loadRows(env.DB, organizationId, ids);
  const [{ categories }, groups] = await Promise.all([getCategoriesConfig(env, organizationId), getPreinscriptionGroups(env, organizationId)]);
  const toCreate = new Map();
  const items = rows.map((row) => {
    if (row.inscription_id) return { row, category: null, issue: 'already' };
    const category = categoryFor(categories || [], yearOf(row));
    if (!category) {
      const group = groups.find((g) => g.groupe === row.groupe);
      if (group && yearOf(row) >= group.anneeMin && yearOf(row) <= group.anneeMax) toCreate.set(group.groupe, group);
      return { row, category: null, issue: 'no_category', group: group || null };
    }
    if (!SHIRT_SIZES.includes(row.taille_maillot)) return { row, category, issue: 'size' };
    return { row, category, issue: null };
  });
  return { items, toCreate: [...toCreate.values()] };
}

const childData = (row) => ({ enfantPrenom: row.enfant_prenom, enfantNom: row.enfant_nom, naissance: row.naissance });

async function linkPreinscription(db, organizationId, preinscriptionId, inscriptionId) {
  await db
    .prepare('UPDATE preinscriptions SET inscription_id = ? WHERE organization_id = ? AND id = ? AND inscription_id IS NULL')
    .bind(inscriptionId, organizationId, preinscriptionId)
    .run();
}

// Une pré-inscription. Résultat : { status: 'created' | 'restored' | 'linked' | 'skipped', inscriptionId?, reason? }.
async function transferOne(env, organizationId, row, category, saison) {
  if (row.inscription_id) return { status: 'skipped', reason: 'déjà transféré(e)' };
  if (!category) return { status: 'skipped', reason: 'aucune catégorie pour son année de naissance' };
  const active = await findActiveInscriptionForChild(env.DB, organizationId, childData(row));
  if (active) {
    await linkPreinscription(env.DB, organizationId, row.id, active.id);
    return { status: 'linked', inscriptionId: active.id };
  }
  if (!SHIRT_SIZES.includes(row.taille_maillot)) return { status: 'skipped', reason: 'taille de tenue à compléter' };

  const dedupKey = buildDedupKey({ enfantPrenom: row.enfant_prenom, enfantNom: row.enfant_nom, email: row.email });
  const uploadToken = crypto.randomUUID();
  const inserted = await env.DB
    .prepare(
      `INSERT INTO inscriptions
        (organization_id, enfant_prenom, enfant_nom, naissance, categorie, taille_maillot, mode_paiement, parent_prenom, parent_nom, email, telephone,
         autorisation, droit_image, rgpd, upload_token, dedup_key, saison, parent2_prenom, parent2_nom, parent2_email, parent2_telephone,
         ville_naissance, pays_naissance, cp_naissance, infos_famille_requises)
       SELECT ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1
       WHERE NOT EXISTS (
         SELECT 1 FROM inscriptions WHERE organization_id = ? AND dedup_key = ? AND naissance = ? AND (saison = ? OR saison IS NULL)
       )`
    )
    .bind(
      organizationId, row.enfant_prenom, row.enfant_nom, row.naissance, category.label, row.taille_maillot,
      row.parent_prenom, row.parent_nom, row.email, row.telephone || null,
      uploadToken, dedupKey, saison, row.parent2_prenom || null, row.parent2_nom || null, row.parent2_email || null, row.parent2_telephone || null,
      row.ville_naissance || null, row.pays_naissance || null, row.cp_naissance || null,
      organizationId, dedupKey, row.naissance, saison
    )
    .run();
  if (inserted.meta.changes) {
    const created = await env.DB.prepare('SELECT id FROM inscriptions WHERE organization_id = ? AND upload_token = ?').bind(organizationId, uploadToken).first();
    await linkPreinscription(env.DB, organizationId, row.id, created.id);
    return { status: 'created', inscriptionId: created.id };
  }
  // Une fiche de la saison existe déjà pour cet enfant (même e-mail), forcément à la corbeille puisqu'aucune fiche
  // active n'a été trouvée : celle d'un transfert inverse est restaurée dans la nouvelle catégorie ; toute autre
  // (désinscription, doublon…) est laissée au club.
  const existing = await env.DB
    .prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND dedup_key = ? AND naissance = ? AND (saison = ? OR saison IS NULL) ORDER BY id DESC LIMIT 1')
    .bind(organizationId, dedupKey, row.naissance, saison)
    .first();
  if (existing?.archived_at && existing.archive_motif === 'preinscription') {
    await env.DB
      .prepare('UPDATE inscriptions SET archived_at = NULL, archive_motif = NULL, archive_commentaire = NULL, categorie = ? WHERE organization_id = ? AND id = ? AND archived_at IS NOT NULL')
      .bind(category.label, organizationId, existing.id)
      .run();
    await linkPreinscription(env.DB, organizationId, row.id, existing.id);
    return { status: 'restored', inscriptionId: existing.id };
  }
  return { status: 'skipped', reason: existing ? `fiche n° ${existing.id} à la corbeille : restaurez-la depuis Inscriptions` : 'fiche déjà existante' };
}

// Transfère les pré-inscriptions choisies. createCategory : crée d'abord la catégorie des groupes qui n'en ont pas.
// notify : e-mail à chaque famille dont la fiche est créée ou restaurée. Résultat : { created, restored, linked,
// skipped: [{ name, reason }], categories: [libellés créés], mailed }.
export async function transferPreinscriptions(env, organizationId, ids, { createCategory = false, notify = true, siteUrl, waitUntil = (p) => p } = {}) {
  await ensureInscriptionsTable(env.DB);
  const plan = await planTransfer(env, organizationId, ids);
  const categoriesCreated = [];
  if (createCategory) {
    for (const group of plan.toCreate) {
      if (await ensureCategory(env, organizationId, group)) categoriesCreated.push(group.label);
    }
  }
  const { saison, categories } = await getCategoriesConfig(env, organizationId);
  const result = { created: 0, restored: 0, linked: 0, skipped: [], categories: categoriesCreated, mailed: 0 };
  for (const { row } of plan.items) {
    const name = `${row.enfant_prenom} ${row.enfant_nom}`;
    let outcome;
    try {
      outcome = await transferOne(env, organizationId, row, categoryFor(categories || [], yearOf(row)), saison);
    } catch {
      outcome = { status: 'skipped', reason: 'erreur, réessayez' };
    }
    if (outcome.status === 'skipped') {
      result.skipped.push({ name, reason: outcome.reason });
      continue;
    }
    result[outcome.status] += 1;
    waitUntil(syncInscriptionSafe(env, organizationId, outcome.inscriptionId));
    if (notify && outcome.status !== 'linked') {
      const fresh = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(organizationId, outcome.inscriptionId).first();
      if (fresh && (await sendPreinscriptionTransferEmail(env, fresh, siteUrl).catch(() => false))) result.mailed += 1;
    }
  }
  return result;
}
