// Garde-fou : toute requête SQL qui lit ou écrit une table rattachée à une organisation doit filtrer
// (ou renseigner) organization_id. Analyse statique du code des Functions : un oubli fait échouer les tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { TENANT_TABLES } from '../functions/_shared/schema.js';

// schema.js contient les migrations (ajout et remplissage de la colonne) : exempté en entier.
// Ailleurs, une requête volontairement globale (mise à niveau historique) porte le commentaire SQL
// /* toutes-organisations */, qui la rend visible en relecture.
const EXEMPT_FILES = new Set(['functions/_shared/schema.js']);
const GLOBAL_MARKER = '/* toutes-organisations */';
// Commentaires JS retirés avant l'analyse (une apostrophe dans un commentaire fausserait le repérage des
// chaînes). « // » précédé d'un deux-points (URL dans une chaîne) n'est pas un commentaire.
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, (c) => (c === GLOBAL_MARKER ? c : c.replace(/[^\n]/g, ' '))).replace(/(^|[^:\\])\/\/.*$/gm, '$1');

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsFiles(path) : path.endsWith('.js') ? [path] : [];
  });
}

const TABLE_RE = new RegExp(`\\b(?:FROM|UPDATE|INTO|JOIN)\\s+(${TENANT_TABLES.join('|')})\\b`, 'i');
const LITERAL_RE = /`[^`]*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;

// Défense en profondeur, pas une preuve : les tests fonctionnels (tenant-isolation.test.mjs) restent la
// vraie garantie. Une simple mention de organization_id ne suffit pas (ex. « SELECT organization_id …
// WHERE id = ? ») : il faut une condition (organization_id = / IS / IN) ou, pour un INSERT, la colonne
// renseignée dans la liste des colonnes.
function isScoped(sql) {
  if (/\borganization_id\s*(=|IS\b|IN\b)/i.test(sql)) return true;
  return /\bINSERT(?:\s+OR\s+\w+)?\s+INTO\s+\w+\s*\([^)]*\borganization_id\b/i.test(sql);
}

export function unscopedQueries(root = 'functions') {
  const problems = [];
  for (const file of jsFiles(root)) {
    const name = relative('.', file).replaceAll('\\', '/');
    if (EXEMPT_FILES.has(name)) continue;
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(LITERAL_RE)) {
      const sql = match[0];
      if (TABLE_RE.test(sql) && !isScoped(sql) && !sql.includes(GLOBAL_MARKER)) {
        const line = source.slice(0, match.index).split('\n').length;
        problems.push(`${name}:${line}  ${sql.replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    }
  }
  return problems;
}

test('chaque requête sur une table rattachée à une organisation filtre organization_id', () => {
  const problems = unscopedQueries();
  assert.deepEqual(problems, [], `Requêtes sans organization_id :\n${problems.join('\n')}`);
});

// Dossier temporaire supprimé à la fin du test (sinon un dossier resterait à chaque exécution).
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'demo-scope-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('le garde-fou détecte une requête non filtrée et accepte le marqueur explicite', (t) => {
  const dir = tempDir(t);
  writeFileSync(
    join(dir, 'exemple.js'),
    [
      "db.prepare('SELECT * FROM inscriptions WHERE id = ?');",
      "db.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?');",
      "db.prepare('UPDATE inscriptions /* toutes-organisations */ SET saison = 1');",
      "// l'apostrophe d'un commentaire ne gêne pas : SELECT * FROM email_log",
    ].join('\n')
  );
  const problems = unscopedQueries(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /WHERE id = \?/);
});

test('le KV n’est lu ou écrit que par settings-kv.js (clés propres à chaque organisation)', () => {
  const offenders = jsFiles('functions')
    .map((file) => relative('.', file).replaceAll('\\', '/'))
    .filter((name) => name !== 'functions/_shared/settings-kv.js')
    .filter((name) => /\bINSCRIPTION_STATUS\s*\.\s*(get|put|delete|list)\b/.test(stripComments(readFileSync(name, 'utf8'))));
  assert.deepEqual(offenders, []);
});

test('le garde-fou refuse une simple mention de organization_id sans condition', (t) => {
  const dir = tempDir(t);
  writeFileSync(
    join(dir, 'contournement.js'),
    [
      "db.prepare('SELECT organization_id, nom FROM inscriptions WHERE id = ?');",
      "db.prepare('INSERT INTO inscriptions (organization_id, nom) VALUES (?, ?)');",
      "db.prepare('UPDATE inscriptions SET paye = 1 WHERE organization_id = ? AND id = ?');",
    ].join('\n')
  );
  const problems = unscopedQueries(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /SELECT organization_id, nom/);
});
