import { ensureInscriptionsTable, buildDedupKey } from '../../functions/_shared/inscriptions-db.js';
import { createD1, createKV } from './d1.mjs';
import { DEMO_ORG_ID } from '../../functions/_shared/schema.js';

export const validData = {
  enfantPrenom: 'Léa', enfantNom: 'Durand', naissance: '2020-02-29',
  categorie: 'U6 - U7', tailleMaillot: '6 ans', modePaiement: 'HelloAsso',
  parentPrenom: 'Samia', parentNom: 'Durand', email: 'parent@example.fr',
  telephone: '0600000000', autorisation: true, rgpd: true, droitImage: false,
};

export async function fixture() {
  const env = { DB: createD1(), INSCRIPTION_STATUS: createKV() };
  await ensureInscriptionsTable(env.DB);
  return env;
}

export async function seedInscription(db, overrides = {}) {
  const row = {
    enfant_prenom: validData.enfantPrenom, enfant_nom: validData.enfantNom,
    naissance: validData.naissance, categorie: validData.categorie, taille_maillot: validData.tailleMaillot,
    parent_prenom: validData.parentPrenom, parent_nom: validData.parentNom, email: validData.email,
    autorisation: 1, rgpd: 1, droit_image: 0, saison: '2026-2027', upload_token: crypto.randomUUID(),
    organization_id: DEMO_ORG_ID,
    ...overrides,
  };
  row.dedup_key = buildDedupKey({ enfantPrenom: row.enfant_prenom, enfantNom: row.enfant_nom, email: row.email });
  const columns = Object.keys(row);
  const result = await db.prepare('INSERT INTO inscriptions (' + columns.join(',') + ') VALUES (' +
    columns.map(() => '?').join(',') + ')').bind(...Object.values(row)).run();
  return db.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(result.meta.last_row_id).first();
}

// Force deux lectures à observer le même état avant de laisser les requêtes écrire.
export function synchronizeReads(t, db, pattern) {
  const prepare = db.prepare.bind(db);
  let count = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const wrap = (statement) => ({
    ...statement,
    bind: (...args) => wrap(statement.bind(...args)),
    all: async () => {
      const snapshot = await statement.all();
      if (++count <= 2) {
        if (count === 2) release();
        await gate;
      }
      return snapshot;
    },
  });
  t.mock.method(db, 'prepare', (sql) => pattern.test(sql) ? wrap(prepare(sql)) : prepare(sql));
}
