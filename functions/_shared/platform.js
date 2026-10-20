// Console plateforme (phase 6, première version, 2026-10-20) : l'éditeur de Licyo crée et gère les clubs clients.
//
// Administrateurs de la plateforme : comptes dont l'adresse figure dans la variable Cloudflare PLATFORM_ADMIN_EMAILS
// (liste séparée par des virgules), connectés à l'espace admin de n'importe quel club. Ce n'est pas un rôle de club :
// la console ne donne aucun accès aux données des adhérents d'un club (ni inscriptions, ni familles), seulement à la
// fiche « commerciale et technique » des clubs (nom, statut, domaines, nombre de comptes).
//
// Créer un club = une organisation, ses domaines, son profil sportif, et l'invitation de son premier responsable
// (lien de 7 jours sur le domaine du club). Le site public du club n'existe pas tant qu'aucune configuration n'est
// publiée pour lui : son domaine répond par une page neutre, l'admin fonctionne déjà.
import { normalizeEmail, inviteMember, findUserByEmail, AccountError } from './accounts.js';
import { setSportProfile, SPORT_KEYS } from './sport-profile.js';
import { randomToken } from './security.js';

export function platformAdminEmails(env) {
  return String(env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
}

export const isPlatformAdmin = (env, email) => Boolean(email) && platformAdminEmails(env).includes(String(email).toLowerCase());

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
export const ORGANIZATION_STATUSES = { active: 'Actif', suspended: 'Suspendu' };

export function slugify(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function normalizeDomain(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return DOMAIN_RE.test(domain) ? domain : null;
}

export async function listOrganizations(db) {
  const { results } = await db
    .prepare(
      `SELECT o.id, o.slug, o.name, o.status, o.created_at,
              (SELECT group_concat(d.domain, ', ') FROM organization_domains d WHERE d.organization_id = o.id) AS domains,
              (SELECT COUNT(*) FROM organization_memberships m WHERE m.organization_id = o.id AND m.status = 'active') AS members,
              (SELECT COUNT(*) FROM organization_memberships m WHERE m.organization_id = o.id AND m.status = 'invited') AS invited
       FROM organizations o /* toutes-organisations */ ORDER BY o.created_at, o.id`
    )
    .all();
  return results;
}

// Crée un club et invite son premier responsable. Renvoie { organizationId, token, ownerEmail, domain }.
export async function createOrganization(env, { name, slug, domain, sport, ownerEmail, actorUserId }) {
  const db = env.DB;
  const cleanName = String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (cleanName.length < 2 || cleanName.length > 100) throw new AccountError('name', 'Nom du club : 2 à 100 caractères.');
  const finalSlug = slug ? String(slug).trim().toLowerCase() : slugify(cleanName);
  if (!SLUG_RE.test(finalSlug)) throw new AccountError('slug', 'Identifiant court : lettres minuscules, chiffres et tirets.');
  const finalDomain = normalizeDomain(domain);
  if (!finalDomain) throw new AccountError('domain', 'Domaine invalide (ex. monclub.licyo.fr ou www.monclub.fr).');
  const email = normalizeEmail(ownerEmail);
  if (!email) throw new AccountError('email', 'Adresse du responsable invalide.');
  if (sport && !SPORT_KEYS.includes(sport)) throw new AccountError('sport', 'Sport inconnu.');
  if (await db.prepare('SELECT 1 FROM organizations WHERE slug = ?').bind(finalSlug).first()) throw new AccountError('slug', 'Cet identifiant est déjà pris.');
  if (await db.prepare('SELECT 1 FROM organization_domains WHERE domain = ?').bind(finalDomain).first()) throw new AccountError('domain', 'Ce domaine est déjà rattaché à un club.');

  const organizationId = `org_${randomToken(12).replace(/[^A-Za-z0-9]/g, '').slice(0, 14).toLowerCase()}`;
  await db.batch([
    db.prepare("INSERT INTO organizations (id, slug, name, type, status) VALUES (?, ?, ?, 'sports_club', 'active')").bind(organizationId, finalSlug, cleanName),
    db.prepare('INSERT INTO organization_domains (domain, organization_id) VALUES (?, ?)').bind(finalDomain, organizationId),
  ]);
  if (sport) await setSportProfile(env, organizationId, { sport });
  // Invitation au rôle de responsable du club : l'acteur est la plateforme (droit de nommer un responsable).
  const { token, existing } = await inviteMember(db, organizationId, { email, role: 'owner', actor: { userId: actorUserId, role: 'owner' } });
  return { organizationId, slug: finalSlug, token, existing, ownerEmail: email, domain: finalDomain, name: cleanName };
}

export async function setOrganizationStatus(db, organizationId, status) {
  if (!ORGANIZATION_STATUSES[status]) throw new AccountError('status', 'Statut inconnu.');
  const result = await db
    .prepare("UPDATE organizations /* toutes-organisations */ SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, organizationId)
    .run();
  if (!result.meta?.changes) throw new AccountError('missing', 'Club introuvable.');
}

export async function addDomain(db, organizationId, domain) {
  const finalDomain = normalizeDomain(domain);
  if (!finalDomain) throw new AccountError('domain', 'Domaine invalide.');
  if (await db.prepare('SELECT 1 FROM organization_domains WHERE domain = ?').bind(finalDomain).first()) throw new AccountError('domain', 'Ce domaine est déjà rattaché à un club.');
  if (!(await db.prepare('SELECT 1 FROM organizations WHERE id = ?').bind(organizationId).first())) throw new AccountError('missing', 'Club introuvable.');
  await db.prepare('INSERT INTO organization_domains (domain, organization_id) VALUES (?, ?)').bind(finalDomain, organizationId).run();
  return finalDomain;
}

export { findUserByEmail };
