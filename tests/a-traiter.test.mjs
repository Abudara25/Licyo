// Page « À traiter » (2026-11-04) : règles de chaque section, ordre, fiches archivées ignorées, page isolée par
// organisation et contenu échappé.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTodo, todoCount } from '../functions/_shared/todo.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import * as page from '../functions/admin/a-traiter.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const OLD = '2026-10-01 10:00:00';
const RECENT = '2026-11-03 10:00:00';
const COMPLETE = { paye: 1, dossier_uploaded_at: OLD, dossier_status: 'valide', photo_uploaded_at: OLD, ville_naissance: 'Ermont', pays_naissance: 'France' };
let n = 0;
const row = (extra = {}) => ({ id: ++n, enfant_prenom: `E${n}`, enfant_nom: 'Test', naissance: '2019-01-01', created_at: OLD, ...extra });
const keys = (sections) => sections.map((s) => s.key);
const find = (sections, key) => sections.find((s) => s.key === key)?.items || [];

test('sections : dossier à vérifier, licences par étape, paiement au club, relances, tenues, doublons', () => {
  const rows = [
    row({ dossier_uploaded_at: RECENT, dossier_status: null }),
    row({ ...COMPLETE, licence_demandee_at: OLD, licence_doc_identite: 'refuse' }),
    row({ ...COMPLETE, licence_demandee_at: OLD, licence_famille_at: OLD }),
    row({ ...COMPLETE, licence_demandee_at: OLD, licence_famille_at: OLD, licence_verifiee_at: OLD }),
    row({ ...COMPLETE, licence_demandee_at: OLD, licence_doc_certificat: 'manquant' }),
    row({ ...COMPLETE }),
    row({ mode_paiement: 'Espèces', paye: 0 }),
    row({ ...COMPLETE, licence_demandee_at: OLD, licence_famille_at: OLD, licence_verifiee_at: OLD, licence_verif_at: OLD, licence_validee_at: OLD, tenue_commandee_at: OLD, tenue_remise_at: OLD }),
    row({ ...COMPLETE, archived_at: OLD }),
  ];
  const s = buildTodo(rows, { now: NOW, preinscriptionKeys: new Set(['e7|test|2019-01-01']), contacts: new Map([[2, 99]]) });
  assert.deepEqual(keys(s), ['dossiers', 'licence_refusee', 'licence_a_verifier', 'licence_a_signer', 'licence_relance', 'licence_a_demander', 'paiements', 'relances', 'tenues', 'doublons']);
  assert.deepEqual(find(s, 'dossiers').map((i) => i.id), [1]);
  assert.equal(find(s, 'dossiers')[0].actions[0].href, '/admin/inscriptions/1/apercu');
  assert.equal(find(s, 'licence_refusee')[0].detail, "À corriger : pièce d'identité (refusé)");
  assert.equal(find(s, 'licence_refusee')[0].actions[1].href, '/admin/inscriptions/2#suivi-club', 'accès direct à la fiche unique, sans redirection par le contact');
  assert.equal(find(s, 'licence_relance')[0].detail, 'Manque : certificat médical');
  assert.deepEqual(find(s, 'licence_a_demander').map((i) => i.id), [6]);
  assert.deepEqual(find(s, 'paiements').map((i) => i.id), [7]);
  assert.ok(find(s, 'relances').some((i) => i.id === 7 && /paiement/.test(i.detail)));
  assert.ok(!find(s, 'tenues').some((i) => i.id === 8), 'tenue remise : rien à faire');
  assert.ok(!s.flatMap((x) => x.items).some((i) => i.id === 9), 'fiche archivée ignorée');
  assert.equal(todoCount(s), s.filter((x) => x.key !== 'tenues').reduce((t, x) => t + x.items.length, 0), 'les tenues ne comptent pas comme urgentes');
});

test('relances : pas avant 3 jours ni après une relance récente ; licence : 7 jours', () => {
  const s = buildTodo(
    [
      row({ created_at: RECENT }),
      row({ last_reminder_at: RECENT }),
      row({ ...COMPLETE, licence_demandee_at: RECENT }),
      row({ ...COMPLETE, licence_demandee_at: OLD, licence_relance_at: RECENT }),
    ],
    { now: NOW }
  );
  assert.equal(find(s, 'relances').length, 0);
  assert.equal(find(s, 'licence_relance').length, 0);
});

test('page : organisation de la session uniquement, noms échappés, rien à traiter', async () => {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  const cookie = (await createSession(env, DEMO_ORG_ID)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const get = async () => (await page.onRequestGet({ request: new Request('https://club-exemple.example/admin/a-traiter', { headers: { Cookie: cookie } }), env })).text();
  assert.match(await get(), /Rien à traiter/);
  await seedInscription(env.DB, { enfant_prenom: '<b>Zoé</b>', enfant_nom: 'X', dossier_uploaded_at: OLD, dossier_status: null });
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_autre', 'autre', 'Autre')").run();
  const other = await seedInscription(env.DB, { enfant_prenom: 'Secret', enfant_nom: 'Autre', email: 'o@example.fr', dossier_uploaded_at: OLD });
  await env.DB.prepare("UPDATE inscriptions SET organization_id = 'org_autre' WHERE id = ?").bind(other.id).run();
  const html = await get();
  assert.match(html, /Dossiers signés à vérifier/);
  assert.ok(html.includes('&lt;b&gt;Zoé&lt;/b&gt;'));
  assert.doesNotMatch(html, /Secret/);
});
