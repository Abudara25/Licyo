// Éducateurs (2026-11-12, demande de l'utilisateur) : le club crée une fiche (prénom, nom, e-mail, rôle), envoie par
// e-mail un lien personnel à durée limitée, et l'éducateur remplit lui-même tout le reste sur /educateur/<lien> :
// identité (dont nom de naissance, pour la licence dirigeant FFF et le contrôle d'honorabilité que la FFF fait à partir
// de l'état civil), naissance, coordonnées, contact d'urgence, diplômes, tenue, photo et consentements.
//
// Même modèle de lien que l'espace famille (_shared/family-links.js) : seule l'empreinte SHA-256 du lien est en base,
// valable LINK_DAYS jours, révocable ; un lien expiré permet seulement d'en recevoir un nouveau à l'adresse de la fiche.
// Tables hors séquence de migrations (comme preinscriptions, family_links), additives, avec organization_id NOT NULL
// (dans TENANT_TABLES). Aucune pièce d'identité ni copie de diplôme n'est demandée (Footclubs les collecte) : seule la
// photo est déposée, dans le bucket R2 DOSSIERS sous educateurs/<id>-<aléa>.
import { sha256Hex, randomToken, readUpload } from './security.js';
import { oncePerBinding } from './once-per-binding.js';
import { backupCopy } from './backup-copy.js';

export const LINK_DAYS = 30;
export const RENEW_LIMIT = Object.freeze({ limit: 1, windowSeconds: 3600 });

// Clés stockées en base : ne jamais les renommer.
export const ROLES = Object.freeze({
  educateur: 'Éducateur',
  responsable: 'Responsable de catégorie',
  aide: 'Aide-éducateur',
  // 2026-11-13 : dirigeant et bénévole séparés (demande de l'utilisateur) ; la clé « dirigeant » est conservée.
  dirigeant: 'Dirigeant',
  benevole: 'Bénévole',
});
export const DIPLOMES = Object.freeze({
  cfi_u6u9: 'CFI U6-U9 certifié',
  cfi_u10u13: 'CFI U10-U13 certifié',
  cfi_seniors: 'CFI Seniors certifié',
  df_ref: 'DF Responsable école de football',
  df_jeunes: 'DF Coach jeunes',
  module_u7: 'Module U7',
  module_u9: 'Module U9',
  module_u11: 'Module U11',
  cff1: 'CFF1 (U6 à U11)',
  cff2: 'CFF2 (U12 à U15)',
  cff3: 'CFF3 (U16 à seniors)',
  bmf: 'BMF',
  bef: 'BEF',
  psc1: 'PSC1 (premiers secours)',
  psc: 'PSC (premiers secours citoyen)',
  sst: 'SST (sauveteur secouriste du travail)',
  pse1: 'PSE1 (premiers secours en équipe)',
  pse2: 'PSE2 (premiers secours en équipe)',
  bafa: 'BAFA',
  bpjeps: 'BPJEPS (précisez la spécialité ci-dessous)',
});
export const DIPLOME_GROUPS = Object.freeze([
  { label: 'Football', keys: ['cfi_u6u9', 'cfi_u10u13', 'cfi_seniors', 'df_ref', 'df_jeunes', 'bmf', 'bef', 'module_u7', 'module_u9', 'module_u11', 'cff1', 'cff2', 'cff3'] },
  { label: 'Premiers secours', keys: ['psc', 'psc1', 'sst', 'pse1', 'pse2'] },
  { label: 'Animation et autres sports', keys: ['bafa', 'bpjeps'] },
]);
export const TENUES = Object.freeze(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
export const CIVILITES = Object.freeze(['Madame', 'Monsieur']);

const TOKEN_RE = /^e[A-Za-z0-9_-]{43}$/;
export const isEducateurTokenShape = (token) => typeof token === 'string' && TOKEN_RE.test(token);
const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
export const isEmail = (value) => typeof value === 'string' && EMAIL_RE.test(value);

const TABLE = `CREATE TABLE IF NOT EXISTS educateurs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT,
        prenom TEXT NOT NULL,
        nom TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'educateur',
        categories TEXT,
        civilite TEXT,
        nom_naissance TEXT,
        naissance TEXT,
        pays_naissance TEXT,
        cp_naissance TEXT,
        ville_naissance TEXT,
        nationalite TEXT,
        telephone TEXT,
        adresse TEXT,
        code_postal TEXT,
        ville TEXT,
        urgence_nom TEXT,
        urgence_lien TEXT,
        urgence_telephone TEXT,
        diplomes TEXT,
        diplomes_autre TEXT,
        numero_licence TEXT,
        taille_tenue TEXT,
        disponibilites TEXT,
        droit_image INTEGER NOT NULL DEFAULT 0,
        rgpd INTEGER NOT NULL DEFAULT 0,
        attestation INTEGER NOT NULL DEFAULT 0,
        submitted_at TEXT,
        photo_key TEXT,
        photo_content_type TEXT,
        photo_uploaded_at TEXT,
        link_sent_at TEXT,
        note_interne TEXT,
        archived_at TEXT
      )`;
const LINKS_TABLE = `CREATE TABLE IF NOT EXISTS educateur_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        educateur_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      )`;
// Lien d'invitation de groupe (2026-11-13, demande de l'utilisateur) : le club partage UN lien dans un groupe (dirigeants,
// bénévoles…) ; chacun y saisit prénom, nom et e-mail, sa fiche est créée avec le rôle choisi par le club et son lien
// personnel part par e-mail (preuve de l'adresse). Empreinte seule en base, durée et nombre de places limités, révocable.
const INVITES_TABLE = `CREATE TABLE IF NOT EXISTS educateur_invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
        role TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
        uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0)
      )`;
const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_educateur_invites_org ON educateur_invites (organization_id, revoked_at)',
  'CREATE INDEX IF NOT EXISTS idx_educateurs_org ON educateurs (organization_id, archived_at)',
  'CREATE INDEX IF NOT EXISTS idx_educateur_links_org ON educateur_links (organization_id, educateur_id)',
];

const ready = oncePerBinding();
export function ensureEducateursTables(db) {
  return ready(db, async () => {
    await db.batch([db.prepare(TABLE), db.prepare(LINKS_TABLE), db.prepare(INVITES_TABLE), ...INDEXES.map((sql) => db.prepare(sql))]);
    // Colonne additive (2026-11-13) : fiche créée depuis un lien de groupe.
    const { results } = await db.prepare('PRAGMA table_info(educateurs)').all();
    if (!results.some((c) => c.name === 'invite_id')) {
      await db.prepare('ALTER TABLE educateurs ADD COLUMN invite_id INTEGER').run().catch((error) => {
        if (!/duplicate column/i.test(String(error?.message))) throw error;
      });
    }
  });
}

export const sqlNow = (now = Date.now()) => new Date(now).toISOString().slice(0, 19).replace('T', ' ');

// ---------- Validation ----------
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
// Texte d'une ligne : espaces resserrés, borné ; '' si vide ; null si invalide.
export function cleanLine(value, max = 100) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length > max || CONTROL.test(text) || /[\r\n]/.test(text)) return null;
  return text;
}
function cleanBlock(value, max = 500) {
  const text = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
  if (text.length > max || CONTROL.test(text)) return null;
  return text;
}
const cleanPhone = (value) => {
  const text = cleanLine(value, 30);
  return text && /^\+?[\d\s.()-]{6,30}$/.test(text) && text.replace(/\D/g, '').length >= 6 ? text : null;
};
const isFrance = (pays) => ['france', 'fr'].includes(String(pays || '').trim().toLowerCase());

// Âge plausible d'un encadrant : 16 à 90 ans, date existante et passée.
export function validBirthDate(value, now = Date.now()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const years = (now - date.getTime()) / (365.25 * 86_400_000);
  return years >= 16 && years <= 90;
}

// Champs remplis par l'éducateur (formulaire de /educateur/<lien>). Renvoie { values } ou { errors: [libellés] }.
export function validateEducateurForm(form, now = Date.now()) {
  const get = (name) => (typeof form.get(name) === 'string' ? form.get(name) : '');
  const errors = [];
  const required = (name, label, max = 100) => {
    const value = cleanLine(get(name), max);
    if (!value) errors.push(label);
    return value || '';
  };
  const optional = (name, label, max = 100) => {
    const value = cleanLine(get(name), max);
    if (value === null) errors.push(label);
    return value || '';
  };

  const civilite = CIVILITES.includes(get('civilite')) ? get('civilite') : (errors.push('civilité'), '');
  const prenom = required('prenom', 'prénom');
  const nom = required('nom', 'nom');
  const nomNaissance = optional('nomNaissance', 'nom de naissance');
  const naissance = validBirthDate(get('naissance'), now) ? get('naissance') : (errors.push('date de naissance'), '');
  const paysNaissance = required('paysNaissance', 'pays de naissance');
  let cpNaissance = '';
  if (isFrance(paysNaissance)) {
    cpNaissance = cleanLine(get('cpNaissance'), 5) || '';
    if (!/^\d{5}$/.test(cpNaissance)) errors.push('code postal de naissance');
  }
  const villeNaissance = required('villeNaissance', 'ville de naissance');
  const nationalite = required('nationalite', 'nationalité', 60);
  const telephone = cleanPhone(get('telephone')) || (errors.push('téléphone'), '');
  const adresse = required('adresse', 'adresse', 200);
  const codePostal = cleanLine(get('codePostal'), 10) || '';
  if (!/^[A-Za-z0-9 -]{3,10}$/.test(codePostal)) errors.push('code postal');
  const ville = required('ville', 'ville');
  const urgenceNom = required('urgenceNom', 'personne à prévenir');
  const urgenceLien = optional('urgenceLien', 'lien avec la personne à prévenir', 60);
  const urgenceTelephone = cleanPhone(get('urgenceTelephone')) || (errors.push('téléphone de la personne à prévenir'), '');
  const diplomes = [...new Set(form.getAll('diplomes').filter((d) => Object.hasOwn(DIPLOMES, d)))];
  const diplomesAutre = optional('diplomesAutre', 'autres diplômes', 200);
  const numeroLicence = optional('numeroLicence', 'numéro de licence', 40);
  if (numeroLicence && !/^[A-Za-z0-9][A-Za-z0-9 -]{0,39}$/.test(numeroLicence)) errors.push('numéro de licence');
  const tailleTenue = TENUES.includes(get('tailleTenue')) ? get('tailleTenue') : (errors.push('taille de tenue'), '');
  const disponibilites = cleanBlock(get('disponibilites'), 500);
  if (disponibilites === null) errors.push('disponibilités (500 caractères au plus)');
  const rgpd = get('rgpd') === '1';
  const attestation = get('attestation') === '1';
  if (!rgpd) errors.push('consentement au traitement des données');
  if (!attestation) errors.push('attestation sur l’honneur');

  if (errors.length) return { errors };
  return {
    values: {
      civilite, prenom, nom, nom_naissance: nomNaissance, naissance, pays_naissance: paysNaissance, cp_naissance: cpNaissance,
      ville_naissance: villeNaissance, nationalite, telephone, adresse, code_postal: codePostal, ville,
      urgence_nom: urgenceNom, urgence_lien: urgenceLien, urgence_telephone: urgenceTelephone,
      diplomes: diplomes.join(','), diplomes_autre: diplomesAutre, numero_licence: numeroLicence, taille_tenue: tailleTenue,
      disponibilites: disponibilites || '', droit_image: get('droitImage') === '1' ? 1 : 0, rgpd: 1, attestation: 1,
    },
  };
}

export const diplomeLabels = (row) => String(row?.diplomes || '').split(',').filter((d) => Object.hasOwn(DIPLOMES, d)).map((d) => DIPLOMES[d]);

// État d'une fiche : 'invite' (lien envoyé ou à envoyer, rien rempli), 'photo' (formulaire rempli, photo manquante),
// 'complet'. 'archive' prime.
export function educateurStatus(row) {
  if (row.archived_at) return 'archive';
  if (!row.submitted_at) return 'invite';
  return row.photo_uploaded_at ? 'complet' : 'photo';
}
export const STATUS_LABELS = { invite: 'À remplir', photo: 'Photo manquante', complet: 'Complète', archive: 'Retiré' };

// ---------- Fiches (organisation de la session ou du domaine, jamais du navigateur) ----------
export async function createEducateur(db, organizationId, { prenom, nom, email, role, categories }) {
  await ensureEducateursTables(db);
  const result = await db
    .prepare('INSERT INTO educateurs (organization_id, prenom, nom, email, role, categories) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(organizationId, prenom, nom, email, role, categories || null)
    .run();
  return getEducateur(db, organizationId, result.meta.last_row_id);
}

export async function getEducateur(db, organizationId, id) {
  if (!Number.isInteger(id) || id < 1) return null;
  await ensureEducateursTables(db);
  return db.prepare('SELECT * FROM educateurs WHERE organization_id = ? AND id = ?').bind(organizationId, id).first();
}

export async function listEducateurs(db, organizationId, { archived = false } = {}) {
  await ensureEducateursTables(db);
  const { results } = await db
    .prepare(`SELECT * FROM educateurs WHERE organization_id = ? AND archived_at IS ${archived ? 'NOT ' : ''}NULL ORDER BY nom COLLATE NOCASE, prenom COLLATE NOCASE`)
    .bind(organizationId)
    .all();
  return results;
}

export async function findActiveByEmail(db, organizationId, email) {
  await ensureEducateursTables(db);
  return db
    .prepare('SELECT id FROM educateurs WHERE organization_id = ? AND archived_at IS NULL AND lower(email) = lower(?)')
    .bind(organizationId, email)
    .first();
}

// Enregistrement du formulaire de l'éducateur. submitted_at garde la date du premier envoi.
export async function saveEducateurForm(db, row, values) {
  const columns = Object.keys(values);
  const assignments = columns.map((c) => `${c} = ?`).join(', ');
  await db
    .prepare(
      `UPDATE educateurs SET ${assignments}, updated_at = datetime('now'), submitted_at = COALESCE(submitted_at, datetime('now'))
       WHERE organization_id = ? AND id = ?`
    )
    .bind(...columns.map((c) => values[c]), row.organization_id, row.id)
    .run();
  return getEducateur(db, row.organization_id, row.id);
}

// Champs gérés par le club (fiche admin).
export async function updateClubFields(db, organizationId, id, { prenom, nom, email, role, categories, numero_licence }) {
  await db
    .prepare("UPDATE educateurs SET prenom = ?, nom = ?, email = ?, role = ?, categories = ?, numero_licence = ?, updated_at = datetime('now') WHERE organization_id = ? AND id = ?")
    .bind(prenom, nom, email, role, categories || null, numero_licence || null, organizationId, id)
    .run();
}

export async function setNote(db, organizationId, id, note) {
  await db.prepare('UPDATE educateurs SET note_interne = ? WHERE organization_id = ? AND id = ?').bind(note || null, organizationId, id).run();
}

export async function setArchived(db, organizationId, id, archived) {
  await db
    .prepare(`UPDATE educateurs SET archived_at = ${archived ? "datetime('now')" : 'NULL'} WHERE organization_id = ? AND id = ?`)
    .bind(organizationId, id)
    .run();
  if (archived) await revokeEducateurLinks(db, organizationId, id);
}

// ---------- Liens ----------
export async function issueEducateurLink(db, organizationId, educateurId, now = Date.now()) {
  await ensureEducateursTables(db);
  const token = `e${randomToken(32)}`;
  await db.batch([
    db
      .prepare('INSERT INTO educateur_links (organization_id, educateur_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(organizationId, educateurId, await sha256Hex(token), sqlNow(now), sqlNow(now + LINK_DAYS * 86_400_000)),
  ]);
  return token;
}

export async function markEducateurLinkSent(db, organizationId, educateurId) {
  await db.prepare("UPDATE educateurs SET link_sent_at = datetime('now') WHERE organization_id = ? AND id = ?").bind(organizationId, educateurId).run();
}

export const educateurUrl = (siteUrl, token, hash = '') => `${siteUrl}/educateur/${token}${hash}`;

// { status: 'ok' | 'expired' | 'unknown', row } ; une fiche retirée (archivée) = 'expired'.
export async function resolveEducateurToken(db, organizationId, token, now = Date.now()) {
  if (!isEducateurTokenShape(token)) return { status: 'unknown', row: null };
  await ensureEducateursTables(db);
  const link = await db
    .prepare('SELECT educateur_id, expires_at, revoked_at FROM educateur_links WHERE organization_id = ? AND token_hash = ?')
    .bind(organizationId, await sha256Hex(token))
    .first();
  if (!link) return { status: 'unknown', row: null };
  const row = await getEducateur(db, organizationId, link.educateur_id);
  if (!row) return { status: 'unknown', row: null };
  const valid = !link.revoked_at && link.expires_at > sqlNow(now) && !row.archived_at;
  return { status: valid ? 'ok' : 'expired', row };
}

export async function revokeEducateurLinks(db, organizationId, educateurId, now = Date.now()) {
  await ensureEducateursTables(db);
  await db
    .prepare('UPDATE educateur_links SET revoked_at = ? WHERE organization_id = ? AND educateur_id = ? AND revoked_at IS NULL')
    .bind(sqlNow(now), organizationId, educateurId)
    .run();
}

export async function activeEducateurLinks(db, organizationId, educateurId, now = Date.now()) {
  await ensureEducateursTables(db);
  const row = await db
    .prepare('SELECT COUNT(*) AS n, MAX(expires_at) AS until FROM educateur_links WHERE organization_id = ? AND educateur_id = ? AND revoked_at IS NULL AND expires_at > ?')
    .bind(organizationId, educateurId, sqlNow(now))
    .first();
  return { count: row?.n || 0, until: row?.until || null };
}

// ---------- Liens d'invitation de groupe ----------
export const INVITE_DAYS = Object.freeze([3, 7, 14, 30]);
export const INVITE_DEFAULT_DAYS = 7;
export const INVITE_MAX_USES = 100;
const INVITE_RE = /^j[A-Za-z0-9_-]{43}$/;
export const isInviteTokenShape = (token) => typeof token === 'string' && INVITE_RE.test(token);
export const inviteUrl = (siteUrl, token) => `${siteUrl}/educateur/rejoindre/${token}`;

export async function createInvite(db, organizationId, { role, days = INVITE_DEFAULT_DAYS, maxUses = 20 }, now = Date.now()) {
  await ensureEducateursTables(db);
  const token = `j${randomToken(32)}`;
  await db
    .prepare('INSERT INTO educateur_invites (organization_id, token_hash, role, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(organizationId, await sha256Hex(token), role, sqlNow(now), sqlNow(now + days * 86_400_000), maxUses)
    .run();
  return token;
}

// Liens encore valables (non révoqués, non expirés, places restantes), plus récents d'abord.
export async function listActiveInvites(db, organizationId, now = Date.now()) {
  await ensureEducateursTables(db);
  const { results } = await db
    .prepare('SELECT id, role, created_at, expires_at, max_uses, uses FROM educateur_invites WHERE organization_id = ? AND revoked_at IS NULL AND expires_at > ? AND uses < max_uses ORDER BY id DESC')
    .bind(organizationId, sqlNow(now))
    .all();
  return results;
}

export async function revokeInvite(db, organizationId, id, now = Date.now()) {
  await ensureEducateursTables(db);
  await db.prepare('UPDATE educateur_invites SET revoked_at = ? WHERE organization_id = ? AND id = ? AND revoked_at IS NULL').bind(sqlNow(now), organizationId, id).run();
}

// { status: 'ok' | 'expired' | 'unknown', invite } ; places épuisées = 'expired'.
export async function resolveInvite(db, organizationId, token, now = Date.now()) {
  if (!isInviteTokenShape(token)) return { status: 'unknown', invite: null };
  await ensureEducateursTables(db);
  const invite = await db
    .prepare('SELECT * FROM educateur_invites WHERE organization_id = ? AND token_hash = ?')
    .bind(organizationId, await sha256Hex(token))
    .first();
  if (!invite) return { status: 'unknown', invite: null };
  const valid = !invite.revoked_at && invite.expires_at > sqlNow(now) && invite.uses < invite.max_uses;
  return { status: valid ? 'ok' : 'expired', invite };
}

// Une place prise et la fiche créée dans la même transaction : la fiche n'est insérée que si la place a pu être prise
// (lien encore valable, places restantes), même sous envois simultanés. Renvoie la fiche ou null.
export async function joinWithInvite(db, invite, { prenom, nom, email }, now = Date.now()) {
  const [, inserted] = await db.batch([
    db
      .prepare('UPDATE educateur_invites SET uses = uses + 1 WHERE organization_id = ? AND id = ? AND revoked_at IS NULL AND expires_at > ? AND uses < max_uses')
      .bind(invite.organization_id, invite.id, sqlNow(now)),
    db
      .prepare('INSERT INTO educateurs (organization_id, prenom, nom, email, role, invite_id) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1')
      .bind(invite.organization_id, prenom, nom, email, invite.role, invite.id),
  ]);
  if (!inserted?.meta?.changes) return null;
  return getEducateur(db, invite.organization_id, inserted.meta.last_row_id);
}

// Pages /educateur/<lien> : organisation du domaine, puis lien.
export async function loadEducateurAccess(request, env, token) {
  const { resolveOrganization } = await import('./organization.js');
  const organization = await resolveOrganization(request, env);
  if (!organization) return { status: 'unknown', row: null, organization: null };
  return { ...(await resolveEducateurToken(env.DB, organization.id, token)), organization };
}

// ---------- Photo ----------
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_MAX = 10 * 1024 * 1024;
const PHOTO_ERRORS = {
  empty: 'Choisissez une photo avant d’envoyer.',
  too_large: 'La photo dépasse 10 Mo : réessayez avec une photo moins lourde.',
  bad_type: 'Format non accepté : envoyez une photo JPG, PNG ou WebP.',
};

// Clé R2 aléatoire, conservée en base : un identifiant de fiche ne permet pas de deviner l'emplacement du fichier.
export async function storeEducateurPhoto(env, row, file, waitUntil) {
  if (!env.DOSSIERS) return { error: "L'envoi de photo n'est pas encore activé : envoyez-la par e-mail au club." };
  const upload = await readUpload(file, { allowedTypes: PHOTO_TYPES, maxSize: PHOTO_MAX });
  if (upload.error) return { error: PHOTO_ERRORS[upload.error] };
  const key = row.photo_key || `educateurs/${row.id}-${randomToken(12)}`;
  await env.DOSSIERS.put(key, upload.buffer, { httpMetadata: { contentType: upload.type } });
  await env.DB.prepare("UPDATE educateurs SET photo_key = ?, photo_content_type = ?, photo_uploaded_at = datetime('now') WHERE organization_id = ? AND id = ?")
    .bind(key, upload.type, row.organization_id, row.id)
    .run();
  backupCopy(env, key, upload, waitUntil);
  return {};
}

export async function educateurPhotoResponse(env, row) {
  if (!row?.photo_key || !env.DOSSIERS) return new Response('Aucune photo.', { status: 404 });
  const object = await env.DOSSIERS.get(row.photo_key);
  if (!object) return new Response('Photo introuvable.', { status: 404 });
  return new Response(object.body, {
    headers: { 'Content-Type': row.photo_content_type || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

// Suppression définitive (fiche retirée seulement) : photo dans les deux buckets d'abord, puis liens et fiche.
// Échec sur un bucket = rien d'effacé en base (on peut réessayer).
export async function deleteEducateurPermanently(env, organizationId, id) {
  const row = await getEducateur(env.DB, organizationId, id);
  if (!row) return { error: 'introuvable' };
  if (!row.archived_at) return { error: 'actif' };
  if (row.photo_key) {
    try {
      if (env.DOSSIERS) await env.DOSSIERS.delete(row.photo_key);
      if (env.DOSSIERS_BACKUP) await env.DOSSIERS_BACKUP.delete(row.photo_key);
    } catch {
      return { error: 'fichiers' };
    }
  }
  await env.DB.batch([
    // Journal des e-mails : adresse et objet effacés pour les e-mails éducateur partis à cette adresse.
    env.DB.prepare("UPDATE email_log SET recipients = NULL, subject = NULL, error = NULL, message_id = NULL WHERE organization_id = ? AND kind = 'educateur_lien' AND lower(recipients) = lower(?)").bind(organizationId, row.email),
    env.DB.prepare('DELETE FROM educateur_links WHERE organization_id = ? AND educateur_id = ?').bind(organizationId, id),
    env.DB.prepare('DELETE FROM educateurs WHERE organization_id = ? AND id = ?').bind(organizationId, id),
  ]);
  return {};
}
