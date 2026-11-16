// Import des paiements HelloAsso (2026-11-13) : lecture de l'export (balises préfixées <x:…>), rapprochement,
// paiement en plusieurs fois, Tap to pay rattaché à la main, anti-doublon, isolation par organisation, versement
// supprimé reproposé. Fichiers construits ici, aucune donnée réelle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { readXlsxRows } from '../functions/_shared/footclubs-import.js';
import { helloAssoRecords, planHelloAssoImport, sanitizeLines, parseChoice, XlsxFileError } from '../functions/_shared/helloasso-import.js';
import { buildOverview } from '../functions/admin/dashboard.js';
import * as importPage from '../functions/admin/helloasso.js';
import * as fiche from '../functions/admin/inscriptions/[id].js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { xlsx } from './helpers/xlsx.mjs';

const A = DEMO_ORG_ID;
const HOST = 'https://club-exemple.example';
const HEADER = ['Référence commande', 'Référence paiement', 'Montant total', 'Date du paiement', 'Statut du paiement', 'Nom payeur', 'Prénom payeur', 'Email payeur', 'Campagne', 'Type de campagne', 'Type', 'Moyen de paiement'];
// Dates Excel : 46274 = 2026-09-09, 46297 = 2026-10-02, 46303 = 2026-10-08, 46328 = 2026-11-02, 46338 = 2026-11-12.
const plan = (ref, serial, nom = 'Martin', prenom = 'Paul', email = 'parent@example.fr') => ['5001', ref, '60', serial, 'Payé', nom, prenom, email, 'Adhésion U8/U9', 'Adhésion', 'Paiement en plusieurs fois', 'Carte bancaire'];
const tap = (ref, amount, serial, type = 'Autre') => ['6' + ref, ref, amount, serial, 'Payé', 'N/A', 'N/A', 'N/A', 'Solde Tap to pay', type, 'Paiement unique', 'Carte bancaire'];

test('lecture de l’export HelloAsso : balises préfixées, dates Excel, N/A, statut non payé', async () => {
  const bytes = await xlsx([HEADER, plan('101', '46274.58'), tap('201', '130', '46338.76'), ['7', '301', '60', '46300.1', 'Remboursé', 'Doe', 'Jo', 'j@x.fr', 'Adhésion', 'Adhésion', 'Paiement unique', 'Carte bancaire'], ['', 'abc def', '60', '46300', 'Payé']], { prefix: 'x' });
  const { records, invalid } = helloAssoRecords(await readXlsxRows(bytes));
  assert.equal(invalid, 1, 'référence illisible');
  assert.equal(records.length, 3);
  assert.deepEqual([records[0].ref, records[0].order, records[0].cents, records[0].date, records[0].plan, records[0].tap], ['101', '5001', 6000, '2026-09-09', true, false]);
  assert.deepEqual([records[1].payer, records[1].email, records[1].tap, records[1].cents, records[1].date], [null, '', true, 13000, '2026-11-12']);
  assert.equal(records[2].paid, false);
  await assert.rejects(async () => helloAssoRecords(await readXlsxRows(await xlsx([['Nom', 'Prénom', 'Ville'], ['a', 'b', 'c']]))), /Colonnes introuvables/);
  await assert.rejects(readXlsxRows(new TextEncoder().encode('a;b'), { hint: 'exportez-le depuis HelloAsso au format Excel.' }), (e) => e instanceof XlsxFileError && /HelloAsso/.test(e.message));
});

test('rapprochement : commande, e-mail, nom, fratrie ambiguë, Tap to pay déjà saisi, don écarté', () => {
  const rows = [
    { id: 1, enfant_prenom: 'Léo', enfant_nom: 'Martin', parent_prenom: 'Paul', parent_nom: 'Martin', email: 'parent@example.fr' },
    { id: 2, enfant_prenom: 'Zoé', enfant_nom: 'Durand', parent_prenom: 'Anne', parent_nom: 'Durand', email: 'anne@example.fr' },
    { id: 3, enfant_prenom: 'Lou', enfant_nom: 'Durand', parent_prenom: 'Anne', parent_nom: 'Durand', email: 'anne@example.fr' },
    { id: 4, enfant_prenom: 'Sam', enfant_nom: 'Petit', parent_prenom: 'Eva', parent_nom: 'Petit', email: 'eva@example.fr', montant_recu_cents: 6000, dernier_versement_at: '2026-10-05 12:00:00' },
  ];
  const rec = (o) => ({ ref: '1', order: '', cents: 6000, date: '2026-10-09', paid: true, payer: null, email: '', plan: false, tap: false, adhesion: false, typeCampagne: 'Autre', campagne: '', ...o });
  const { lines } = planHelloAssoImport(
    [
      rec({ ref: 'a', order: '9', payer: { nom: 'Martin', prenom: 'Paul' }, email: 'parent@example.fr', plan: true, adhesion: true }),
      rec({ ref: 'b', payer: { nom: 'Durand', prenom: 'Anne' }, email: 'anne@example.fr', adhesion: true }),
      rec({ ref: 'c', payer: { nom: 'Lou', prenom: 'Durand' }, email: 'autre@example.fr', adhesion: true }),
      rec({ ref: 'd', tap: true }),
      rec({ ref: 'e', tap: true, cents: 100, typeCampagne: 'Don' }),
      rec({ ref: 'f', tap: true, cents: 9900 }),
    ],
    rows
  );
  const by = Object.fromEntries(lines.map((l) => [l.ref, l.choice]));
  assert.equal(by.a, 'add:1', 'nom et e-mail du payeur');
  assert.equal(by.b, '', 'deux enfants avec le même e-mail : au club de choisir');
  assert.equal(by.c, 'add:3', 'nom de l’enfant en payeur (prénom et nom inversés)');
  assert.equal(by.d, 'link:4', 'Tap to pay du même montant déjà saisi à la main');
  assert.equal(by.e, 'ignore', 'don : pas une adhésion');
  assert.equal(by.f, '', 'Tap to pay sans correspondance');

  // Une commande déjà rattachée propose la même fiche pour ses échéances suivantes, même sans nom.
  const next = planHelloAssoImport([rec({ ref: 'z', order: '9' })], rows, [{ payment_ref: 'a', order_ref: '9', status: 'applied', inscription_id: 1 }]);
  assert.equal(next.lines[0].choice, 'add:1');
  assert.deepEqual(parseChoice('add:12'), { action: 'add', id: 12 });
  assert.deepEqual(parseChoice('<script>'), { action: 'later' });
  assert.equal(sanitizeLines('[{"ref":"1","cents":-5,"date":"2026-10-01","kind":"tap"}]'), null);
  assert.equal(sanitizeLines('[{"ref":"1","cents":500,"date":"2999-10-01","kind":"tap"}]'), null, 'date future');
  assert.equal(sanitizeLines('[{"ref":"1","cents":500,"date":"2026-10-01","kind":"autre"}]'), null);
});

async function setup() {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const post = async (fields, file) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    if (file) body.set('fichier', new File([file], 'export.xlsx'));
    const waits = [];
    const res = await importPage.onRequestPost({ request: new Request(`${HOST}/admin/helloasso`, { method: 'POST', headers: { Cookie: cookie }, body }), env, waitUntil: (p) => waits.push(p.catch(() => {})) });
    await Promise.all(waits);
    return res;
  };
  // Récapitulatif → confirmation avec les choix donnés (index des lignes « à rattacher » dans l'ordre affiché).
  const importFile = async (file, choose) => {
    const preview = await (await post({ action: 'preview' }, file)).text();
    const lignes = /name="lignes" value="([^"]*)"/.exec(preview)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const traites = /name="traites" value="([^"]*)"/.exec(preview)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const selected = [...preview.matchAll(/<select id="(choix-\d+)"[\s\S]*?<\/select>/g)].map((m) => [m[1], /<option value="([^"]*)" selected>/.exec(m[0])?.[1] ?? '']);
    const fields = { action: 'apply', lignes, traites, ...Object.fromEntries(selected), ...choose(JSON.parse(lignes)) };
    return { preview, res: await post(fields) };
  };
  const read = (id) => env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(id).first();
  return { env, cookie, post, importFile, read };
}

test('import : échéances ajoutées à la fiche, Tap to pay rattaché à la main, réimport sans doublon', async () => {
  const { env, importFile, read } = await setup();
  const martin = await seedInscription(env.DB, { enfant_prenom: 'Léo', enfant_nom: 'Martin', parent_prenom: 'Paul', parent_nom: 'Martin', email: 'parent@example.fr', mode_paiement: 'HelloAsso', paye: 1 });
  const naim = await seedInscription(env.DB, { enfant_prenom: 'Naïm', enfant_nom: 'Ali', parent_prenom: 'Sara', parent_nom: 'Ali', email: 'sara@example.fr', naissance: '2018-03-02', mode_paiement: 'Carte bancaire' });
  const autre = await seedInscription(env.DB, { organization_id: 'org_b_test', enfant_prenom: 'Léo', enfant_nom: 'Martin', email: 'parent@example.fr' }).catch(() => null);

  const file = await xlsx([HEADER, plan('101', '46274.58'), plan('102', '46297.13'), tap('201', '60', '46303.76'), tap('301', '1', '46298.66', 'Don')], { prefix: 'x' });
  const { preview, res } = await importFile(file, (lignes) => {
    const i = lignes.findIndex((l) => l.ref === '201');
    return { [`choix-${i}`]: `add:${naim.id}` };
  });
  assert.match(preview, /4 paiements encaissés/);
  assert.match(preview, /Sans nom \(Tap to pay\)/);
  assert.equal(res.status, 303);
  assert.match(res.headers.get('Location'), /ajoutes=3.*ecartes=1/);

  const m = await read(martin.id);
  assert.deepEqual([m.paye, m.montant_recu_cents, m.montant_du_cents, m.dernier_versement_at], [1, 12000, 18000, '2026-10-02 12:00:00'], 'fiche payée gardée payée, échéances cumulées');
  const n = await read(naim.id);
  assert.deepEqual([n.paye, n.montant_recu_cents, n.montant_du_cents], [0, 6000, 18000], 'Tap to pay : acompte');
  const entries = (await env.DB.prepare('SELECT inscription_id, amount_cents, mode, paid_on FROM payment_entries ORDER BY id').all()).results;
  assert.deepEqual(entries.map((e) => [e.inscription_id, e.amount_cents, e.mode, e.paid_on]), [
    [martin.id, 6000, 'HelloAsso (en plusieurs fois)', '2026-09-09'],
    [martin.id, 6000, 'HelloAsso (en plusieurs fois)', '2026-10-02'],
    [naim.id, 6000, 'Carte bancaire (Tap to pay)', '2026-10-08'],
  ]);
  if (autre) assert.equal((await read(autre.id)).montant_recu_cents, null, 'autre organisation intacte');

  // Même fichier + troisième échéance : seule la nouvelle est proposée, à la même fiche (même commande).
  const again = await xlsx([HEADER, plan('101', '46274.58'), plan('102', '46297.13'), plan('103', '46328.21'), tap('201', '60', '46303.76'), tap('301', '1', '46298.66', 'Don')], { prefix: 'x' });
  const second = await importFile(again, () => ({}));
  assert.match(second.preview, /1 paiement à rattacher/);
  assert.match(second.preview, /4 paiements déjà traités/);
  assert.match(second.res.headers.get('Location'), /ajoutes=1/);
  assert.equal((await read(martin.id)).montant_recu_cents, 18000);

  // Rejouer la même confirmation (double clic, retour arrière) n'ajoute rien.
  const replay = await importFile(again, () => ({}));
  assert.match(replay.res.headers.get('Location'), /ajoutes=0/);
  assert.equal((await read(martin.id)).montant_recu_cents, 18000);
});

test('paiement en plusieurs fois sur une fiche non payée : payée dès la 1re échéance ; Vue d’ensemble : échéances à venir', async () => {
  const { env, importFile, read } = await setup();
  const row = await seedInscription(env.DB, { enfant_prenom: 'Léo', enfant_nom: 'Martin', parent_prenom: 'Paul', parent_nom: 'Martin', email: 'parent@example.fr', mode_paiement: 'HelloAsso' });
  await importFile(await xlsx([HEADER, plan('101', '46274.58')]), () => ({}));
  const r = await read(row.id);
  assert.deepEqual([r.paye, r.montant_recu_cents], [1, 6000]);
  const o = buildOverview([r], { prix: 180 });
  assert.equal(o.finance.received, 6000, 'seule l’échéance reçue est encaissée');
  assert.deepEqual(o.finance.installments, { count: 1, cents: 12000 });
});

test('versement importé supprimé de la fiche : reproposé au prochain import ; « déjà saisi » remis à décider', async () => {
  const { env, cookie, importFile, read } = await setup();
  const row = await seedInscription(env.DB, { enfant_prenom: 'Naïm', enfant_nom: 'Ali', email: 'sara@example.fr', mode_paiement: 'Carte bancaire' });
  const file = await xlsx([HEADER, tap('201', '60', '46303.76'), tap('202', '60', '46304.5')]);
  const at = (lignes, ref) => `choix-${lignes.findIndex((l) => l.ref === ref)}`;
  await importFile(file, (lignes) => ({ [at(lignes, '201')]: `link:${row.id}`, [at(lignes, '202')]: `add:${row.id}` }));
  assert.equal((await read(row.id)).montant_recu_cents, 6000, 'le lien seul n’ajoute rien');

  const entry = await env.DB.prepare('SELECT id FROM payment_entries WHERE inscription_id = ?').bind(row.id).first();
  const body = new FormData();
  body.set('action', 'versement-suppression');
  body.set('entree', String(entry.id));
  const del = await fiche.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { method: 'POST', headers: { Cookie: cookie }, body }), env, params: { id: String(row.id) }, waitUntil: () => {} });
  assert.match(del.headers.get('Location'), /suppressionOk=1/);

  const { preview } = await importFile(file, () => ({}));
  assert.match(preview, /1 paiement à rattacher/, 'le versement supprimé est reproposé');
  const traites = JSON.parse(/name="traites" value="([^"]*)"/.exec(preview)[1].replace(/&quot;/g, '"'));
  assert.deepEqual(traites.map((l) => l.ref), ['201'], '« déjà saisi » reste traité');
  const reset = await importFile(file, () => ({ 'reset-0': '1' }));
  assert.match(reset.res.headers.get('Location'), /remis=1/);
  assert.match((await importFile(file, () => ({}))).preview, /2 paiements à rattacher/);
});

test('page réservée à l’admin connecté', async () => {
  const { env } = await setup();
  const res = await importPage.onRequestGet({ request: new Request(`${HOST}/admin/helloasso`), env });
  assert.match(await res.text(), /type="password"/);
});
