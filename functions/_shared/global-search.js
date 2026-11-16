// Recherche globale de l'admin (2026-11-13) : l'admin ne contient pas que des enfants. Une seule recherche renvoie,
// rangés par type, les enfants (inscriptions, toutes listes), les responsables légaux (une entrée par personne avec
// tous ses enfants), les éducateurs, les pré-inscriptions et les catégories. Lecture seule ; toujours filtrée par
// l'organisation de la session. Utilisée par /admin/recherche (page complète et suggestions pendant la frappe).
import { ensureInscriptionsTable, isInscriptionComplete, ageGroup } from './inscriptions-db.js';
import { ensurePreinscriptionsTable, listAllPreinscriptions, loadAgeContext } from './preinscriptions.js';
import { ensureEducateursTables, educateurStatus, STATUS_LABELS, ROLES } from './educateurs.js';
import { getCategoriesConfig } from './settings-kv.js';

export const SEARCH_MIN = 2;

// Minuscules, sans accents ni ponctuation : « Léa-Rose » se trouve avec « lea rose ».
export const normalize = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, ' ')
    .trim();

const digitsOf = (value) => String(value ?? '').replace(/\D/g, '');

// Tous les mots cherchés apparaissent dans les champs donnés ; ou bien 6 chiffres au moins d'un des téléphones.
export function matchText(fields, phones, query) {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return false;
  const digits = digitsOf(query);
  if (digits.length >= 6 && phones.some((t) => digitsOf(t).includes(digits))) return true;
  const haystack = normalize(fields.join(' '));
  return words.every((w) => haystack.includes(w));
}

// Une inscription ou une pré-inscription : enfant et responsables (comportement historique de « Trouver un enfant »).
export const matches = (row, query) =>
  matchText(
    [row.enfant_prenom, row.enfant_nom, row.parent_prenom, row.parent_nom, row.email, row.parent2_prenom, row.parent2_nom, row.parent2_email],
    [row.telephone, row.parent2_telephone],
    query
  );

export const SEARCH_TYPES = Object.freeze({
  enfants: 'Enfants',
  responsables: 'Responsables légaux',
  educateurs: 'Éducateurs',
  preinscriptions: 'Pré-inscriptions',
  categories: 'Catégories',
});

function inscriptionState(r) {
  if (r.archived_at) return { label: 'Corbeille', tone: 'neutral' };
  if (isInscriptionComplete(r)) return { label: 'Adhérent', tone: 'yes' };
  return { label: 'Inscription à compléter', tone: 'wait' };
}

const fullName = (prenom, nom) => `${prenom || ''} ${nom || ''}`.replace(/\s+/g, ' ').trim();
const birth = (value) => String(value || '').split('-').reverse().join('/');

// Clé d'une personne responsable : son e-mail, sinon son nom et son téléphone (homonymes séparés).
const personKey = (name, email, phone) => (email ? `e:${normalize(email)}` : `n:${normalize(name)}|${digitsOf(phone)}`);

/** Résultats par type : { enfants, responsables, educateurs, preinscriptions, categories } (listes d'objets d'affichage). */
export async function searchAll(env, organizationId, query) {
  const q = String(query || '').trim().slice(0, 100);
  const empty = Object.fromEntries(Object.keys(SEARCH_TYPES).map((k) => [k, []]));
  if (normalize(q).length < SEARCH_MIN) return empty;
  await ensureInscriptionsTable(env.DB);
  await ensurePreinscriptionsTable(env.DB);
  await ensureEducateursTables(env.DB);
  const [{ results: rows }, preinscriptions, ageCtx, { results: educateurs }, categories] = await Promise.all([
    env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ?').bind(organizationId).all(),
    listAllPreinscriptions(env.DB, organizationId),
    loadAgeContext(env, organizationId).catch(() => null),
    env.DB.prepare('SELECT * FROM educateurs WHERE organization_id = ? ORDER BY archived_at IS NOT NULL, nom COLLATE NOCASE, prenom COLLATE NOCASE').bind(organizationId).all(),
    getCategoriesConfig(env, organizationId).then((c) => c?.categories || []).catch(() => []),
  ]);

  // Fiches actives d'abord, puis la saison la plus récente.
  const sorted = [...rows].sort((a, b) => Number(Boolean(a.archived_at)) - Number(Boolean(b.archived_at)) || String(b.saison || '').localeCompare(String(a.saison || '')) || b.id - a.id);
  const category = (r) => ageGroup(r.naissance, ageCtx) || r.categorie || '';

  const enfants = sorted
    .filter((r) => matches(r, q))
    .map((r) => {
      const state = inscriptionState(r);
      return {
        id: `i${r.id}`,
        avatar: r,
        title: fullName(r.enfant_prenom, r.enfant_nom),
        sub: [category(r), `né(e) le ${birth(r.naissance)}`, `saison ${r.saison || '—'}`, fullName(r.parent_prenom, r.parent_nom) && `Responsable : ${fullName(r.parent_prenom, r.parent_nom)}`].filter(Boolean),
        tag: state.label,
        tone: state.tone,
        href: `/admin/inscriptions/${r.id}`,
        cta: 'Ouvrir la fiche',
      };
    });

  // Responsables : premier et second responsable de chaque inscription (puis pré-inscription), regroupés par personne.
  const people = new Map();
  const addPerson = (name, email, phone, child, source) => {
    if (!name && !email) return;
    if (!matchText([name, email], [phone], q)) return;
    const key = personKey(name, email, phone);
    const person = people.get(key) || { name, email, phone, children: [], inscriptionId: null };
    if (!person.phone && phone) person.phone = phone;
    if (!person.children.some((c) => c.key === child.key)) person.children.push(child);
    if (!person.inscriptionId && source.inscriptionId) {
      person.inscriptionId = source.inscriptionId;
      person.email = email || person.email;
    }
    people.set(key, person);
  };
  for (const r of sorted) {
    const child = { key: normalize(`${r.enfant_prenom} ${r.enfant_nom} ${r.naissance}`), label: `${r.enfant_prenom} (${category(r) || '—'})`, href: `/admin/inscriptions/${r.id}`, archived: Boolean(r.archived_at) };
    addPerson(fullName(r.parent_prenom, r.parent_nom), r.email, r.telephone, child, { inscriptionId: r.id });
    addPerson(fullName(r.parent2_prenom, r.parent2_nom), r.parent2_email, r.parent2_telephone, child, { inscriptionId: r.id });
  }
  for (const p of preinscriptions) {
    if (p.inscription_id) continue;
    const child = { key: normalize(`${p.enfant_prenom} ${p.enfant_nom} ${p.naissance}`), label: `${p.enfant_prenom} (pré-inscription ${p.groupe})`, href: `/admin/preinscriptions?groupe=${encodeURIComponent(p.groupe)}#prein-${p.id}` };
    addPerson(fullName(p.parent_prenom, p.parent_nom), p.email, p.telephone, child, {});
    addPerson(fullName(p.parent2_prenom, p.parent2_nom), p.parent2_email, p.parent2_telephone, child, {});
  }
  const responsables = [...people.values()].map((p, i) => ({
    id: `r${i}`,
    icon: 'user',
    title: p.name || p.email,
    sub: [p.email, p.phone].filter(Boolean),
    children: p.children,
    tag: `${p.children.length} enfant${p.children.length > 1 ? 's' : ''}`,
    tone: 'neutral',
    href: p.children[0]?.href || '/admin/recherche',
    cta: 'Voir la famille',
    // E-mail écrit depuis l'admin, à cette personne seulement (vérifié côté serveur par /admin/email).
    mail: p.inscriptionId && p.email ? `/admin/email?inscription=${p.inscriptionId}&destinataire=${encodeURIComponent(p.email)}` : '',
  }));

  const educs = educateurs
    .filter((e) => matchText([e.prenom, e.nom, e.email, e.categories], [e.telephone], q))
    .map((e) => {
      const status = educateurStatus(e);
      return {
        id: `e${e.id}`,
        icon: 'award',
        title: fullName(e.prenom, e.nom),
        sub: [ROLES[e.role] || 'Éducateur', e.categories, e.email].filter(Boolean),
        tag: STATUS_LABELS[status],
        tone: status === 'complet' ? 'yes' : status === 'archive' ? 'neutral' : 'wait',
        href: `/admin/educateurs/${e.id}`,
        cta: 'Ouvrir',
      };
    });

  const pre = preinscriptions
    .filter((p) => !p.inscription_id && matches(p, q))
    .map((p) => ({
      id: `p${p.id}`,
      icon: 'calendar',
      title: fullName(p.enfant_prenom, p.enfant_nom),
      sub: [`Groupe ${p.groupe}`, `né(e) le ${birth(p.naissance)}`, fullName(p.parent_prenom, p.parent_nom) && `Responsable : ${fullName(p.parent_prenom, p.parent_nom)}`].filter(Boolean),
      tag: p.expired_at ? 'Délai dépassé' : p.invited_at ? 'Invitée' : 'En attente',
      tone: 'neutral',
      href: `/admin/preinscriptions?groupe=${encodeURIComponent(p.groupe)}#prein-${p.id}`,
      cta: 'Ouvrir le groupe',
    }));

  const cats = categories
    .filter((c) => matchText([c.label, c.id, c.anneeMin, c.anneeMax], [], q))
    .map((c) => ({
      id: `c${c.id}`,
      icon: 'tag',
      title: c.label,
      sub: [c.anneeMin === c.anneeMax ? `nés en ${c.anneeMin}` : `nés de ${c.anneeMin} à ${c.anneeMax}`],
      tag: c.active === false ? 'Inactive' : 'Active',
      tone: c.active === false ? 'neutral' : 'yes',
      href: `/admin/inscriptions?categorie=${encodeURIComponent(c.label)}`,
      cta: 'Voir les inscriptions',
    }));

  return { enfants, responsables, educateurs: educs, preinscriptions: pre, categories: cats };
}
