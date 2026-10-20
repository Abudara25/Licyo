// Pages du site alimentées par les données publiques de l'organisation (site ↔ CRM).
//
// Quelques passages des pages portent des attributs data-org-* : le routeur public (public-site.js, appelé par
// functions/[[path]].js) sert la page (fichier statique ou rendu de la version publiée) et remplace ces passages
// par les valeurs venues de D1, côté serveur (indexé tel quel par les moteurs de recherche, aucun JavaScript).
//
// Attributs reconnus :
//   data-org="clé"                 texte de l'élément (une seule balise, texte pur)
//   data-org-if="clé[,clé…]"       l'élément (et son contenu) n'est publié que si TOUTES les clés ont une valeur
//   data-org-list="type"           contenu de l'élément régénéré (créneaux, groupes) ; voir LISTS
//   data-org-cards="slots"         si les créneaux ne sont pas « un seul créneau commun », l'élément est
//                                  remplacé par une carte par créneau
//   data-org-attr="attr:clé;…"     attribut (href, data-map-src, data-map-title) valorisé
//   data-org-jsonld="club|faq"     données structurées (JSON-LD) alignées sur les données publiques
//
// SOURCE DE VÉRITÉ : D1. Trois états :
//   A. D1 fonctionne et la donnée existe → la donnée D1 est publiée ;
//   B. D1 fonctionne et la donnée est absente (groupe supprimé/inactif/non public, pas de tarif…) → le
//      passage est masqué, jamais remplacé par l'ancien texte statique ;
//   C. D1 réellement en panne → Sportville SEULEMENT : la page part telle qu'elle est écrite (secours de
//      disponibilité) ; toute autre organisation : passages factuels masqués (jamais les valeurs de
//      Sportville).
// Le HTML doit toujours contenir la valeur ACTUELLE de Sportville (tests/page-data.test.mjs exige que les
// pages ressortent identiques octet pour octet avec ses données).
//
// Hors champ, volontairement statiques : le texte éditorial (nom du club, blason, ton), les balises meta et les
// articles historiques ; les pages non alimentées (actualités, partenaires, mentions…).
import { getCachedPublicData, clearPublicDataCache, safeMapsUrl, buildMapsUrl, SEASON_PRICE_SLUG } from './public-data.js';
import { getCategoriesConfig } from './settings-kv.js';

// ---------------------------------------------------------------------------------------------
// Mise en forme

// "17:00" → "17h", "17:30" → "17h30" ; long : "17h00".
const shortTime = (t) => {
  const [h, m] = String(t).split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
};
const longTime = (t) => {
  const [h, m] = String(t).split(':');
  return `${Number(h)}h${m}`;
};
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const euros = (cents) => {
  const value = cents / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',');
};
// "U6 - U7" → "U6-U7" dans les phrases (écriture habituelle du site).
const proseName = (name) => String(name).replace(/\s+-\s+/g, '-');
const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;');

// "1 rue du Stade, 00000 Sportville" → { street, postalCode, city } (null si le format est autre).
export function parseAddress(address) {
  const match = /^(.*?),\s*(\d{5})\s+(.+)$/.exec(String(address || '').trim());
  return match ? { street: match[1].trim(), postalCode: match[2], city: match[3].trim() } : null;
}

// "+33600000000" → "06 00 00 00 00" ; autre format : tel quel.
export function formatPhone(phone) {
  const digits = String(phone || '').replace(/[\s.-]/g, '');
  const match = /^(?:\+33|0033|0)(\d{9})$/.exec(digits);
  return match ? `0${match[1]}`.replace(/(\d{2})(?=\d)/g, '$1 ') : String(phone || '').trim();
}
const telHref = (phone) => {
  const digits = String(phone || '').replace(/[\s.-]/g, '');
  const match = /^(?:\+33|0033|0)(\d{9})$/.exec(digits);
  return match ? `tel:+33${match[1]}` : /^\+\d{6,15}$/.test(digits) ? `tel:${digits}` : '';
};
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

// ---------------------------------------------------------------------------------------------
// Créneaux : décrits une fois, rendus selon l'endroit de la page.

function describeSlots(data) {
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  const locationById = new Map(data.locations.map((l) => [l.id, l]));
  return data.schedules.map((s) => ({
    day: s.weekday_label,
    weekday: s.weekday,
    start: s.start_time,
    end: s.end_time,
    group: s.group_id ? groupById.get(s.group_id) || null : null,
    location: s.location_id ? locationById.get(s.location_id) || null : null,
  }));
}

// Un seul créneau, commun à tous les groupes : les phrases écrites au singulier dans le HTML restent vraies.
const isSingleCommon = (slots) => slots.length === 1 && !slots[0].group;

// Lieu principal : celui du premier créneau s'il en a un, sinon le premier lieu enregistré.
function primaryLocation(data, slots) {
  return slots.find((s) => s.location)?.location || data.locations[0] || null;
}

const slotHead = (slot, { long = false } = {}) => `${capitalize(slot.day)} ${long ? longTime(slot.start) : shortTime(slot.start)} – ${long ? longTime(slot.end) : shortTime(slot.end)}`;
const slotMeta = (slot, slots) => {
  const locations = new Set(slots.map((s) => s.location?.id ?? 0));
  const parts = [];
  if (slot.group) parts.push(slot.group.name);
  if (slot.location && locations.size > 1) parts.push(slot.location.name);
  return parts;
};

const LISTS = {
  // Une ligne par créneau, en bloc (titres de cartes).
  'slots-title': ({ slots }) =>
    slots
      .map((s) => {
        const meta = slotMeta(s, slots);
        return `<span class="org-slot">${escapeText(slotHead(s))}${meta.length ? ` <span class="org-slot-meta">· ${escapeText(meta.join(' · '))}</span>` : ''}</span>`;
      })
      .join(''),
  // Version courte, sur une ligne (bandeau de l'accueil).
  'slots-compact': ({ slots }) => slots.map((s) => escapeText(`${capitalize(s.day)} ${shortTime(s.start)}`)).join(' · '),
  // Phrase : « jeudi de 17h à 18h (U6-U7) au Stade X ; samedi de … ».
  'slots-sentence': ({ slots }) => escapeText(slotsSentence(slots)),
  // « U6-U7 et U8-U9 » (textes qui citent les catégories).
  'groups-names': ({ data }) => escapeText(joinNames(data.groups.map((g) => proseName(g.name)))),
  // Catégories accueillies : « les enfants nés en 2020 ou 2021 en catégorie U6-U7 et ceux nés en … ».
  'groups-sentence': ({ data }) => escapeText(groupsSentence(data.groups)),
  // Pastille des cartes de créneaux : noms des groupes et années de naissance couvertes.
  'groups-badge': ({ data }) => {
    const names = data.groups.map((g) => `<span style="white-space:nowrap;">${escapeText(proseName(g.name))}</span>`).join(' &amp; ');
    const years = data.groups.flatMap((g) => [g.birth_year_min, g.birth_year_max]).filter(Number.isInteger);
    return years.length ? `${names} · <span style="white-space:nowrap;">nés de ${Math.min(...years)} à ${Math.max(...years)}</span>` : names;
  },
};

const joinNames = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`);

const slotsSentence = (slots) =>
  slots
    .map((s) => `${s.day} de ${shortTime(s.start)} à ${shortTime(s.end)}${s.group ? ` (${proseName(s.group.name)})` : ''}${s.location ? ` au ${s.location.name}` : ''}`)
    .join(' ; ');

function yearsText(g) {
  const min = g.birth_year_min;
  const max = g.birth_year_max;
  if (!Number.isInteger(min) && !Number.isInteger(max)) return '';
  const low = Number.isInteger(min) ? min : max;
  const high = Number.isInteger(max) ? max : min;
  if (low === high) return ` nés en ${low}`;
  return high - low === 1 ? ` nés en ${low} ou ${high}` : ` nés de ${low} à ${high}`;
}
export function groupsSentence(groups) {
  if (!groups.length) return '';
  const parts = groups.map((g, i) => `${i === 0 ? 'les enfants' : 'ceux'}${yearsText(g)} en catégorie ${proseName(g.name)}`);
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
  return `le club accueille ${joined}`;
}

// Carte d'un créneau (page Entraînements) quand il y a plusieurs créneaux ou un créneau propre à un groupe.
function slotCard(slot, slots) {
  const badge = slot.group ? escapeText(proseName(slot.group.name)) : 'Tous les groupes';
  const where = slot.location ? `<p>${escapeText(slot.location.name)}${slot.location.address ? ` — ${escapeText(slot.location.address)}` : ''}</p>` : '';
  return `<div class="card" data-reveal>
          <div class="card-body">
            <span class="card-date">${badge}</span>
            <h3>${escapeText(capitalize(slot.day))}, ${escapeText(longTime(slot.start))} – ${escapeText(longTime(slot.end))}</h3>
            ${where}
          </div>
        </div>`;
}

// ---------------------------------------------------------------------------------------------
// Données publiques → valeurs { clé: texte }. Seules les clés dont la donnée existe sont renseignées.

export function publicValues(data, organization = null) {
  const values = {};
  const slots = describeSlots(data);
  if (slots.length) values['schedule.any'] = '1';
  if (isSingleCommon(slots)) {
    const slot = slots[0];
    values['schedule.single'] = '1';
    Object.assign(values, {
      'schedule.day': slot.day,
      'schedule.Day': capitalize(slot.day),
      'schedule.days': `${slot.day}s`,
      'schedule.start': shortTime(slot.start),
      'schedule.end': shortTime(slot.end),
      'schedule.startLong': longTime(slot.start),
      'schedule.endLong': longTime(slot.end),
    });
  }
  const location = primaryLocation(data, slots);
  if (location) {
    values['location.name'] = location.name;
    if (location.address) {
      const city = parseAddress(location.address)?.city;
      values['location.address'] = location.address;
      values['location.short'] = city ? `${location.name}, ${city}` : location.name;
      values['location.mapsUrl'] = safeMapsUrl(location.maps_url) || buildMapsUrl(location.name, location.address);
      values['location.embedUrl'] = `https://www.google.com/maps?q=${encodeURIComponent(`${location.name} ${location.address}`)}&output=embed`;
      values['location.mapTitle'] = `Carte — ${values['location.short']}`;
    } else {
      values['location.short'] = location.name;
    }
  }
  const price = data.prices.find((p) => p.slug === SEASON_PRICE_SLUG);
  if (price) {
    values['price.seasonAmount'] = euros(price.amount_cents);
    values['price.season'] = `${euros(price.amount_cents)} €`;
    // Aperçu affiché dans le formulaire (le vrai plan de paiement est chez HelloAsso) et Pass'Sport (aide de l'État de 50 €).
    values['price.tierAmount'] = String(Math.round(price.amount_cents / 300));
    values['price.passSportAmount'] = euros(Math.max(0, price.amount_cents - 5000));
  }
  if (data.groups.length) values['groups.any'] = '1';
  const years = data.groups.flatMap((g) => [g.birth_year_min, g.birth_year_max]).filter(Number.isInteger);
  if (years.length) {
    values['groups.yearMin'] = String(Math.min(...years));
    values['groups.yearMax'] = String(Math.max(...years));
  }
  for (const g of data.groups) {
    values[`group.${g.slug}.name`] = g.name;
    values[`group.${g.slug}.option`] = Number.isInteger(g.birth_year_min) && Number.isInteger(g.birth_year_max) ? `${g.name} (${g.birth_year_min}-${g.birth_year_max})` : g.name;
    if (Number.isInteger(g.birth_year_min)) values[`group.${g.slug}.yearMin`] = String(g.birth_year_min);
    if (Number.isInteger(g.birth_year_max)) values[`group.${g.slug}.yearMax`] = String(g.birth_year_max);
  }
  if (organization?.email && EMAIL_RE.test(organization.email)) {
    values['org.email'] = organization.email;
    values['org.mailto'] = `mailto:${organization.email}`;
  }
  if (organization?.phone && telHref(organization.phone)) {
    values['org.phone'] = formatPhone(organization.phone);
    values['org.tel'] = telHref(organization.phone);
  }
  return values;
}

// ---------------------------------------------------------------------------------------------
// Découpage HTML : balises data-org-*. L'injecteur ne cherche pas à comprendre le HTML : il repère une
// balise ouvrante portant l'attribut, puis sa balise fermante en comptant les balises de même nom. Si la
// structure n'est pas celle attendue (fermante introuvable), l'élément est laissé tel quel plutôt que de
// produire du HTML cassé.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function elementEnd(html, from, tag) {
  const token = new RegExp(`<(/?)${tag}(?=[\\s/>])[^>]*>`, 'gi');
  token.lastIndex = from;
  let depth = 1;
  for (let m = token.exec(html); m; m = token.exec(html)) {
    if (m[1]) depth -= 1;
    else if (!m[0].endsWith('/>')) depth += 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

// Applique fn(élément) à chaque élément portant `attr`, du premier au dernier ; fn renvoie le HTML de
// remplacement (ou null pour laisser l'élément tel quel).
function transformElements(html, attr, fn) {
  const open = new RegExp(`<([a-zA-Z][\\w-]*)((?:\\s[^>]*?)?\\s${attr}="([^"]*)"[^>]*)>`, 'g');
  let out = '';
  let cursor = 0;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const [openTag, tag, attrs, value] = m;
    if (m.index < cursor || VOID.has(tag.toLowerCase())) continue;
    const contentStart = m.index + openTag.length;
    const end = elementEnd(html, contentStart, tag);
    if (end < 0) continue;
    const closeLength = `</${tag}>`.length;
    const inner = html.slice(contentStart, end - closeLength);
    const replacement = fn({ tag, attrs, value, openTag, inner, whole: html.slice(m.index, end) });
    if (replacement === null || replacement === undefined) continue;
    out += html.slice(cursor, m.index) + replacement;
    cursor = end;
    open.lastIndex = end;
  }
  return out + html.slice(cursor);
}

const hasAll = (values, list) => list.split(',').map((k) => k.trim()).filter(Boolean).every((k) => Object.hasOwn(values, k));

const ATTRIBUTES = new Set(['href', 'data-map-src', 'data-map-title']);
function setAttribute(openTag, name, value) {
  const escaped = escapeAttr(value);
  const existing = new RegExp(`(\\s${name}=")[^"]*(")`);
  if (existing.test(openTag)) return openTag.replace(existing, (_, a, b) => `${a}${escaped}${b}`);
  return openTag.replace(/\s*(\/?)>$/, ` ${name}="${escaped}"$1>`);
}

// ---------------------------------------------------------------------------------------------
// JSON-LD : parsé, ajusté, réécrit avec JSON.stringify(…, null, 2). Le HTML statique est écrit dans ce
// même format (un test le vérifie) : sans changement de données, la page ressort à l'identique.

const jsonForHtml = (object) => JSON.stringify(object, null, 2).replace(/</g, '\\u003c');

function transformClubJsonLd(json, { data, values }) {
  const club = { ...json };
  const location = primaryLocation(data, describeSlots(data));
  const parsed = location?.address ? parseAddress(location.address) : null;
  if (location?.address) {
    club.address = parsed
      ? { '@type': 'PostalAddress', streetAddress: parsed.street, postalCode: parsed.postalCode, addressLocality: parsed.city, addressCountry: json.address?.addressCountry || 'FR' }
      : { '@type': 'PostalAddress', streetAddress: location.address, addressCountry: json.address?.addressCountry || 'FR' };
  } else {
    delete club.address;
  }
  // Catégories citées dans la description : celles d'aujourd'hui, ou aucune.
  if (typeof json.description === 'string') {
    const names = joinNames(data.groups.map((g) => proseName(g.name)));
    club.description = json.description.replace(/,s*catégories [^.]*./, names ? `, catégories ${names}.` : '.');
  }
  if (values['org.email']) club.email = values['org.email'];
  else delete club.email;
  if (values['org.tel']) club.telephone = values['org.tel'].replace(/^tel:/, '');
  else delete club.telephone;
  return club;
}

function transformFaqJsonLd(json, { data, values }) {
  const slots = describeSlots(data);
  const answer = (q, text) => ({ ...q, acceptedAnswer: { ...q.acceptedAnswer, text } });
  const mainEntity = [];
  for (const q of json.mainEntity || []) {
    const name = String(q.name || '');
    const text = String(q.acceptedAnswer?.text || '');
    if (/Quel âge/.test(name)) {
      if (values['groups.any']) mainEntity.push(answer(q, `Filles et garçons sont les bienvenus : ${groupsSentence(data.groups)}, pour la saison 2026-2027.`));
    } else if (/Où et quand/.test(name)) {
      if (slots.length) {
        const where = values['location.name'] ? ` au ${values['location.name']}${values['location.address'] ? `, ${values['location.address']}` : ''}` : '';
        const when = isSingleCommon(slots)
          ? `tous les ${values['schedule.days']} de ${values['schedule.start']} à ${values['schedule.end']}`
          : slotsSentence(slots);
        mainEntity.push(answer(q, `Les entraînements ont lieu ${when}${where}.`));
      }
    } else if (/prix/.test(name)) {
      if (values['price.season']) mainEntity.push(answer(q, text.replace(/\d[\d,]*\s?€/, values['price.season'])));
    } else if (/second créneau/.test(name)) {
      if (values['schedule.single']) {
        mainEntity.push(answer(q, text.replace(/\([^)]*\d+h[^)]*\)/, `(${values['schedule.day']} ${values['schedule.start']}-${values['schedule.end']})`)));
      }
    } else {
      mainEntity.push(q);
    }
  }
  return { ...json, mainEntity };
}

const JSONLD = { club: transformClubJsonLd, faq: transformFaqJsonLd };

// ---------------------------------------------------------------------------------------------
// Application des données publiques à une page.

const UNAVAILABLE_TEXT = '—';

// data : null = aucune donnée (organisation vide ou base en panne pour une autre organisation que Sportville).
export function applyPublicData(html, { data, organization = null }) {
  const safeData = data || { groups: [], schedules: [], locations: [], prices: [] };
  const values = publicValues(safeData, organization);
  const slots = describeSlots(safeData);
  const context = { data: safeData, slots, values, organization };
  let out = html;

  // 1. Passages dont la donnée est absente : retirés (état B) — jamais remplacés par l'ancien texte.
  // (élément conservé : laissé tel quel, l'analyse continue à l'intérieur pour les data-org-if imbriqués)
  out = transformElements(out, 'data-org-if', ({ value }) => (hasAll(values, value) ? null : ''));

  // 2. Cartes de créneaux : plusieurs créneaux ou créneau propre à un groupe → une carte par créneau.
  out = transformElements(out, 'data-org-cards', () => (isSingleCommon(slots) || !slots.length ? null : slots.map((s) => slotCard(s, slots)).join('\n        ')));

  // 3. Listes régénérées (créneaux, groupes).
  out = transformElements(out, 'data-org-list', ({ tag, attrs, value }) => {
    const render = LISTS[value];
    // Un seul créneau commun : le HTML écrit au singulier (avec ses data-org) reste tel quel.
    if (!render || (value.startsWith('slots') && isSingleCommon(slots))) return null;
    return `<${tag}${attrs}>${render(context)}</${tag}>`;
  });

  // 4. Attributs valorisés (balises ouvrantes seulement : les éléments imbriqués restent analysés).
  out = out.replace(/<[a-zA-Z][\w-]*(?:\s[^>]*?)?\sdata-org-attr="([^"]*)"[^>]*>/g, (openTag, spec) => {
    let next = openTag;
    for (const pair of spec.split(';')) {
      const [name, key] = pair.split(':').map((part) => part.trim());
      if (!ATTRIBUTES.has(name)) continue;
      // Valeur absente : l'attribut est retiré (jamais l'ancienne valeur statique, ex. un lien mailto: ou tel:).
      next = Object.hasOwn(values, key) ? setAttribute(next, name, values[key]) : next.replace(new RegExp(`\\s${name}="[^"]*"`), '');
    }
    return next;
  });

  // 5. Textes.
  out = transformElements(out, 'data-org', ({ tag, attrs, value, inner }) => {
    if (/[<]/.test(inner)) return null; // un data-org ne contient que du texte
    return `<${tag}${attrs}>${escapeText(Object.hasOwn(values, value) ? values[value] : UNAVAILABLE_TEXT)}</${tag}>`;
  });

  // 6. Données structurées.
  out = transformElements(out, 'data-org-jsonld', ({ tag, attrs, value, inner }) => {
    const transform = JSONLD[value];
    if (!transform) return null;
    let parsed;
    try {
      parsed = JSON.parse(inner);
    } catch {
      return null;
    }
    return `<${tag}${attrs}>\n${jsonForHtml(transform(parsed, context))}\n</${tag}>`;
  });
  return out;
}

// Ancienne API (tests) : remplacement de texte seul.
export function injectOrgData(html, values) {
  return transformElements(html, 'data-org', ({ tag, attrs, value, inner }) => {
    if (/[<]/.test(inner) || !Object.hasOwn(values, value)) return null;
    return `<${tag}${attrs}>${escapeText(values[value])}</${tag}>`;
  });
}

// ---------------------------------------------------------------------------------------------

export const clearPageDataCache = clearPublicDataCache;

// { data } : D1 fonctionne (même vide) ; { data: null, unavailable: true } : D1 en panne.
export async function loadPublicContext(env, organization) {
  try {
    // Premier accès d'une organisation : import (une seule fois) depuis sa configuration KV. Mis en cache avec les données.
    const data = await getCachedPublicData(env, organization.id, () => getCategoriesConfig(env, organization.id));
    return { data, unavailable: false };
  } catch (error) {
    console.warn(`Pages publiques : D1 indisponible pour ${organization.id} (${error?.message})`);
    return { data: null, unavailable: true };
  }
}

// Routage et rendu des pages publiques (version publiée de l'organisation, 404, secours) : public-site.js.
// Réexporté ici pour les appelants historiques.
export { onRequest } from './public-site.js';

// Phrase des créneaux (« jeudi de 17h à 18h au Stade X ») et lieu principal, pour les e-mails (email-identity.js).
export function scheduleSummary(data) {
  if (!data) return { sentence: '', location: null };
  const slots = describeSlots(data);
  return { sentence: slots.length ? slotsSentence(slots) : '', location: primaryLocation(data, slots) };
}
