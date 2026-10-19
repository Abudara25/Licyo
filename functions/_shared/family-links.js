// Liens de l'espace famille (/depot/<lien>) à durée limitée (2026-10-16, après l'audit de sécurité) :
//   - chaque e-mail ou PDF reçoit un lien neuf, valable FAMILY_LINK_DAYS jours ; seule l'empreinte SHA-256 du lien est
//     enregistrée (table family_links), jamais le lien lui-même ;
//   - les anciens liens (le jeton interne upload_token, envoyé avant cette version) restent valables jusqu'au
//     LEGACY_LINKS_UNTIL, choix de l'utilisateur (« expirent dans 30 jours ») ; upload_token n'est pas modifié : il
//     reste l'identifiant interne des fichiers R2 (dossiers/<upload_token>, photos/<upload_token>) ;
//   - « Révoquer les liens » (fiche admin) coupe d'un coup tous les liens d'une fiche, anciens compris ;
//   - un lien expiré ou révoqué permet seulement de demander un nouveau lien, envoyé aux adresses enregistrées sur la
//     fiche (jamais affiché), au plus RENEW_LIMIT fois par heure et par fiche.
// Table hors séquence de migrations (comme site_events), additive : rien d'existant n'est modifié.
import { sha256Hex, randomToken } from './security.js';

export const FAMILY_LINK_DAYS = 30;
// Mise en ligne prévue le 2026-10-16 : anciens liens valables 30 jours de plus.
export const LEGACY_LINKS_UNTIL = '2026-11-16 00:00:00';
export const RENEW_LIMIT = Object.freeze({ limit: 1, windowSeconds: 3600 });

// Jeton d'un lien neuf : « f » + 43 caractères base64url (256 bits). Les anciens liens sont des UUID.
const NEW_TOKEN_RE = /^f[A-Za-z0-9_-]{43}$/;
const LEGACY_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isFamilyTokenShape = (token) => typeof token === 'string' && (NEW_TOKEN_RE.test(token) || LEGACY_TOKEN_RE.test(token));

const FAMILY_LINKS_TABLE = `CREATE TABLE IF NOT EXISTS family_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        inscription_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      )`;
const FAMILY_LINKS_INDEXES = ['CREATE INDEX IF NOT EXISTS idx_family_links_org_inscription ON family_links (organization_id, inscription_id)'];

const ready = new WeakMap();
export function ensureFamilyLinksTable(db) {
  if (!ready.has(db)) {
    ready.set(
      db,
      (async () => {
        await db.batch([db.prepare(FAMILY_LINKS_TABLE), ...FAMILY_LINKS_INDEXES.map((sql) => db.prepare(sql))]);
        // Révocation des anciens liens d'une fiche : colonne additive, NULL pour toutes les fiches existantes.
        const { results } = await db.prepare('PRAGMA table_info(inscriptions)').all();
        // Fin de validité du lien de réinscription : NULL pour les liens déjà envoyés (valables jusqu'à LEGACY_LINKS_UNTIL).
        for (const column of ['family_links_revoked_at', 'reinscription_token_expires_at']) {
          if (results.some((c) => c.name === column)) continue;
          await db.prepare(`ALTER TABLE inscriptions ADD COLUMN ${column} TEXT`).run().catch((error) => {
            if (!/duplicate column/i.test(String(error?.message))) throw error;
          });
        }
      })().catch((error) => {
        ready.delete(db);
        throw error;
      })
    );
  }
  return ready.get(db);
}

const sqlNow = (now) => new Date(now).toISOString().slice(0, 19).replace('T', ' ');

// Nouveau lien pour une fiche : renvoie le jeton (à mettre dans l'URL), jamais conservé en clair.
export async function issueFamilyLink(db, organizationId, inscriptionId, now = Date.now()) {
  await ensureFamilyLinksTable(db);
  const token = `f${randomToken(32)}`;
  const expires = sqlNow(now + FAMILY_LINK_DAYS * 86_400_000);
  await db
    .prepare('INSERT INTO family_links (organization_id, inscription_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(organizationId, inscriptionId, await sha256Hex(token), sqlNow(now), expires)
    .run();
  return token;
}

export const familyUrl = (siteUrl, token, hash = '') => `${siteUrl}/depot/${token}${hash}`;

// Lien de l'espace famille d'une fiche, pour un e-mail : un lien neuf à chaque envoi.
export async function familyUrlFor(env, row, siteUrl, hash = '') {
  return familyUrl(siteUrl, await issueFamilyLink(env.DB, row.organization_id, row.id), hash);
}

// Résout un jeton d'URL pour l'organisation du domaine.
// Renvoie { status: 'ok' | 'expired' | 'unknown', row } ; 'expired' couvre aussi les liens révoqués (même message : la
// famille demande un nouveau lien). Un jeton inconnu ne révèle rien.
export async function resolveFamilyToken(db, organizationId, token, now = Date.now()) {
  if (!isFamilyTokenShape(token)) return { status: 'unknown', row: null };
  await ensureFamilyLinksTable(db);
  const at = sqlNow(now);
  if (NEW_TOKEN_RE.test(token)) {
    const link = await db
      .prepare('SELECT inscription_id, expires_at, revoked_at FROM family_links WHERE organization_id = ? AND token_hash = ?')
      .bind(organizationId, await sha256Hex(token))
      .first();
    if (!link) return { status: 'unknown', row: null };
    const row = await db.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(organizationId, link.inscription_id).first();
    if (!row) return { status: 'unknown', row: null };
    const valid = !link.revoked_at && link.expires_at > at;
    return { status: valid ? 'ok' : 'expired', row };
  }
  const row = await db.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND upload_token = ?').bind(organizationId, token).first();
  if (!row) return { status: 'unknown', row: null };
  const valid = !row.family_links_revoked_at && at < LEGACY_LINKS_UNTIL;
  return { status: valid ? 'ok' : 'expired', row };
}

// « Révoquer les liens » : tous les liens de la fiche, neufs et anciens. Les fichiers et données ne changent pas.
export async function revokeFamilyLinks(db, organizationId, inscriptionId, now = Date.now()) {
  await ensureFamilyLinksTable(db);
  const at = sqlNow(now);
  await db.batch([
    db.prepare('UPDATE family_links SET revoked_at = ? WHERE organization_id = ? AND inscription_id = ? AND revoked_at IS NULL').bind(at, organizationId, inscriptionId),
    // Le lien de réinscription aussi : sa fin de validité passe à maintenant.
    db.prepare('UPDATE inscriptions SET family_links_revoked_at = ?, reinscription_token_expires_at = CASE WHEN reinscription_token IS NULL THEN NULL ELSE ? END WHERE organization_id = ? AND id = ?').bind(at, at, organizationId, inscriptionId),
  ]);
}

// Suppression définitive d'une fiche (RGPD) : ses liens partent avec elle.
export const familyLinksDeletionStatement = (db, organizationId, inscriptionId) =>
  db.prepare('DELETE FROM family_links WHERE organization_id = ? AND inscription_id = ?').bind(organizationId, inscriptionId);

// Liens encore valables d'une fiche (affiché sur la fiche admin).
export async function activeFamilyLinks(db, organizationId, inscriptionId, now = Date.now()) {
  await ensureFamilyLinksTable(db);
  const row = await db
    .prepare('SELECT COUNT(*) AS n, MAX(expires_at) AS until FROM family_links WHERE organization_id = ? AND inscription_id = ? AND revoked_at IS NULL AND expires_at > ?')
    .bind(organizationId, inscriptionId, sqlNow(now))
    .first();
  return { count: row?.n || 0, until: row?.until || null };
}

// Pages /depot/<lien> : organisation du domaine (résolue côté serveur), puis lien. { status, row, organization }.
export async function loadFamilyAccess(request, env, token) {
  const { resolveOrganization } = await import('./organization.js');
  const { ensureInscriptionsTable } = await import('./inscriptions-db.js');
  const organization = await resolveOrganization(request, env);
  if (!organization) return { status: 'unknown', row: null, organization: null };
  await ensureInscriptionsTable(env.DB);
  return { ...(await resolveFamilyToken(env.DB, organization.id, token)), organization };
}

// Lien de réinscription (/reinscription/<jeton>, jeton par fiche affiché au club dans /admin/reinscription) : même règle
// de durée. Chaque envoi par le club le prolonge de FAMILY_LINK_DAYS jours ; une demande de la famille depuis un lien
// expiré en crée un nouveau (l'ancien ne sert plus à rien), envoyé aux adresses de la fiche.
export function isReinscriptionLinkValid(row, now = Date.now()) {
  if (!row?.reinscription_token) return false;
  return sqlNow(now) < (row.reinscription_token_expires_at || LEGACY_LINKS_UNTIL);
}

export async function extendReinscriptionLink(db, organizationId, inscriptionId, now = Date.now()) {
  await ensureFamilyLinksTable(db);
  await db
    .prepare('UPDATE inscriptions SET reinscription_token_expires_at = ? WHERE organization_id = ? AND id = ? AND reinscription_token IS NOT NULL')
    .bind(sqlNow(now + FAMILY_LINK_DAYS * 86_400_000), organizationId, inscriptionId)
    .run();
}

export async function renewReinscriptionLink(db, organizationId, inscriptionId, now = Date.now()) {
  await ensureFamilyLinksTable(db);
  const token = crypto.randomUUID();
  await db
    .prepare('UPDATE inscriptions SET reinscription_token = ?, reinscription_token_expires_at = ? WHERE organization_id = ? AND id = ?')
    .bind(token, sqlNow(now + FAMILY_LINK_DAYS * 86_400_000), organizationId, inscriptionId)
    .run();
  return token;
}
