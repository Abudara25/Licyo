// Import de l'export Footclubs (2026-11-04) : met à jour le suivi licence (club-followup.js) d'après le fichier .xlsx
// exporté de Footclubs (« export_dossier.xlsx », une ligne par demande de licence). Le fichier est lu en mémoire puis
// oublié : rien n'est stocké hormis les champs de suivi des fiches retrouvées.
//
// Colonnes lues (repérées par leur titre, accents et casse ignorés) : Nom, Prénom, Date de naissance, Type, Statut,
// Pièces manquantes, Numéro personne. Les autres colonnes (coordonnées, représentants…) ne sont jamais lues.
// Rapprochement : prénom + nom + date de naissance d'une inscription non archivée de l'organisation (un seul résultat,
// sinon « ambigu », rien n'est modifié), à défaut le n° de licence déjà enregistré.
//
// Lecteur .xlsx sans dépendance : archive ZIP (répertoire central), entrées « stored » ou « deflate »
// (DecompressionStream, disponible dans les Workers et Node), XML lu par expressions régulières (pas de DOMParser
// dans les Workers). Bornes : fichier 2 Mo, 20 Mo décompressés par entrée, 2 000 lignes.
import { FOLLOWUP_STEPS, LICENCE_DOCS, licenceStage } from './club-followup.js';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
export const MAX_ROWS = 2000;

export class FootclubsFileError extends Error {}

// ---------------------------------------------------------------------------------------------
// ZIP

function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new FootclubsFileError('Fichier illisible : ce n’est pas un fichier Excel (.xlsx).');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new FootclubsFileError('Fichier Excel endommagé.');
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    entries.set(name, { method, compressedSize, localOffset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return { view, entries };
}

async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_ENTRY_BYTES) {
      await reader.cancel();
      throw new FootclubsFileError('Fichier trop volumineux une fois décompressé.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

async function readEntry(bytes, zip, name) {
  const e = zip.entries.get(name);
  if (!e) return null;
  const p = e.localOffset;
  if (p + 30 > bytes.length || zip.view.getUint32(p, true) !== 0x04034b50) throw new FootclubsFileError('Fichier Excel endommagé.');
  const start = p + 30 + zip.view.getUint16(p + 26, true) + zip.view.getUint16(p + 28, true);
  const data = bytes.subarray(start, start + e.compressedSize);
  let raw;
  if (e.method === 0) raw = data;
  else if (e.method === 8) {
    try {
      raw = await inflateRaw(data);
    } catch (error) {
      if (error instanceof FootclubsFileError) throw error;
      throw new FootclubsFileError('Fichier Excel endommagé.');
    }
  } else throw new FootclubsFileError('Format de compression non pris en charge.');
  if (raw.length > MAX_ENTRY_BYTES) throw new FootclubsFileError('Fichier trop volumineux une fois décompressé.');
  return new TextDecoder().decode(raw);
}

// ---------------------------------------------------------------------------------------------
// XML de feuille de calcul

const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k.startsWith('#x') ? Number.parseInt(k.slice(2), 16) : Number.parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });

const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('');

function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref || '')?.[1];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function parseSheet(xml, shared) {
  const rows = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length > MAX_ROWS + 5) throw new FootclubsFileError(`Trop de lignes (${MAX_ROWS} au plus).`);
    const cells = [];
    let next = 0;
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const idx = ref ? columnIndex(ref) : next;
      next = idx + 1;
      if (idx < 0 || idx > 200) continue;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const body = c[2] || '';
      let value = '';
      if (type === 'inlineStr') value = textOf(body);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v === undefined) value = '';
        else if (type === 's') value = shared[Number.parseInt(v, 10)] ?? '';
        else value = decodeXml(v);
      }
      cells[idx] = { value: String(value).trim(), numeric: !type || type === 'n' };
    }
    rows.push(cells);
  }
  return rows;
}

// hint : phrase d'aide affichée quand le fichier n'est pas un .xlsx (l'import qui l'appelle sait d'où il vient).
export async function readXlsxRows(bytes, { hint = 'exportez-le depuis Footclubs au format Excel.' } = {}) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.length > MAX_FILE_BYTES) throw new FootclubsFileError('Fichier trop volumineux (2 Mo au plus).');
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new FootclubsFileError(`Ce fichier n’est pas un fichier Excel (.xlsx) : ${hint}`);
  const zip = readZipEntries(bytes);
  // Certains logiciels (HelloAsso) préfixent les balises par un espace de noms (<x:row>) : on le retire.
  const unprefix = (xml) => (xml ? xml.replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, '<$1') : xml);
  const sharedXml = unprefix(await readEntry(bytes, zip, 'xl/sharedStrings.xml'));
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const sheetName = zip.entries.has('xl/worksheets/sheet1.xml')
    ? 'xl/worksheets/sheet1.xml'
    : [...zip.entries.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new FootclubsFileError('Aucune feuille trouvée dans le fichier.');
  return parseSheet(unprefix(await readEntry(bytes, zip, sheetName)), shared);
}

// ---------------------------------------------------------------------------------------------
// Lignes Footclubs

export const normalizeText = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const HEADERS = {
  nom: ['nom'],
  prenom: ['prenom'],
  naissance: ['date de naissance'],
  type: ['type'],
  statut: ['statut'],
  pieces: ['pieces manquantes'],
  numero: ['numero personne', 'numero de licence', 'n licence'],
};
const REQUIRED = ['nom', 'prenom', 'naissance', 'statut'];

// Excel stocke parfois les dates en nombre de jours depuis le 30/12/1899.
function toIsoDate(cell) {
  if (!cell?.value) return null;
  const v = cell.value;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (cell.numeric && /^\d{4,6}(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export function footclubsRecords(rows) {
  const headerIndex = rows.findIndex((r) => r && r.filter((c) => c?.value).length >= 3);
  if (headerIndex < 0) throw new FootclubsFileError('Fichier vide.');
  const names = rows[headerIndex].map((c) => normalizeText(c?.value));
  const col = {};
  for (const [key, labels] of Object.entries(HEADERS)) col[key] = names.findIndex((n) => labels.includes(n));
  const missing = REQUIRED.filter((k) => col[k] < 0);
  if (missing.length) throw new FootclubsFileError('Colonnes introuvables : Nom, Prénom, Date de naissance et Statut sont nécessaires. Vérifiez qu’il s’agit bien de l’export des demandes de licence de Footclubs.');
  const data = rows.slice(headerIndex + 1).filter((r) => r && r.some((c) => c?.value));
  if (data.length > MAX_ROWS) throw new FootclubsFileError(`Trop de lignes (${MAX_ROWS} au plus).`);
  const get = (r, key) => (col[key] >= 0 ? String(r[col[key]]?.value || '').slice(0, 300) : '');
  return data.map((r) => ({
    nom: get(r, 'nom'),
    prenom: get(r, 'prenom'),
    naissance: toIsoDate(r[col.naissance]),
    type: get(r, 'type'),
    statut: get(r, 'statut'),
    pieces: get(r, 'pieces'),
    numero: get(r, 'numero').replace(/\s+/g, ''),
  }));
}

// ---------------------------------------------------------------------------------------------
// Statuts et pièces Footclubs → suivi du club

const LICENCE_STEP_KEYS = FOLLOWUP_STEPS.filter((s) => s.group === 'licence').map((s) => s.key);
const upTo = (n) => LICENCE_STEP_KEYS.slice(0, n);

// Étapes cochées d'après le statut Footclubs (valeurs relevées sur un export réel du 2026-11-04). Un statut inconnu
// ne change rien : il est signalé dans le récapitulatif.
export const FOOTCLUBS_STATUSES = {
  'prise de contact': { steps: upTo(1) },
  'controle a effectuer': { steps: upTo(2) },
  'rejete par club': { steps: upTo(1), rejected: true },
  'en attente validation ligue': { steps: upTo(4) },
  'attestation licence creee': { steps: upTo(5) },
};

const DOC_PATTERNS = [
  ['docIdentite', /identite/],
  ['docCertificat', /certificat|medical/],
  ['docSante', /questionnaire|sante/],
  ['docPhoto', /photo(?!copie)|photographie/],
];

// Libellés de « Pièces manquantes » → pièces du club ; texte non reconnu renvoyé tel quel pour le récapitulatif.
export function missingDocs(text) {
  const parts = String(text || '')
    .split(/[\n;,|]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const docs = new Set();
  const unknown = [];
  for (const part of parts) {
    const n = normalizeText(part);
    const hit = DOC_PATTERNS.find(([, re]) => re.test(n));
    if (hit) docs.add(hit[0]);
    else unknown.push(part.slice(0, 120));
  }
  return { docs: [...docs], unknown };
}

const NUMERO_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{0,39}$/;
const isPlayer = (type) => !type || normalizeText(type) === 'joueur' || normalizeText(type) === 'joueuse';

// État cible d'une fiche : étapes (clé → booléen), pièces (clé → valeur), n° de licence, statut Footclubs.
function targetFor(row, rec, status) {
  const steps = Object.fromEntries(LICENCE_STEP_KEYS.map((k) => [k, status.steps.includes(k)]));
  const { docs: listed, unknown } = missingDocs(rec.pieces);
  const docs = {};
  for (const d of LICENCE_DOCS) {
    const current = row[d.column] || '';
    if (listed.includes(d.key)) docs[d.key] = status.rejected ? 'refuse' : current === 'refuse' ? 'refuse' : 'manquant';
    else if (current === 'manquant' || (current === 'refuse' && steps.licenceValidee)) docs[d.key] = '';
    else docs[d.key] = current;
  }
  const numero = !row.numero_licence && NUMERO_RE.test(rec.numero) ? rec.numero : row.numero_licence || '';
  return { steps, docs, numero, statut: rec.statut.slice(0, 80), unknown };
}

const stepColumn = Object.fromEntries(FOLLOWUP_STEPS.map((s) => [s.key, s.column]));
const docColumn = Object.fromEntries(LICENCE_DOCS.map((d) => [d.key, d.column]));

// Ligne de la base telle qu'elle serait après application (pour calculer l'étape « après »).
function applyToRow(row, target) {
  const next = { ...row };
  for (const [k, on] of Object.entries(target.steps)) next[stepColumn[k]] = on ? row[stepColumn[k]] || 'x' : null;
  for (const [k, v] of Object.entries(target.docs)) next[docColumn[k]] = v || null;
  next.numero_licence = target.numero || null;
  return next;
}

function changesOf(row, target) {
  const out = [];
  for (const s of FOLLOWUP_STEPS.filter((x) => x.group === 'licence')) {
    const had = Boolean(row[s.column]);
    if (had !== target.steps[s.key]) out.push(`${s.label} : ${target.steps[s.key] ? 'cochée' : 'décochée'}`);
  }
  for (const d of LICENCE_DOCS) {
    if ((row[d.column] || '') !== target.docs[d.key]) out.push(`${d.label} : ${target.docs[d.key] === 'manquant' ? 'manquant' : target.docs[d.key] === 'refuse' ? 'à corriger' : 'plus signalé manquant'}`);
  }
  if ((row.numero_licence || '') !== target.numero) out.push(`N° de licence : ${target.numero}`);
  return out;
}

const identity = (prenom, nom, naissance) => `${normalizeText(prenom)}|${normalizeText(nom)}|${naissance || ''}`;

// Rapprochement des lignes du fichier avec les inscriptions (non archivées) de l'organisation.
export function planFootclubsImport(records, inscriptions) {
  const byIdentity = new Map();
  const byNumero = new Map();
  for (const r of inscriptions) {
    const key = identity(r.enfant_prenom, r.enfant_nom, r.naissance);
    byIdentity.set(key, [...(byIdentity.get(key) || []), r]);
    if (r.numero_licence) byNumero.set(String(r.numero_licence).replace(/\s+/g, ''), [...(byNumero.get(String(r.numero_licence).replace(/\s+/g, '')) || []), r]);
  }
  const plan = { updates: [], unchanged: 0, ignored: 0, notFound: [], ambiguous: [], unknownStatus: [], conflicts: [] };
  const seen = new Set();
  for (const rec of records) {
    if (!isPlayer(rec.type)) {
      plan.ignored += 1;
      continue;
    }
    const label = `${rec.prenom} ${rec.nom}`.trim();
    let found = byIdentity.get(identity(rec.prenom, rec.nom, rec.naissance)) || [];
    if (!found.length && rec.numero) found = byNumero.get(rec.numero) || [];
    if (!found.length) {
      plan.notFound.push({ label, naissance: rec.naissance, statut: rec.statut });
      continue;
    }
    if (found.length > 1 || seen.has(found[0].id)) {
      plan.ambiguous.push({ label, naissance: rec.naissance });
      continue;
    }
    const row = found[0];
    seen.add(row.id);
    const status = FOOTCLUBS_STATUSES[normalizeText(rec.statut)];
    if (!status) {
      plan.unknownStatus.push({ label, statut: rec.statut });
      continue;
    }
    const target = targetFor(row, rec, status);
    if (row.numero_licence && rec.numero && String(row.numero_licence).replace(/\s+/g, '') !== rec.numero) plan.conflicts.push({ label, saved: row.numero_licence });
    const changes = changesOf(row, target);
    if ((row.licence_footclubs_statut || '') !== target.statut) changes.push(`Statut Footclubs : ${target.statut}`);
    if (!changes.length) {
      plan.unchanged += 1;
      continue;
    }
    plan.updates.push({
      id: row.id,
      child: `${row.enfant_prenom} ${row.enfant_nom}`,
      before: licenceStage(row),
      after: licenceStage(applyToRow(row, target)),
      changes,
      unknownDocs: target.unknown,
      target: { steps: target.steps, docs: target.docs, numero: target.numero, statut: target.statut },
    });
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Application (après confirmation). Les cibles reviennent du navigateur : tout est revérifié ici.

const DOC_VALUES = new Set(['', 'manquant', 'ok', 'refuse', 'club', 'non_requis']);

export function sanitizeTargets(json) {
  let list;
  try {
    list = JSON.parse(String(json || '[]'));
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length > MAX_ROWS) return null;
  const out = [];
  for (const item of list) {
    const id = Number(item?.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    const t = item.target || {};
    const steps = Object.fromEntries(LICENCE_STEP_KEYS.map((k) => [k, t.steps?.[k] === true]));
    const docs = {};
    for (const d of LICENCE_DOCS) {
      const v = String(t.docs?.[d.key] ?? '');
      if (!DOC_VALUES.has(v) || (v === 'non_requis' && !d.certificat)) return null;
      docs[d.key] = v;
    }
    const numero = String(t.numero ?? '').trim();
    if (numero && !NUMERO_RE.test(numero)) return null;
    out.push({ id, steps, docs, numero, statut: String(t.statut ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 80) });
  }
  return out;
}

// Une instruction par fiche, toutes dans un même db.batch (tout ou rien). Les dates déjà posées sont conservées.
export function footclubsStatements(db, organizationId, targets) {
  return targets.map((t) => {
    const sets = [];
    const values = [];
    for (const [k, on] of Object.entries(t.steps)) sets.push(on ? `${stepColumn[k]} = COALESCE(${stepColumn[k]}, datetime('now'))` : `${stepColumn[k]} = NULL`);
    for (const [k, v] of Object.entries(t.docs)) {
      sets.push(`${docColumn[k]} = ?`);
      values.push(v || null);
    }
    sets.push('numero_licence = ?', 'licence_footclubs_statut = ?', "licence_footclubs_at = datetime('now')");
    values.push(t.numero || null, t.statut || null);
    return db.prepare(`UPDATE inscriptions SET ${sets.join(', ')} WHERE organization_id = ? AND id = ? AND archived_at IS NULL`).bind(...values, organizationId, t.id);
  });
}
