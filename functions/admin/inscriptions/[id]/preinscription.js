// Transfert d'une inscription vers la pré-inscription (ou simple retrait des inscriptions si l'enfant y est déjà) (liste d'intérêt, voir _shared/preinscriptions.js), depuis la fiche
// admin : par exemple un enfant né en 2017 inscrit par erreur dans une catégorie existante. Les informations de la fiche
// (enfant, lieu de naissance, responsables légaux) sont recopiées dans la liste, avec le plafond et l'anti-doublon
// habituels, puis l'inscription passe à la corbeille avec le motif « Transférée en pré-inscription » : elle reste
// récupérable et rien n'est supprimé. Aucun e-mail n'est envoyé (action du club).
import { ensureInscriptionsTable } from '../../../_shared/inscriptions-db.js';
import { isAuthed, loginPage } from '../../../_shared/admin-auth.js';
import { ensurePreinscriptionsTable, getPreinscriptionGroups, groupForYear, insertPreinscription, cleanBirthPlace, findPreinscriptionForChild } from '../../../_shared/preinscriptions.js';
import { syncInscriptionSafe } from '../../../_shared/crm.js';

export async function onRequestPost({ request, env, params, waitUntil }) {
  const admin = await isAuthed(request, env);
  if (!admin) return new Response(loginPage(), { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

  await ensureInscriptionsTable(env.DB);
  const org = admin.organizationId;
  const id = Number(params.id);
  const row = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(org, id).first();
  if (!row) return new Response('Inscription introuvable.', { status: 404 });

  const back = (param) => new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?${param}` } });
  const error = (message) => back(`transfertError=${encodeURIComponent(message)}`);

  if (row.archived_at) return error('Cette inscription est déjà à la corbeille.');
  const groups = await getPreinscriptionGroups(env, org);
  if (!groups.length) return error('Aucune pré-inscription n’est configurée.');
  const year = Number(String(row.naissance || '').slice(0, 4));
  await ensurePreinscriptionsTable(env.DB);
  // Plusieurs groupes (2026-11-04) : celui où l'enfant est déjà, sinon celui de son année de naissance.
  const listed = await findPreinscriptionForChild(env.DB, org, null, { enfantPrenom: row.enfant_prenom, enfantNom: row.enfant_nom, naissance: row.naissance });
  // Fiche créée depuis cette pré-inscription (transfert par le club) : la renvoyer à la corbeille n'a pas de sens.
  if (listed && Number(listed.inscription_id) === row.id) return error('Cette fiche a été créée depuis la pré-inscription : elle y est déjà comptée.');
  const config = (listed && groups.find((g) => g.groupe === listed.groupe)) || groupForYear(groups, year);
  if (!config) return error(`Aucune pré-inscription pour les enfants nés en ${year}.`);
  if (!listed && config.openedAt) return error(`Le groupe ${config.label} est ouvert : changez simplement la catégorie de la fiche avec « Modifier ».`);
  if (!listed && !(year >= config.anneeMin && year <= config.anneeMax)) {
    const years = config.anneeMin === config.anneeMax ? `en ${config.anneeMin}` : `entre ${config.anneeMin} et ${config.anneeMax}`;
    return error(`La pré-inscription ${config.label} est réservée aux enfants nés ${years}.`);
  }

  await ensurePreinscriptionsTable(env.DB);
  const result = await insertPreinscription(env.DB, org, config, {
    enfantPrenom: row.enfant_prenom,
    enfantNom: row.enfant_nom,
    naissance: row.naissance,
    villeNaissance: cleanBirthPlace(row.ville_naissance),
    paysNaissance: cleanBirthPlace(row.pays_naissance),
    cpNaissance: /^\d{5}$/.test(row.cp_naissance || '') ? row.cp_naissance : null,
    parentPrenom: row.parent_prenom,
    parentNom: row.parent_nom,
    email: row.email,
    telephone: row.telephone || '',
    parent2Prenom: row.parent2_prenom,
    parent2Nom: row.parent2_nom,
    parent2Email: row.parent2_email,
    parent2Telephone: row.parent2_telephone,
    tailleMaillot: row.taille_maillot,
    commentaire: `Transférée depuis l'inscription n° ${row.id} (${row.categorie}).`,
  });
  if (result.status === 'full') return error(`Les ${config.capacity} places de pré-inscription ${config.label} sont prises : augmentez le nombre de places dans Pré-inscriptions, puis recommencez.`);
  // Déjà dans la liste (la famille s'est aussi pré-inscrite) : rien à recopier, il reste à retirer la fiche des
  // inscriptions, ce qui supprime le doublon (constaté en production le 2026-10-08).
  const alreadyListed = result.status === 'duplicate';

  // Mise à la corbeille seulement une fois la pré-inscription enregistrée (jamais l'inverse : rien ne se perd).
  await env.DB.prepare(
    "UPDATE inscriptions SET archived_at = datetime('now'), archive_motif = 'preinscription', archive_commentaire = ? WHERE organization_id = ? AND id = ? AND archived_at IS NULL"
  )
    .bind(`Pré-inscription ${config.label}`, org, id)
    .run();
  waitUntil(syncInscriptionSafe(env, org, id));
  return new Response('', { status: 302, headers: { Location: `/admin/preinscriptions?groupe=${encodeURIComponent(config.groupe)}&msg=${alreadyListed ? 'retire' : 'transfert'}` } });
}
