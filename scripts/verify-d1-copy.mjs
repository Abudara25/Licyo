// Vérifie les migrations sur une COPIE de la base de production, entièrement en local (rien n'est envoyé
// à Cloudflare, rien n'est écrit dans la production ni dans le fichier d'export).
//
// 1. Exporter la production (compte Cloudflare qui héberge le projet Pages) :
//      npx wrangler d1 export licyo-inscriptions --remote --output=prod-AAAA-MM-JJ.sql
// 2. Lancer : node scripts/verify-d1-copy.mjs prod-AAAA-MM-JJ.sql
// 3. Supprimer le fichier d'export ensuite : il contient des données personnelles (mineurs). Ne jamais le
//    committer ni le déposer dans le dossier publié du site.
//
// Le script charge l'export dans une base SQLite en mémoire, applique ensureSchema() (mise à niveau
// historique + migrations numérotées + contrôle des invariants), compare avant/après, puis rejoue et
// vérifie que le second passage ne change rien. Code de sortie 1 si une anomalie est détectée.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createD1, createKV } from '../tests/helpers/d1.mjs';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { onRequest, clearPageDataCache } from '../functions/_shared/page-data.js';
import { clearPublicDataCache } from '../functions/_shared/public-data.js';
import { ensureSchema, resetSchemaCacheForTests } from '../functions/_shared/inscriptions-db.js';
import { TENANT_TABLES, MIGRATIONS, DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { ARTICLES_INDEXES, NEWS_TRIGGERS } from '../functions/_shared/news-schema.js';
import { snapshot, compareSnapshots, MIGRATION_13_OBJECTS } from './d1-snapshot.mjs';

const file = process.argv[2];
if (!file) {
  console.error('Usage : node scripts/verify-d1-copy.mjs <export.sql>');
  process.exit(2);
}

const sqlite = new DatabaseSync(':memory:');
// L'export crée les tables dans l'ordre de D1 (inscriptions avant organizations, qu'elle référence) :
// clés étrangères désactivées le temps du chargement, puis réactivées comme sur D1.
sqlite.exec('PRAGMA foreign_keys = OFF');
sqlite.exec(readFileSync(file, 'utf8'));
sqlite.exec('PRAGMA foreign_keys = ON');
const db = createD1(sqlite);
const problems = [];
const check = (ok, message) => {
  console.log(`${ok ? 'OK ' : 'KO '} ${message}`);
  if (!ok) problems.push(message);
};

const tables = () => sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
const count = (table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
const columns = (table) => sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
const has = (table) => tables().includes(table);
// Empreinte des données d'une table sur les colonnes présentes AVANT migration (celles ajoutées ensuite,
// dont organization_id, sont exclues).
const columnsBefore = {};
function fingerprint(table, key = 'rowid') {
  columnsBefore[table] ??= columns(table);
  const cols = columnsBefore[table].filter((c) => c !== 'organization_id' && c !== 'id');
  const rows = sqlite.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${table}" ORDER BY ${key}`).all();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
const PUBLIC_TABLES = ['locations', 'groups', 'group_schedules', 'prices'];
const publicDump = () => JSON.stringify(PUBLIC_TABLES.filter(has).map((t) => [t, sqlite.prepare(`SELECT * FROM "${t}" ORDER BY id`).all()]));
const inscriptionsDump = () => JSON.stringify(sqlite.prepare('SELECT * FROM inscriptions ORDER BY id').all());
const fullDump = () =>
  createHash('sha256')
    .update(JSON.stringify(tables().map((t) => [t, columns(t), sqlite.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()])))
    .digest('hex');

// ---------- Avant ----------
const before = Object.fromEntries(tables().map((t) => [t, count(t)]));
console.log('Tables avant migration :', before);
const TOKEN_COLUMNS = ['id', 'upload_token', 'reinscription_token', 'paye', 'dossier_key', 'photo_key'];
const tokenColumns = has('inscriptions') ? TOKEN_COLUMNS.filter((c) => columns('inscriptions').includes(c)) : [];
const tokenSnapshot = () =>
  tokenColumns.length ? sqlite.prepare(`SELECT ${tokenColumns.join(', ')} FROM inscriptions ORDER BY id`).all() : [];
const tokensBefore = tokenSnapshot();
const fingerprints = Object.fromEntries(
  ['inscriptions', 'email_log', 'admin_sessions', 'helloasso_orders'].filter(has).map((t) => [t, fingerprint(t, t === 'helloasso_orders' ? 'order_id' : 'rowid')])
);

const publicBefore = publicDump();
const inscriptionsBefore = has('inscriptions') ? inscriptionsDump() : '';
const idsBefore = has('inscriptions') ? sqlite.prepare('SELECT id FROM inscriptions ORDER BY id').all().map((r) => r.id) : [];

// Phase 4E.1 (migration 13) : empreinte intégrale (toutes colonnes, toutes lignes) de CHAQUE table préexistante, hors
// schema_migrations, pour prouver qu'une base en version 12 reste identique à l'exception des nouvelles structures.
const versionBefore = has('schema_migrations') ? sqlite.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v : null;
const tableDigest = (t) => createHash('sha256').update(JSON.stringify([columns(t), sqlite.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()])).digest('hex');
const preexisting = Object.fromEntries(tables().filter((t) => t !== 'schema_migrations').map((t) => [t, tableDigest(t)]));
// Instantané STRUCTURE + DONNÉES de tous les objets (scripts/d1-snapshot.mjs) : aucun objet préexistant ne doit changer.
const snapshotBefore = snapshot(sqlite);

// ---------- Migration ----------
resetSchemaCacheForTests();
await ensureSchema(db);

// ---------- Après ----------
for (const [table, n] of Object.entries(before)) {
  if (table === 'schema_migrations') continue; // grandit normalement (contrôlée juste après)
  if (has(table)) check(count(table) === n, `${table} : ${n} ligne(s) avant, ${count(table)} après`);
  else check(false, `${table} a disparu`);
}
const versions = sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((v) => v.version);
check(JSON.stringify(versions) === JSON.stringify(MIGRATIONS.map((m) => m.version)), `migrations appliquées : ${versions.join(', ')}`);
const orgs = sqlite.prepare('SELECT id, slug, status FROM organizations').all();
check(orgs.length === 1 && orgs[0].id === DEMO_ORG_ID && orgs[0].status === 'active', `organisations : ${JSON.stringify(orgs)}`);
for (const table of TENANT_TABLES.filter(has)) {
  check(columns(table).includes('organization_id'), `${table}.organization_id présent`);
  const nulls = sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE organization_id IS NULL`).get().n;
  check(nulls === 0, `${table} : ${nulls} ligne(s) sans organisation`);
  const others = sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE organization_id != ?`).get(DEMO_ORG_ID).n;
  check(others === 0, `${table} : ${others} ligne(s) d'une autre organisation`);
}
for (const [table, print] of Object.entries(fingerprints)) {
  check(fingerprint(table, table === 'helloasso_orders' ? 'order_id' : 'rowid') === print, `${table} : données identiques (hors organization_id)`);
}
const indexNames = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((i) => i.name);
for (const name of ['idx_inscriptions_org_created_at', 'idx_inscriptions_org_dedup_key', 'idx_email_log_org_id', 'idx_email_log_org_inscription', 'idx_admin_sessions_org', 'idx_inscriptions_upload_token']) {
  check(indexNames.includes(name), `index ${name}`);
}
const tokensAfter = tokenSnapshot();
check(JSON.stringify(tokensAfter) === JSON.stringify(tokensBefore), `jetons, paiements et références de fichiers inchangés (${tokensBefore.length} fiche(s))`);

// ---------- Phase 4E.1 : migration 13 (additive, sans import) ----------
check(has('articles') && has('organization_news_state'), 'migration 13 : tables articles et organization_news_state créées');
const namedIndexes = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_articles_%' ORDER BY name").all().map((i) => i.name);
check(JSON.stringify(namedIndexes) === JSON.stringify(ARTICLES_INDEXES.map(([n]) => n).sort()), `migration 13 : 3 index nommés (${namedIndexes.join(', ')})`);
const allTriggers = new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((t) => t.name));
check(NEWS_TRIGGERS.length === 30 && NEWS_TRIGGERS.every(([n]) => allTriggers.has(n)), 'migration 13 : 30 triggers');
check(count('articles') === 0, `migration 13 : aucun article importé (${count('articles')})`);
const orgIds = sqlite.prepare('SELECT id FROM organizations ORDER BY id').all().map((o) => o.id);
const newsStates = sqlite.prepare('SELECT organization_id, source, revision, articles_revision, import_batch_id, validated_at, cutover_at FROM organization_news_state ORDER BY organization_id').all();
check(
  JSON.stringify(newsStates.map((s) => s.organization_id)) === JSON.stringify(orgIds) &&
    newsStates.every((s) => s.source === 'json' && s.revision === 1 && s.articles_revision === 0 && s.import_batch_id === null && s.validated_at === null && s.cutover_at === null),
  `migration 13 : une ligne d'état 'json' par organisation (${newsStates.length})`
);
if (versionBefore === 12) {
  for (const [table, digest] of Object.entries(preexisting)) check(has(table) && tableDigest(table) === digest, `${table} : contenu intégralement identique (toutes colonnes)`);
  // Structure : chaque objet préexistant (sqlite_master normalisé, table_xinfo, foreign_key_list, index_list,
  // index_info, index_xinfo, triggers, vues) identique ; objets nouveaux = EXACTEMENT ceux de la migration 13.
  const snapshotAfter = snapshot(sqlite);
  const differences = compareSnapshots(snapshotBefore, snapshotAfter, { allowed: MIGRATION_13_OBJECTS });
  const counted = (s, type) => Object.values(s.structure).filter((o) => o.type === type).length;
  console.log(`Structure avant : ${counted(snapshotBefore, 'table')} tables, ${counted(snapshotBefore, 'index')} index, ${counted(snapshotBefore, 'trigger')} triggers, ${counted(snapshotBefore, 'view')} vues`);
  console.log(`Structure après : ${counted(snapshotAfter, 'table')} tables, ${counted(snapshotAfter, 'index')} index, ${counted(snapshotAfter, 'trigger')} triggers, ${counted(snapshotAfter, 'view')} vues`);
  check(differences.length === 0, `structure et données préexistantes identiques ; objets nouveaux = les ${MIGRATION_13_OBJECTS.size} objets de la migration 13${differences.length ? ` (${differences.join(' ; ')})` : ''}`);
  const digestOf = (s) => createHash('sha256').update(JSON.stringify(s)).digest('hex').slice(0, 16);
  const preexistingAfter = { structure: Object.fromEntries(Object.entries(snapshotAfter.structure).filter(([k]) => k in snapshotBefore.structure)), data: Object.fromEntries(Object.entries(snapshotAfter.data).filter(([t]) => t in snapshotBefore.data && t !== 'schema_migrations')) };
  const preexistingBefore = { structure: snapshotBefore.structure, data: Object.fromEntries(Object.entries(snapshotBefore.data).filter(([t]) => t !== 'schema_migrations')) };
  console.log(`Empreintes (objets préexistants) : avant ${digestOf(preexistingBefore)}, après ${digestOf(preexistingAfter)}`);
} else {
  console.log(`(base en version ${versionBefore} : comparaison intégrale réservée à une base en version 12)`);
}
if (has('admin_sessions')) check(count('admin_sessions') === (before.admin_sessions ?? 0), 'sessions admin conservées (aucune déconnexion)');

// ---------- Second passage ----------
const afterFirst = fullDump();
resetSchemaCacheForTests();
await ensureSchema(db);
check(fullDump() === afterFirst, 'second passage : aucune modification');

// ---------- Phase 2.1 : données publiques, garde-fous, pages ----------
check(publicDump() === publicBefore, 'données publiques (groupes, lieux, créneaux, tarifs) : identiques après migration');
const triggers = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((t) => t.name);
check(triggers.length >= 6, `garde-fous posés (${triggers.length} triggers)`);
check(indexNames.concat(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((i) => i.name)).includes('idx_group_schedules_unique'), 'unicité des créneaux posée (aucun doublon existant)');

const ROOT = new URL('..', import.meta.url);
// Fins de ligne normalisées : une copie de travail Windows (CRLF) doit donner le même rendu qu'un checkout Linux.
const readPage = (url) => readFileSync(url, 'utf8').replaceAll('\r\n', '\n');
const PAGES = { '/': 'index.html', '/entrainements': 'entrainements.html', '/equipe': 'equipe.html', '/contact': 'contact.html', '/inscription': 'inscription.html' };
const env = {
  DB: db,
  INSCRIPTION_STATUS: createKV(),
  ASSETS: {
    fetch: async (request) => new Response(readPage(new URL(PAGES[new URL(request.url).pathname], ROOT)), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  },
};
clearPageDataCache();
clearPublicDataCache();
const originalWarn = console.warn;
console.warn = () => {};
await getCategoriesConfig(env, DEMO_ORG_ID); // lecture normale : ne doit ni importer ni modifier les groupes existants
console.warn = originalWarn;
check(publicDump() === publicBefore, 'lecture des catégories : aucune donnée publique modifiée ni dupliquée');
for (const [path, file] of Object.entries(PAGES)) {
  const res = await onRequest({ request: new Request(`https://clubdemo.licyo.fr${path}`), env });
  const rendered = await res.text();
  const expected = readPage(new URL(file, ROOT));
  check(res.status === 200 && rendered === expected, `${file} rendue avec les données de production : identique au fichier statique`);
}
if (has('inscriptions')) {
  check(inscriptionsDump() === inscriptionsBefore, `inscriptions : contenu intégralement identique (toutes colonnes, ${idsBefore.length} fiches)`);
  const idsAfter = sqlite.prepare('SELECT id FROM inscriptions ORDER BY id').all().map((r) => r.id);
  check(JSON.stringify(idsAfter) === JSON.stringify(idsBefore), 'identifiants des inscriptions conservés');
}
console.log(problems.length ? `\n${problems.length} anomalie(s).` : '\nCopie migrée sans anomalie.');
process.exit(problems.length ? 1 : 0);
