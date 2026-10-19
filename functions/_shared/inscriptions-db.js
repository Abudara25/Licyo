import { applyMigrations, repairSchemaInvariants } from './schema.js';
import { sha256Hex } from './security.js';
import buildInfo from '../_generated/build-info.js';

// Schéma partagé par functions/api/inscriptions.js (écriture) et functions/admin/inscriptions.js
// (lecture). CREATE TABLE IF NOT EXISTS : pas d'outil de migration pour un site sans build step,
// la table s'auto-crée au premier appel plutôt que d'exiger une étape manuelle côté utilisateur.
// Les migrations ne tournent qu'une fois par instance du Worker (et non à chaque requête, ce qui
// coûtait une trentaine de requêtes D1 par page) : la promesse est gardée en mémoire du module, et
// par binding de base, et oubliée en cas d'échec pour réessayer à l'appel suivant.
//
// Depuis 2026-09-23, cette fonction prépare TOUT le schéma : la mise à niveau historique de la table
// inscriptions ci-dessous, puis les migrations numérotées de schema.js (organisations, organization_id…).
// ensureSchema est le nom à utiliser dans le nouveau code.

//
// Délai maximal (phase 4B.2). Avant, une préparation qui ne se terminait JAMAIS (requête D1 sans réponse, par
// exemple parce que la requête qui l'avait lancée a été annulée par le client) restait mémorisée : toutes les
// requêtes suivantes de l'instance attendaient la même promesse, indéfiniment (constaté sur une prévisualisation).
// Désormais :
// - chaque appelant attend au plus SCHEMA_TIMEOUT_MS, avec SON propre minuteur (créé dans le contexte de sa
//   requête : il ne dépend pas de la requête qui a lancé la préparation) ;
// - au dépassement ou en cas d'échec, l'entrée est oubliée SI elle est toujours celle en mémoire (une ancienne
//   préparation qui se termine tard ne retire jamais celle, plus récente, d'une nouvelle tentative) ;
// - la requête suivante relance une préparation (pas de boucle de nouvelles tentatives dans une même requête) ;
// - les appels simultanés partagent toujours une seule préparation.
// 15 s : la préparation d'une base existante (quelques dizaines de requêtes D1 de lecture, PRAGMA, contrôles
// d'invariants) prend normalement bien moins d'une seconde, une première création complète quelques secondes ;
// 15 s laisse une large marge sans laisser une page en attente plus longtemps qu'un visiteur ne patiente. Une
// préparation dépassée n'est pas annulée (D1 ne le permet pas) : les migrations sont transactionnelles et
// rejouables, une nouvelle tentative concurrente est sans danger.
export const SCHEMA_TIMEOUT_MS = 15_000;

export class SchemaTimeoutError extends Error {
  constructor(step, ms) {
    super(`Préparation du schéma D1 trop longue (étape ${step}, ${ms} ms)`);
    this.name = 'SchemaTimeoutError';
  }
}

// Raccourci de démarrage (2026-10-08). Le contrôle complet ci-dessous enchaîne environ 200 requêtes D1 l'une après
// l'autre : 4 à 5 s d'attente sur la première requête de CHAQUE nouvelle instance du Worker (mesuré en production :
// 4,4 s de durée pour 124 ms de calcul), ressenties comme un site lent. Désormais il ne tourne qu'une fois par
// déploiement et par structure de base : une fois réussi, l'empreinte (identifiant du build + liste complète des
// tables, index et triggers de sqlite_master + versions de migration appliquées) est notée dans schema_checks. Une
// instance qui démarre lit ces trois informations en UN aller-retour (db.batch) et ne refait le contrôle complet que si
// l'empreinte est nouvelle : nouveau déploiement, objet ajouté, modifié ou supprimé, migration manquante.
// Limite assumée : entre deux déploiements, une anomalie de DONNÉES seule (sans changement de structure) n'est plus
// détectée au démarrage d'une instance ; elle l'est au déploiement suivant. Hors build Pages (« dev » : tests, serveur
// local), le raccourci est désactivé et le comportement est inchangé.
const SCHEMA_CHECKS_TABLE = `CREATE TABLE IF NOT EXISTS schema_checks (
        fingerprint TEXT PRIMARY KEY,
        checked_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`;
let fastPathBuildId = buildInfo?.buildId && buildInfo.buildId !== 'dev' ? buildInfo.buildId : null;

// Tests uniquement : active le raccourci avec un identifiant de build donné (null : désactivé).
export function setSchemaFastPathForTests(buildId) {
  fastPathBuildId = buildId;
}

async function schemaFingerprint(db, { withChecks }) {
  const statements = [
    db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_' AND tbl_name <> 'schema_checks' ORDER BY type, name"),
    db.prepare('SELECT version FROM schema_migrations ORDER BY version'),
  ];
  if (withChecks) statements.push(db.prepare('SELECT fingerprint FROM schema_checks'));
  const [objects, versions, checks] = await db.batch(statements);
  const fingerprint = await sha256Hex(JSON.stringify([fastPathBuildId, objects.results, versions.results]));
  return { fingerprint, known: new Set((checks?.results || []).map((row) => row.fingerprint)) };
}

async function prepareSchema(db, progress) {
  if (fastPathBuildId) {
    progress.step = 'empreinte';
    try {
      const { fingerprint, known } = await schemaFingerprint(db, { withChecks: true });
      if (known.has(fingerprint)) {
        progress.step = 'terminé';
        return;
      }
    } catch {
      // Table schema_checks (ou autre) absente : contrôle complet.
    }
  }
  progress.step = 'inscriptions';
  await migrateInscriptionsTable(db);
  progress.step = 'migrations';
  await applyMigrations(db);
  // Invariants multi-organisation contrôlés à chaque démarrage (voir schema.js).
  progress.step = 'invariants';
  await repairSchemaInvariants(db);
  if (fastPathBuildId) {
    progress.step = 'mémorisation';
    // Au mieux : un échec ici ne fait jamais échouer la requête (le contrôle complet a réussi).
    try {
      const { fingerprint } = await schemaFingerprint(db, { withChecks: false });
      await db.batch([
        db.prepare(SCHEMA_CHECKS_TABLE),
        db.prepare('INSERT OR IGNORE INTO schema_checks (fingerprint) VALUES (?)').bind(fingerprint),
        // Seules les empreintes récentes servent (déploiement en cours et précédents) : la table reste minuscule.
        db.prepare('DELETE FROM schema_checks WHERE fingerprint NOT IN (SELECT fingerprint FROM schema_checks ORDER BY checked_at DESC LIMIT 20)'),
      ]);
    } catch {
      console.warn('ensureSchema : empreinte non mémorisée (contrôle complet au prochain démarrage)');
    }
  }
  progress.step = 'terminé';
}

// Journal sans donnée personnelle : étape, durée, type d'erreur (jamais le message, qui peut citer une valeur).
const logSchemaProblem = (kind, entry, error) =>
  console.warn(`ensureSchema : ${kind} à l'étape « ${entry.progress.step} » après ${Date.now() - entry.progress.started} ms (${error?.name || 'Error'})`);

let schemaReady = new WeakMap();
const forget = (db, entry) => {
  if (schemaReady.get(db) === entry) schemaReady.delete(db);
};

// `timeoutMs` et `prepare` : réglages réservés aux tests (tests/ensure-schema.test.mjs).
export async function ensureInscriptionsTable(db, { timeoutMs = SCHEMA_TIMEOUT_MS, prepare = prepareSchema } = {}) {
  let entry = schemaReady.get(db);
  if (!entry) {
    const progress = { step: 'démarrage', started: Date.now() };
    entry = { progress, promise: null };
    entry.promise = Promise.resolve().then(() => prepare(db, progress));
    schemaReady.set(db, entry);
    const current = entry;
    current.promise.catch((error) => {
      forget(db, current);
      logSchemaProblem('échec', current, error);
    });
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SchemaTimeoutError(entry.progress.step, timeoutMs)), timeoutMs);
  });
  try {
    await Promise.race([entry.promise, timeout]);
  } catch (error) {
    if (error instanceof SchemaTimeoutError) {
      forget(db, entry);
      logSchemaProblem('délai dépassé', entry, error);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const ensureSchema = ensureInscriptionsTable;

// Tests uniquement (tests/) : chaque test part d'une base neuve.
export function resetSchemaCacheForTests() {
  schemaReady = new WeakMap();
}

async function migrateInscriptionsTable(db, retry = true) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS inscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        enfant_prenom TEXT NOT NULL,
        enfant_nom TEXT NOT NULL,
        naissance TEXT NOT NULL,
        categorie TEXT NOT NULL,
        taille_maillot TEXT NOT NULL,
        parent_prenom TEXT NOT NULL,
        parent_nom TEXT NOT NULL,
        email TEXT NOT NULL,
        telephone TEXT,
        adresse TEXT,
        code_postal TEXT,
        ville TEXT,
        autorisation INTEGER NOT NULL,
        droit_image INTEGER NOT NULL,
        rgpd INTEGER NOT NULL
      )`
    )
    .run();

  // Colonnes ajoutées après la création initiale de la table en production : ALTER TABLE ADD
  // COLUMN plutôt que CREATE TABLE IF NOT EXISTS, pour que les bases déjà existantes suivent.
  // Seules les colonnes absentes sont ajoutées ; les erreurs réelles remontent.
  const addedColumns = [
    'mode_paiement TEXT', // 2026-09-04
    // 2026-09-04 : dépôt du dossier signé (voir functions/depot/[token].js) — upload_token est
    // généré à l'inscription (functions/api/inscriptions.js) et sert de clé secrète pour le lien
    // de dépôt public ; dossier_key est la clé de l'objet dans le bucket R2 "DOSSIERS".
    'upload_token TEXT',
    'dossier_key TEXT',
    'dossier_content_type TEXT',
    'dossier_uploaded_at TEXT',
    // 2026-09-09 : voir buildDedupKey() ci-dessous — SQLite/D1 ne gère pas les accents dans
    // LOWER()/UPPER() (LOWER('É') renvoie 'É' inchangé), donc LOWER(TRIM(enfant_prenom)) = LOWER(?)
    // ne détectait pas "Léa" vs "LÉA" comme le même prénom. dedup_key est calculée en JS
    // (accents retirés) à l'écriture, comparée par égalité stricte plutôt que via LOWER() en SQL.
    'dedup_key TEXT',
    // 2026-09-09 : statut de paiement, coché manuellement par un responsable depuis /admin/
    // inscriptions (mode_paiement dit *comment* la famille compte payer, choisi à l'inscription ;
    // paye dit si l'argent a *effectivement* été reçu — utile pour Espèces/Chèque, qui ne sont pas
    // confirmés automatiquement comme le serait un paiement HelloAsso). 0/1, INTEGER comme
    // autorisation/droit_image/rgpd.
    'paye INTEGER NOT NULL DEFAULT 0',
    // 2026-09-09 : archivage ("corbeille") — sortir un profil de la liste active sans le supprimer
    // définitivement (voir functions/admin/inscriptions.js, action=archive/restore). NULL = actif ;
    // une date = archivé, affichée telle quelle dans la corbeille (même convention que created_at).
    'archived_at TEXT',
    // Saison au moment de l'inscription (ex. "2026-2027"), lue côté serveur depuis
    // _shared/settings-kv.js au moment du POST (functions/api/inscriptions.js) — jamais la valeur
    // envoyée par le client, qui a pu charger /api/categories avant un changement de saison
    // entre-temps. Tamponnée rétroactivement pour les fiches déjà en base au moment de l'ajout de
    // cette colonne (voir juste après la boucle ci-dessous) : au lancement de cette fonctionnalité,
    // le club n'a connu qu'une seule saison ("2026-2027"), donc toutes les lignes existantes en sont
    // forcément — indispensable pour que la comparaison stricte de saison utilisée par la
    // réinscription (functions/reinscription/[token].js) et par le contrôle anti-doublon
    // (findExistingInscription ci-dessous) les reconnaisse encore comme "saison en cours" une fois
    // la saison suivante ouverte, plutôt que de les traiter en permanence comme "saison inconnue".
    'saison TEXT',
    // Jeton pour /reinscription/<token> (functions/reinscription/[token].js) : généré par l'action
    // "Envoyer le lien de réinscription" de /admin/inscriptions (onRequestPost, bulk-reinscription)
    // sur la fiche de la saison qui se termine — ouvre un formulaire pré-rempli à partir de cette
    // fiche pour créer celle de la saison suivante. NULL tant que la campagne n'a pas été lancée
    // pour cette famille.
    'reinscription_token TEXT',
    // 2026-09-15 : photo de l'enfant, obligatoire pour que l'inscription soit complète (voir
    // isInscriptionComplete ci-dessous) — déposée par la famille sur /depot/<token> ou par un
    // responsable depuis la fiche admin, stockée dans le bucket R2 "DOSSIERS" (clé photos/…, voir
    // _shared/photo-storage.js).
    'photo_key TEXT',
    'photo_content_type TEXT',
    'photo_uploaded_at TEXT',
    // 2026-09-15 : automatisations (_shared/automations.js) — complete_notified_at évite de renvoyer
    // l'e-mail "Dossier complet" ; last_reminder_at/auto_reminders_sent espacent et limitent les
    // relances automatiques (une relance manuelle compte aussi) ; helloasso_order_id garde la
    // commande HelloAsso qui a validé le paiement (_shared/helloasso.js).
    'complete_notified_at TEXT',
    'last_reminder_at TEXT',
    'auto_reminders_sent INTEGER NOT NULL DEFAULT 0',
    'helloasso_order_id TEXT',
    // 2026-09-15 : second responsable légal, facultatif (prénom + nom requis dès qu'un champ est
    // rempli, voir functions/api/inscriptions.js). Reçoit les mêmes e-mails que le premier.
    'parent2_prenom TEXT',
    'parent2_nom TEXT',
    'parent2_email TEXT',
    'parent2_telephone TEXT',
    // 2026-09-15 : vérification du dossier signé par le club (voir dossierStatus ci-dessous) — des
    // familles envoyaient un dossier non signé ou non daté, compté comme reçu. dossier_status :
    // 'a_verifier' (déposé par la famille), 'valide', 'refuse' ; motifs = clés de DOSSIER_REFUS_MOTIFS
    // séparées par des virgules. Les motifs du dernier refus sont gardés après un nouveau dépôt, pour
    // que le responsable sache quoi contrôler.
    'dossier_status TEXT',
    'dossier_verified_at TEXT',
    'dossier_refused_at TEXT',
    'dossier_refus_motifs TEXT',
    'dossier_refus_commentaire TEXT',
    // 2026-10-08 : photo à refaire, demandée par le club (motifs = clés de PHOTO_REFUS_MOTIFS séparées par des
    // virgules). Le refus efface photo_uploaded_at (la photo ne compte plus comme reçue) ; le fichier est conservé.
    'photo_refused_at TEXT',
    'photo_refus_motifs TEXT',
    'photo_refus_commentaire TEXT',
    // 2026-09-17 : code Pass'Sport (aide de l'État de 50 €, https://www.sports.gouv.fr), facultatif,
    // saisi par la famille à l'inscription — le club le reporte sur Le Compte Asso pour se faire
    // rembourser les 50 € déduits de l'adhésion. Aucune vérification automatique n'est possible :
    // c'est une déclaration, et le paiement (colonne paye) reste validé à la main par un responsable.
    "pass_sport_code TEXT",
    // 2026-09-23 : motif de mise en corbeille, obligatoire (clé de ARCHIVE_MOTIFS ci-dessous) et précision
    // libre. Effacés à la restauration.
    'archive_motif TEXT',
    'archive_commentaire TEXT',
    // 2026-09-27 : lieu de naissance de l'enfant (demandé pour la licence FFF, saisi par la famille) et numéro de
    // licence FFF (saisi par le club sur la fiche une fois la licence enregistrée sur Footclubs). NULL pour les
    // fiches antérieures : rien n'est rempli d'office.
    'ville_naissance TEXT',
    'pays_naissance TEXT',
    'numero_licence TEXT',
    // 2026-09-27 : code postal de la commune de naissance (né en France), la ville étant proposée d'après lui.
    'cp_naissance TEXT',
    // 2026-10-16 : note interne du club (fiche adhérent), jamais montrée à la famille ni envoyée par e-mail.
    'note_interne TEXT',
    // 2026-10-16 : suivi licence et tenue coché par le club (functions/_shared/club-followup.js), une date par case.
    'licence_demandee_at TEXT',
    'licence_verif_at TEXT',
    'tenue_commandee_at TEXT',
    'tenue_remise_at TEXT',
  ];
  const { results: columns } = await db.prepare('PRAGMA table_info(inscriptions)').all();
  const present = new Set(columns.map((column) => column.name));
  const changes = addedColumns
    .filter((column) => !present.has(column.split(' ')[0]))
    .map((column) => db.prepare(`ALTER TABLE inscriptions ADD COLUMN ${column}`));

  // Remplissages idempotents : réparent aussi une migration ancienne interrompue après ALTER.
  // Une saison inconnue correspond aux fiches antérieures à l'introduction des saisons.
  changes.push(
    db.prepare("UPDATE inscriptions /* toutes-organisations */ SET dossier_status = 'a_verifier' WHERE dossier_uploaded_at IS NOT NULL AND dossier_status IS NULL"),
    db.prepare("UPDATE inscriptions /* toutes-organisations */ SET saison = '2026-2027' WHERE saison IS NULL"),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_inscriptions_upload_token ON inscriptions(upload_token)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_inscriptions_reinscription_token ON inscriptions(reinscription_token)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_inscriptions_dedup_key ON inscriptions(dedup_key)')
  );
  try {
    // D1 batch est transactionnel : aucun schéma partiellement migré en cas de panne.
    await db.batch(changes);
  } catch (error) {
    // Un autre Worker a pu ajouter les colonnes depuis le PRAGMA. Relire le schéma ;
    // toutes les autres erreurs doivent faire échouer l'appel et permettre une reprise.
    if (retry && /duplicate column name/i.test(String(error?.message))) return migrateInscriptionsTable(db, false);
    throw error;
  }

  const { results: legacy } = await db.prepare('SELECT * FROM inscriptions /* toutes-organisations */ WHERE dedup_key IS NULL').all();
  for (const row of legacy) {
    await db.prepare('UPDATE inscriptions /* toutes-organisations */ SET dedup_key = ? WHERE id = ? AND dedup_key IS NULL')
      .bind(buildDedupKey({ enfantPrenom: row.enfant_prenom, enfantNom: row.enfant_nom, email: row.email }), row.id)
      .run();
  }
}

// Motifs proposés au responsable qui refuse un dossier (fiche admin) et repris tels quels dans l'e-mail
// envoyé à la famille et sur sa page de suivi. Les clés sont stockées en base : ne pas les renommer.
export const DOSSIER_REFUS_MOTIFS = {
  signature: 'La signature du responsable légal est manquante.',
  date: 'Le lieu et la date (« Fait à …, le … ») ne sont pas remplis.',
  pages: 'Une partie du dossier est manquante (page ou document incomplet).',
  illisible: 'Le document est illisible (flou, coupé ou trop sombre).',
  document: "Le fichier envoyé n'est pas le dossier d'inscription.",
};

// Motifs de mise en corbeille (fiche, sélection multiple, fin de saison). Clés stockées en base : ne pas
// les renommer. 'fin_saison' n'est posé que par l'archivage de fin de saison (/admin/categories).
// Tailles de tenue acceptées (formulaire d'inscription et pré-inscription ; mêmes valeurs que sites/…/content).
export const SHIRT_SIZES = Object.freeze(['4 ans', '6 ans', '8 ans', '10 ans', '12 ans']);

export const ARCHIVE_MOTIFS = {
  desinscription: 'Désinscription (la famille se retire)',
  annulation: 'Inscription annulée par le club',
  sans_suite: 'Dossier jamais finalisé',
  doublon: 'Doublon',
  erreur: 'Erreur de saisie ou fiche de test',
  autre: 'Autre',
  fin_saison: 'Fin de saison',
  // 2026-10-08 : posé seulement par le transfert vers la pré-inscription (functions/admin/inscriptions/[id]/preinscription.js).
  preinscription: 'Transférée en pré-inscription',
};
export const ARCHIVE_MOTIFS_MANUELS = Object.keys(ARCHIVE_MOTIFS).filter((key) => key !== 'fin_saison' && key !== 'preinscription');

// Fiche transférée en pré-inscription : l'enfant est désormais dans la liste de pré-inscription. La ligne reste en base
// (rien n'est supprimé, fiche consultable depuis la carte de pré-inscription) mais n'apparaît plus dans la corbeille,
// où il semblait être à deux endroits à la fois.
export const isTransferredToPreinscription = (row) => row.archive_motif === 'preinscription';

// Texte affiché dans l'admin : libellé du motif, suivi de la précision s'il y en a une.
export function archiveReason(row) {
  const label = ARCHIVE_MOTIFS[row.archive_motif] || '';
  const comment = String(row.archive_commentaire || '').trim();
  if (!label) return comment;
  return comment ? `${label} : ${comment}` : label;
}

// Motif soumis par un formulaire d'archivage : { motif, commentaire } ou { error }.
export function readArchiveReason(form) {
  const motif = String(form.get('archiveMotif') || '');
  const commentaire = String(form.get('archiveCommentaire') || '').trim().slice(0, 300);
  if (!ARCHIVE_MOTIFS_MANUELS.includes(motif)) return { error: 'Indiquez pourquoi la fiche est mise à la corbeille.' };
  if (motif === 'autre' && !commentaire) return { error: 'Précisez le motif « Autre ».' };
  return { motif, commentaire: commentaire || null };
}

export const refusMotifs = (row) =>
  String(row.dossier_refus_motifs || '')
    .split(',')
    .filter((key) => key in DOSSIER_REFUS_MOTIFS)
    .map((key) => DOSSIER_REFUS_MOTIFS[key]);

// Catégorie d'âge d'un enfant pour l'admin (filtres, sous-titres) : celle du club qui contient son année de naissance
// (« U6 - U7 », « U8 - U9 », puis « U10 » dès que le groupe existe, voir loadAgeContext dans preinscriptions.js).
// Hors de toute catégorie : paire de la FFF calculée sur la saison (« 2026-2027 » : U = 2027 moins l'année de
// naissance ; U10 et U11 → « U10 - U11 »). ctx : { saison, ranges: [{ label, anneeMin, anneeMax }] } ou la saison seule.
// '' si la date ou la saison est inconnue.
export function ageGroup(naissance, ctx) {
  const { saison, ranges = [] } = typeof ctx === 'object' && ctx ? ctx : { saison: ctx };
  const birth = Number(String(naissance || '').slice(0, 4));
  if (!birth) return '';
  const range = ranges.find((r) => birth >= r.anneeMin && birth <= r.anneeMax);
  if (range) return range.label;
  const end = Number(String(saison || '').split('-')[1]);
  const u = end - birth;
  if (!end || u < 1 || u > 30) return '';
  const first = u % 2 === 0 ? u : u - 1;
  return `U${first} - U${first + 1}`;
}

// Tranches de naissance des catégories du club (actives ou non) et du groupe en pré-inscription s'il n'est pas
// encore une catégorie. Fonction pure : loadAgeContext (preinscriptions.js) lit les réglages.
export function ageRangesFrom(categories = [], preinscription = null) {
  const valid = (r) => r && Number.isInteger(r.anneeMin) && Number.isInteger(r.anneeMax) && String(r.label || '').trim();
  const ranges = categories.filter(valid).map((c) => ({ label: String(c.label).trim(), anneeMin: c.anneeMin, anneeMax: c.anneeMax }));
  if (valid(preinscription) && !ranges.some((r) => r.anneeMin <= preinscription.anneeMax && r.anneeMax >= preinscription.anneeMin)) {
    ranges.push({ label: preinscription.label, anneeMin: preinscription.anneeMin, anneeMax: preinscription.anneeMax });
  }
  return ranges;
}

// Plus jeunes d'abord (U6 - U7 avant U8 - U9), libellés sans numéro à la fin.
const firstU = (label) => {
  const m = /U\s*(\d+)/i.exec(label);
  return m ? Number(m[1]) : Infinity;
};
export const sortAgeGroups = (groups) => [...groups].sort((a, b) => firstU(a) - firstU(b) || String(a).localeCompare(String(b)));

// Photo de l'enfant à refaire (demande du club) : motifs proposés, clés stockées en base (ne pas les renommer).
export const PHOTO_REFUS_MOTIFS = {
  fond: "Le fond n'est pas blanc (ou très clair).",
  cadrage: 'La photo doit montrer uniquement le visage, de face, des épaules au haut de la tête.',
  floue: 'La photo est floue, trop sombre ou trop petite.',
  cache: 'Le visage est en partie caché (casquette, lunettes de soleil, main…).',
  personne: 'Une autre personne ou un objet apparaît sur la photo.',
};
export const photoRefusMotifs = (row) =>
  String(row.photo_refus_motifs || '')
    .split(',')
    .filter((key) => key in PHOTO_REFUS_MOTIFS)
    .map((key) => PHOTO_REFUS_MOTIFS[key]);
// Photo refusée et pas encore renvoyée.
export const isPhotoToRedo = (row) => !row.photo_uploaded_at && Boolean(row.photo_refused_at);

// 'manquant' | 'a_verifier' | 'valide' | 'refuse'. Un fichier sans statut connu reste à vérifier.
export function dossierStatus(row) {
  if (!row.dossier_uploaded_at) return 'manquant';
  return ['valide', 'refuse'].includes(row.dossier_status) ? row.dossier_status : 'a_verifier';
}

export const isDossierValidated = (row) => dossierStatus(row) === 'valide';

// Lieu de naissance (2026-09-27, demandé pour la licence FFF) : ville et pays requis. Le code postal est facultatif
// (né à l'étranger). Saisi par la famille (formulaire, espace famille) ou par le club (fiche).
export const hasBirthPlace = (row) => Boolean(String(row.ville_naissance || '').trim() && String(row.pays_naissance || '').trim());

// Inscription complète = dossier signé VALIDÉ par le club + paiement reçu + photo de l'enfant reçue + lieu de naissance.
// Même définition partout : page famille (/depot/<token>), liste et tableau de bord admin, relances (et son équivalent
// SQL COMPLETE_INSCRIPTION_SQL de crm.js, pour la liste Adhérents).
export const isInscriptionComplete = (row) => Boolean(isDossierValidated(row) && row.paye && row.photo_uploaded_at && hasBirthPlace(row));

// Reste-t-il quelque chose à faire côté famille ? Un dossier en cours de vérification attend le club :
// on ne relance pas une famille pour ça.
// Réinscriptions : fiches de la saison en cours d'un enfant déjà inscrit une saison précédente (même dedup_key,
// comme « déjà réinscrit » dans /admin/reinscription). Calculé à la lecture, rien n'est stocké. Tant qu'elle n'est pas
// complète, une réinscription se suit dans /admin/reinscription ; complète, elle passe dans /admin/adherents.
export function reinscriptionIds(rows, saison) {
  const earlier = new Set(rows.filter((r) => r.saison && r.saison !== saison && r.dedup_key).map((r) => r.dedup_key));
  return new Set(rows.filter((r) => r.saison === saison && earlier.has(r.dedup_key)).map((r) => r.id));
}

export const familyHasActionPending = (row) =>
  !row.paye || !row.photo_uploaded_at || !hasBirthPlace(row) || ['manquant', 'refuse'].includes(dossierStatus(row));

// Retire les accents et met en minuscules — SQLite LOWER() étant limité à l'ASCII (voir plus haut),
// la normalisation se fait ici, côté JS, avant toute comparaison ou écriture.
export function normalize(str) {
  return String(str || '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Clé de déduplication : prénom+nom+e-mail normalisés (sans naissance — voir findExistingInscription
// ci-dessous pour pourquoi). Calculée à l'identique à l'écriture (functions/api/inscriptions.js) et
// à la lecture, pour une comparaison par égalité stricte en SQL plutôt qu'un LOWER() qui échoue sur
// les caractères accentués.
export function buildDedupKey({ enfantPrenom, enfantNom, email }) {
  return `${normalize(enfantPrenom)}|${normalize(enfantNom)}|${normalize(email)}`;
}

// Recherche une inscription existante par identité enfant+parent. Utilisé par le contrôle strict
// au submit (functions/api/inscriptions.js, POST — naissance toujours fournie) et par le contrôle
// temps réel pendant la saisie (même fichier, GET — naissance optionnelle, pas forcément encore
// remplie au moment où prénom/nom/e-mail le sont). La correspondance sur prénom/nom/e-mail se fait
// via dedup_key (égalité stricte, calculée en JS) ; la naissance, quand fournie, est filtrée ensuite
// en JS sur les candidats trouvés — la table reste petite (un seul club), pas besoin de l'inclure
// dans la clé indexée.
//
// currentSaison (optionnel) : sans lui, une même famille redevenait "doublon" à chaque nouvelle
// saison, y compris pour une vraie réinscription légitime — corrigé en scopant le contrôle aux
// fiches de la saison en cours (saison = currentSaison). Le repli "!r.saison" (fiche sans saison
// connue) est une pure sécurité : ensureInscriptionsTable() ci-dessus tamponne déjà toutes les
// fiches existantes à "2026-2027" dès l'ajout de la colonne, il ne devrait plus jamais y avoir de
// saison NULL en pratique. functions/reinscription/[token].js n'utilise volontairement PAS cette
// fonction pour savoir si une réinscription a déjà eu lieu : il lui faut une correspondance stricte
// sur la saison (voir findCurrentSeasonSubmission dans ce fichier), pas ce repli — la fiche chargée
// par le token est elle-même celle de la saison qui se termine.
// Limitée à une organisation : le même enfant peut être inscrit dans deux organisations différentes.
export async function findExistingInscription(db, organizationId, { enfantPrenom, enfantNom, naissance, email }, currentSaison) {
  const dedupKey = buildDedupKey({ enfantPrenom, enfantNom, email });
  const { results } = await db
    .prepare('SELECT upload_token, created_at, naissance, saison FROM inscriptions WHERE organization_id = ? AND dedup_key = ?')
    .bind(organizationId, dedupKey)
    .all();

  const scoped = currentSaison ? results.filter((r) => !r.saison || r.saison === currentSaison) : results;

  if (!scoped.length) return null;
  if (!naissance) return scoped[0];
  return scoped.find((r) => r.naissance === naissance) || null;
}

// Utilisé uniquement par functions/reinscription/[token].js pour savoir si une famille a déjà
// finalisé sa réinscription de la saison en cours (affiche alors "déjà réinscrit" plutôt que le
// formulaire). Volontairement une correspondance STRICTE sur la saison (pas de repli "!r.saison"
// comme dans findExistingInscription ci-dessus) : la fiche chargée par le token de réinscription est
// elle-même celle de la saison qui se termine, un repli sur "sans saison connue" la ferait
// correspondre à elle-même dès le premier chargement du lien, avant toute réinscription réelle.
export async function findCurrentSeasonSubmission(db, organizationId, { enfantPrenom, enfantNom, naissance, email }, currentSaison) {
  const dedupKey = buildDedupKey({ enfantPrenom, enfantNom, email });
  const { results } = await db
    .prepare('SELECT naissance FROM inscriptions WHERE organization_id = ? AND dedup_key = ? AND saison = ?')
    .bind(organizationId, dedupKey, currentSaison)
    .all();
  return results.some((r) => r.naissance === naissance);
}
