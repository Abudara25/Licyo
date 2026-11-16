// Données de la console fondateur (lot 2 Licyo) : les clubs vus par l'équipe Licyo. Requêtes volontairement
// transversales (toutes organisations), marquées /* toutes-organisations */ pour la relecture (tenant-scoping.test).
// Aucune donnée personnelle d'adhérent n'est lue ici : seulement des compteurs, les domaines et les comptes du bureau.
import { ensureSchema } from './inscriptions-db.js';
import { createInvite, AdminUserError } from './admin-users.js';
import { clearOrganizationCache } from './organization.js';
import { audit, PlatformError, normalizeEmail, isEmail } from './platform-auth.js';

// Sports ciblés par Licyo : sports collectifs et sports de combat (décision du 2026-11-15). Couleur du logo à initiales.
export const SPORTS = Object.freeze({
  football: { label: 'Football', color: '#15803d' },
  futsal: { label: 'Futsal', color: '#0f766e' },
  basketball: { label: 'Basket-ball', color: '#c2410c' },
  handball: { label: 'Handball', color: '#1d4ed8' },
  volleyball: { label: 'Volley-ball', color: '#a16207' },
  rugby: { label: 'Rugby', color: '#7c2d12' },
  hockey: { label: 'Hockey', color: '#0e7490' },
  boxe: { label: 'Boxe', color: '#b91c1c' },
  muaythai: { label: 'Muay thaï', color: '#9f1239' },
  kickboxing: { label: 'Kick-boxing', color: '#be123c' },
  judo: { label: 'Judo', color: '#4338ca' },
  karate: { label: 'Karaté', color: '#6d28d9' },
  taekwondo: { label: 'Taekwondo', color: '#7e22ce' },
  mma: { label: 'MMA', color: '#334155' },
  autre: { label: 'Autre sport', color: '#475467' },
});
export const sportLabel = (key) => SPORTS[key]?.label ?? 'Sport à préciser';
export const sportColor = (key) => SPORTS[key]?.color ?? '#98a2b3';

export const ORG_STATUS = Object.freeze({
  active: { label: 'En service', tone: 'success' },
  suspended: { label: 'Suspendu', tone: 'danger' },
});
export const orgStatus = (status) => ORG_STATUS[status] ?? { label: status || 'Inconnu', tone: 'neutral' };

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const normalizeHost = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

export const slugify = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

// --- Lecture -------------------------------------------------------------------------------------------------

// Toutes les organisations avec leurs compteurs : domaines, adhérents en cours, comptes du bureau, invitations.
export async function listOrganizations(db) {
  await ensureSchema(db);
  const { results } = await db
    .prepare(
      `SELECT o.id, o.slug, o.name, o.status, o.sport, o.email, o.created_at,
         (SELECT d.domain FROM organization_domains d WHERE d.organization_id = o.id ORDER BY length(d.domain), d.domain LIMIT 1) AS domain,
         (SELECT COUNT(*) FROM organization_domains d WHERE d.organization_id = o.id) AS domains,
         (SELECT COUNT(*) FROM inscriptions i WHERE i.organization_id = o.id AND i.archived_at IS NULL) AS members,
         (SELECT COUNT(*) FROM admin_users u WHERE u.organization_id = o.id AND u.status = 'active') AS accounts,
         (SELECT COUNT(*) FROM admin_users u WHERE u.organization_id = o.id AND u.status = 'active' AND u.role = 'president') AS presidents,
         (SELECT COUNT(*) FROM admin_user_invites v WHERE v.organization_id = o.id AND v.used_at IS NULL AND v.revoked_at IS NULL AND v.expires_at > datetime('now')) AS invites
       FROM organizations o /* toutes-organisations */
       ORDER BY o.name COLLATE NOCASE`
    )
    .all();
  return results.map((o) => ({ ...o, issue: organizationIssue(o) }));
}

// Signal « à traiter » d'un club, du plus urgent au moins urgent (rank).
export function organizationIssue(o) {
  if (o.status === 'suspended') return { rank: 1, tone: 'danger', label: 'Club suspendu : site et espace admin fermés' };
  if (!o.domains) return { rank: 2, tone: 'warning', label: 'Aucun domaine : le site n’est pas joignable' };
  if (!o.presidents && o.invites) return { rank: 3, tone: 'violet', label: 'Accès du président envoyé, pas encore activé' };
  if (!o.presidents) return { rank: 4, tone: 'warning', label: 'Aucun compte président : envoyer l’accès' };
  return null;
}

export async function getOrganization(db, id) {
  const all = await listOrganizations(db);
  const org = all.find((o) => o.id === id);
  if (!org) return null;
  const [domains, accounts, invites] = await Promise.all([
    db.prepare('SELECT domain, created_at FROM organization_domains WHERE organization_id = ? ORDER BY created_at').bind(id).all(),
    db.prepare('SELECT id, name, email, role, status, last_login_at FROM admin_users WHERE organization_id = ? ORDER BY status, name COLLATE NOCASE').bind(id).all(),
    db
      .prepare("SELECT id, name, email, role, expires_at FROM admin_user_invites WHERE organization_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC")
      .bind(id)
      .all(),
  ]);
  return { ...org, domainList: domains.results, accountList: accounts.results, inviteList: invites.results };
}

export async function listDomains(db) {
  await ensureSchema(db);
  return (
    await db
      .prepare(
        `SELECT d.domain, d.created_at, o.id AS organization_id, o.name, o.status FROM organization_domains d
         JOIN organizations o ON o.id = d.organization_id ORDER BY o.name COLLATE NOCASE, d.domain`
      )
      .all()
  ).results;
}

// --- Écriture ------------------------------------------------------------------------------------------------

async function assertHostFree(db, host) {
  if (!HOST_RE.test(host)) throw new PlatformError('Domaine invalide (exemple : www.monclub.fr).');
  if (await db.prepare('SELECT 1 FROM organization_domains WHERE domain = ?').bind(host).first()) throw new PlatformError(`Le domaine ${host} est déjà attribué à un club.`);
}

// Crée un club : organisation, domaine, puis invitation du président (lien sur le domaine du club). Le site public du
// club reprend la configuration de référence tant que le club ne l'a pas personnalisée.
export async function createOrganization(env, actor, input, { origin = 'https' } = {}) {
  const db = env.DB;
  await ensureSchema(db);
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) throw new PlatformError('Indiquez le nom du club (2 à 120 caractères).');
  const slug = slugify(input.slug || name);
  if (!SLUG_RE.test(slug)) throw new PlatformError('Identifiant court invalide (lettres, chiffres et tirets, 3 à 48 caractères).');
  const sport = SPORTS[input.sport] ? input.sport : null;
  if (!sport) throw new PlatformError('Choisissez le sport du club.');
  const host = normalizeHost(input.domain);
  await assertHostFree(db, host);
  const email = normalizeEmail(input.email);
  if (email && !isEmail(email)) throw new PlatformError('Adresse e-mail du club invalide.');
  if (await db.prepare('SELECT 1 FROM organizations WHERE slug = ?').bind(slug).first()) throw new PlatformError('Cet identifiant court est déjà pris.');
  const president = { name: String(input.presidentName || '').trim(), email: normalizeEmail(input.presidentEmail), role: 'president' };
  if (!president.name || !isEmail(president.email)) throw new PlatformError('Indiquez le nom et l’adresse e-mail du président.');

  const id = `org_${crypto.randomUUID().replaceAll('-', '')}`; // identifiant opaque et stable (le slug peut changer)
  await db.batch([
    db.prepare("INSERT INTO organizations (id, slug, name, type, status, email, sport) VALUES (?, ?, ?, 'sports_club', 'active', ?, ?)").bind(id, slug, name, email || null, sport),
    db.prepare('INSERT INTO organization_domains (domain, organization_id) VALUES (?, ?)').bind(host, id),
  ]);
  clearOrganizationCache();
  await audit(db, actor, 'org.create', id, { name, domain: host, sport });
  const invite = await invitePresident(env, actor, id, president, { origin });
  return { id, slug, host, invite };
}

export async function setOrganizationStatus(env, actor, id, status) {
  if (!ORG_STATUS[status]) throw new PlatformError('Statut inconnu.');
  const org = await env.DB.prepare('SELECT id, status FROM organizations WHERE id = ?').bind(id).first();
  if (!org) throw new PlatformError('Club introuvable.');
  if (org.status === status) return;
  const statements = [env.DB.prepare("UPDATE organizations SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, id)];
  // Suspendre ferme aussitôt les connexions du bureau (l'admin refuse déjà les organisations non actives).
  if (status === 'suspended') statements.push(env.DB.prepare('DELETE FROM admin_sessions WHERE organization_id = ?').bind(id));
  await env.DB.batch(statements);
  clearOrganizationCache();
  await audit(env.DB, actor, status === 'suspended' ? 'org.suspend' : 'org.reactivate', id);
}

export async function addDomain(env, actor, id, value) {
  const host = normalizeHost(value);
  if (!(await env.DB.prepare('SELECT 1 FROM organizations WHERE id = ?').bind(id).first())) throw new PlatformError('Club introuvable.');
  await assertHostFree(env.DB, host);
  await env.DB.prepare('INSERT INTO organization_domains (domain, organization_id) VALUES (?, ?)').bind(host, id).run();
  clearOrganizationCache();
  await audit(env.DB, actor, 'org.domain_add', id, { domain: host });
  return host;
}

export async function removeDomain(env, actor, id, host) {
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM organization_domains WHERE organization_id = ?').bind(id).first();
  if (n <= 1) throw new PlatformError('Un club garde au moins un domaine : ajoutez-en un autre avant de retirer celui-ci.');
  await env.DB.prepare('DELETE FROM organization_domains WHERE organization_id = ? AND domain = ?').bind(id, host).run();
  clearOrganizationCache();
  await audit(env.DB, actor, 'org.domain_remove', id, { domain: host });
}

// Accès du président : invitation de compte du bureau (lot 1), dont le lien s'ouvre sur le domaine du club.
export async function invitePresident(env, actor, id, { name, email }, { origin = 'https' } = {}) {
  const domain = await env.DB.prepare('SELECT domain FROM organization_domains WHERE organization_id = ? ORDER BY length(domain), domain LIMIT 1').bind(id).first();
  if (!domain) throw new PlatformError('Ajoutez d’abord un domaine au club.');
  try {
    const invite = await createInvite(env.DB, id, { name, email, role: 'president' }, { invitedBy: null });
    await audit(env.DB, actor, 'org.president_invite', id, { email: invite.email });
    const scheme = origin === 'http' ? 'http' : 'https';
    return { ...invite, url: `${scheme}://${domain.domain}/admin/invitation/${invite.token}` };
  } catch (error) {
    if (error instanceof AdminUserError) throw new PlatformError(error.message);
    throw error;
  }
}

export async function platformCounts(db) {
  const orgs = await listOrganizations(db);
  return { orgs, attention: orgs.filter((o) => o.issue).sort((a, b) => a.issue.rank - b.issue.rank || a.name.localeCompare(b.name)) };
}
