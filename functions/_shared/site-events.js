// Mesure d'audience du site, rattachée à une organisation (R0a, 2026-09-28) : clics envoyés par le navigateur
// (functions/api/track-event.js ; Cloudflare Zaraz retiré le 2026-10-16), affichés dans /admin/events. Aucune donnée personnelle : type d'événement, route de
// la page, date.
//
// Remplace la table globale `events` (sans organisation) : chaque organisation connectée y lisait les compteurs et les
// chemins de toutes les autres, et n'importe qui pouvait y écrire le texte de son choix.
//   - Ancienne table `events` : ni lue, ni modifiée, ni recréée, ni ajoutée à TENANT_TABLES (repairSchemaInvariants
//     attribuerait sinon ses lignes à Sportville, sans preuve : l'écriture y était publique). Ses lignes sont
//     « legacy inconnues », exclues de toute vue d'organisation ; leur purge est une décision à part.
//   - Table hors séquence de migrations (règle ADR-012) : créée par ce module, comme rate_limits, pour ne consommer
//     aucun numéro (13 est réservé à la phase 4E.1). Une migration d'adoption la redéclarera à l'identique plus tard.
import { internalPathReason } from './internal-paths.js';
import { loadPublishedSite } from './site-config.js';

// Événements acceptés : ceux que le moteur de site émet réellement (renderer/blocks.js : data-track-event).
export const SITE_EVENT_TYPES = Object.freeze({
  phone_click: Object.freeze({ label: 'Clic sur le numéro de téléphone', icon: 'phone' }),
  contact_form_submit: Object.freeze({ label: 'Soumission du formulaire de contact', icon: 'mail' }),
});
export const isSiteEventType = (value) => typeof value === 'string' && Object.hasOwn(SITE_EVENT_TYPES, value);

// Limites d'écriture : un visiteur (empreinte d'IP) par organisation, puis un plafond quotidien par organisation, qui
// borne le remplissage de D1 quel que soit le nombre d'adresses utilisées. Usage légitime : quelques clics par jour.
export const SITE_EVENT_LIMITS = Object.freeze({
  client: Object.freeze({ limit: 30, windowSeconds: 600 }),
  organization: Object.freeze({ limit: 500, windowSeconds: 86_400 }),
});

export const SITE_EVENTS_TABLE = `CREATE TABLE IF NOT EXISTS site_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        event TEXT NOT NULL CHECK (length(event) BETWEEN 1 AND 64),
        page TEXT CHECK (page IS NULL OR (length(page) BETWEEN 1 AND 200 AND substr(page, 1, 1) = '/'))
      )`;
const SITE_EVENTS_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_site_events_org_id ON site_events (organization_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_site_events_org_event ON site_events (organization_id, event)',
];

// Création gardée par base (WeakMap) : une fois par binding D1 en production, une fois par base dans les tests.
const ready = new WeakMap();
export function ensureSiteEventsTable(db) {
  if (!ready.has(db)) {
    ready.set(
      db,
      db.batch([db.prepare(SITE_EVENTS_TABLE), ...SITE_EVENTS_INDEXES.map((sql) => db.prepare(sql))]).catch((error) => {
        ready.delete(db);
        throw error;
      })
    );
  }
  return ready.get(db);
}

// Page envoyée par le client : jamais prise telle quelle.
//   - absente ou vide : événement compté sans page ;
//   - sinon, un chemin simple : commence par un seul « / », uniquement lettres, chiffres, « - . _ ~ / » (donc ni schéma,
//     ni hôte, ni requête, ni fragment, ni encodage, ni espace, ni caractère de contrôle), 200 caractères au plus, sans
//     segment « . » ou « .. », hors des chemins internes et des espaces sensibles (admin, API, pages à jeton).
// Résultat : { ok: true, path } ou { ok: false }.
const PAGE_SYNTAX = /^\/[A-Za-z0-9._~/-]*$/;
const SENSITIVE_ROOTS = new Set(['admin', 'api', 'depot', 'reinscription', 'auth', 'callback']);
export const MAX_PAGE_LENGTH = 200;

export function parsePage(value) {
  if (value === undefined || value === null || value === '') return { ok: true, path: null };
  if (typeof value !== 'string' || value.length > MAX_PAGE_LENGTH || !PAGE_SYNTAX.test(value) || value.startsWith('//')) {
    return { ok: false };
  }
  const segments = value.split('/').slice(1);
  if (segments.some((segment) => segment === '.' || segment === '..')) return { ok: false };
  if (SENSITIVE_ROOTS.has(segments[0].toLowerCase()) || internalPathReason(value) !== null) return { ok: false };
  return { ok: true, path: value };
}

// Page enregistrée : DÉRIVÉE côté serveur. Le chemin reçu ne sert qu'à choisir une route de la version PUBLIÉE du site
// de cette organisation ; c'est la route de la configuration qui est stockée. Chemin hors des routes publiées (ou site
// sans version publiée) : null, l'événement est compté sans page. Aucun texte libre n'atteint donc l'admin.
export async function publishedRoute(env, organizationId, path) {
  if (!path) return null;
  const site = (await loadPublishedSite(env, organizationId))?.config;
  const pages = Array.isArray(site?.pages) ? site.pages.filter((p) => p && p.id !== site.notFoundPage) : [];
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const page = pages.find((p) => p.route === trimmed || (p.file && `/${p.file}` === path));
  const route = page?.route;
  return typeof route === 'string' && route.startsWith('/') && route.length <= MAX_PAGE_LENGTH ? route : null;
}
