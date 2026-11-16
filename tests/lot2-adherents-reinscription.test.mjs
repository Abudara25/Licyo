// Lot 2 de la refonte « à l'échelle » (2026-11-13) : Adhérents (sélecteur de catégorie, À faire licences, lignes
// compactes, plus de recherche locale) et Réinscription (états, filtres par catégorie et par état, À faire).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as adherents from '../functions/admin/adherents.js';
import * as reinscription from '../functions/admin/reinscription.js';
import { reinscState } from '../functions/admin/reinscription.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { DEMO_ORG_ID as A } from '../functions/_shared/schema.js';
import { backfillOrganization } from '../functions/_shared/crm.js';
import { ensureFamilyLinksTable } from '../functions/_shared/family-links.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const DONE = { dossier_key: 'k', dossier_uploaded_at: '2026-09-10 10:00:00', dossier_status: 'valide', photo_key: 'p', photo_uploaded_at: '2026-09-10 10:00:00', ville_naissance: 'Ermont', pays_naissance: 'France', paye: 1, mode_paiement: 'Espèces' };

async function setup() {
  const env = await fixture();
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const get = async (handler, path) => (await handler.onRequestGet({ request: new Request(`https://club-exemple.example${path}`, { headers: { Cookie: cookie } }), env })).text();
  return { env, get };
}

test('Adhérents : sélecteur de catégorie, À faire licences, pas de recherche locale, E-mail via l’admin', async () => {
  const { env, get } = await setup();
  await seedInscription(env.DB, { enfant_prenom: 'Lina', enfant_nom: 'Moreau', naissance: '2021-03-02', categorie: 'U6', email: 'a@exemple.fr', ...DONE, licence_demandee_at: '2026-10-01', licence_doc_identite: 'refuse' });
  await seedInscription(env.DB, { enfant_prenom: 'Tom', enfant_nom: 'Petit', naissance: '2019-03-02', categorie: 'U8', email: 'b@exemple.fr', ...DONE });
  await backfillOrganization(env, A, { dryRun: false });
  const html = await get(adherents, '/admin/adherents');
  assert.match(html, /class="adm-pi-select"/);
  assert.match(html, /data-filter-input="adh-cats"/);
  assert.match(html, /1 licence avec une pièce refusée/);
  assert.doesNotMatch(html, /id="adh-q"/, 'recherche locale retirée (doublon de la recherche globale)');
  assert.doesNotMatch(html, /class="adm-lc-list"/, 'compteurs détaillés retirés (doublon du bandeau)');
  assert.match(html, /href="\/admin\/email\?inscription=\d+"/);
  const u6 = await get(adherents, '/admin/adherents?age=U6');
  assert.match(u6, /Adhérents U6 <span class="adm-count">1<\/span>/);
  assert.match(u6, /Lina Moreau/);
  assert.doesNotMatch(u6, /Tom Petit/);
});

test('Réinscription : états, filtres par catégorie et par état, plus de mailto', async () => {
  const { env, get } = await setup();
  const old = (prenom, naissance, email) => seedInscription(env.DB, { enfant_prenom: prenom, enfant_nom: 'Test', naissance, categorie: 'U7', saison: '2025-2026', email, ...DONE });
  const a = await old('Alpha', '2019-01-01', 'a@exemple.fr');
  const b = await old('Bravo', '2019-02-02', 'b@exemple.fr');
  await old('Charlie', '2018-03-03', 'c@exemple.fr');
  await ensureFamilyLinksTable(env.DB);
  const past = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  await env.DB.prepare('UPDATE inscriptions SET reinscription_token = ?, reinscription_token_expires_at = ? WHERE id = ?').bind(crypto.randomUUID(), past, a.id).run();
  await seedInscription(env.DB, { enfant_prenom: 'Bravo', enfant_nom: 'Test', naissance: '2019-02-02', categorie: 'U8', email: 'b@exemple.fr', saison: '2026-2027' });

  assert.equal(reinscState({ dejaReinscrit: true }), 'reinscrits');
  assert.equal(reinscState({}), 'non-contactes');

  const html = await get(reinscription, '/admin/reinscription');
  assert.match(html, /1 famille pas encore contactée/);
  assert.match(html, /1 lien expiré/);
  assert.match(html, /1 réinscription à finaliser/);
  assert.match(html, /<span class="adm-tag is-no">Lien expiré<\/span>/);
  assert.doesNotMatch(html, /mailto:/, 'jamais de mailto : E-mail écrit depuis l’admin');
  assert.doesNotMatch(html, /id="reinsc-q"/);

  const expired = await get(reinscription, '/admin/reinscription?etat=expires');
  assert.match(expired, /Alpha Test/);
  assert.doesNotMatch(expired, /Charlie Test/);
  assert.ok(b.id);
  const u9 = await get(reinscription, '/admin/reinscription?age=U9');
  assert.match(u9, /Charlie Test/);
  assert.doesNotMatch(u9, /Alpha Test/);
  assert.match(await get(reinscription, '/admin/reinscription?etat=%3Cx%3E'), /Charlie Test/, 'état inconnu : tout');
});
