// Import de l'export Footclubs (2026-11-04) : lecture .xlsx sans dépendance, rapprochement, récapitulatif, application
// après confirmation, isolation par organisation. Le fichier de test est construit ici (aucune donnée réelle).
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { readXlsxRows, footclubsRecords, planFootclubsImport, missingDocs, sanitizeTargets, FootclubsFileError } from '../functions/_shared/footclubs-import.js';
import { licenceStage } from '../functions/_shared/club-followup.js';
import * as importPage from '../functions/admin/adherents/footclubs.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { xlsx, zip } from './helpers/xlsx.mjs';

const A = DEMO_ORG_ID;
const HOST = 'https://club-exemple.example';
const enc = new TextEncoder();

const HEADER = ['Nom', 'Prénom', 'Numéro personne', 'Type', 'Statut', 'Pièces manquantes', 'Email', 'Date de naissance'];

test('lecture .xlsx : chaînes partagées et en ligne, compression ou non, dates texte et numériques', async () => {
  for (const compress of [true, false]) {
    const bytes = await xlsx([HEADER, ['Durand', 'Léa', '2547896541', 'Joueur', 'Prise de contact', '', 'x@y.fr', '29/02/2020'], ['Petit', 'Inès', '', 'Joueur', 'Contrôle à effectuer', '', '', 43891]], { compress });
    const recs = footclubsRecords(await readXlsxRows(bytes));
    assert.equal(recs.length, 2);
    assert.deepEqual({ ...recs[0], email: undefined }, { nom: 'Durand', prenom: 'Léa', naissance: '2020-02-29', type: 'Joueur', statut: 'Prise de contact', pieces: '', numero: '2547896541', email: undefined });
    assert.equal(recs[1].naissance, '2020-03-01', 'date Excel numérique');
    assert.equal('email' in recs[0], false, 'colonnes non lues');
  }
});

test('fichiers refusés proprement : pas un xlsx, colonnes absentes, ZIP tronqué', async () => {
  await assert.rejects(readXlsxRows(enc.encode('Nom;Prénom\n')), FootclubsFileError);
  await assert.rejects(async () => footclubsRecords(await readXlsxRows(await xlsx([['A', 'B', 'C'], ['1', '2', '3']]))), /Colonnes introuvables/);
  const bytes = await xlsx([HEADER, ['a', 'b', '1', 'Joueur', 'Prise de contact', '', '', '01/01/2020']]);
  await assert.rejects(readXlsxRows(bytes.subarray(0, bytes.length - 30)), FootclubsFileError);
});

test('pièces manquantes : libellés Footclubs reconnus, « photocopie » n’est pas la photo', () => {
  assert.deepEqual(missingDocs("Photocopie d'une pièce officielle d'identité").docs, ['docIdentite']);
  assert.deepEqual(missingDocs('Photo ; Certificat médical').docs.sort(), ['docCertificat', 'docPhoto']);
  assert.deepEqual(missingDocs('Questionnaire de santé').docs, ['docSante']);
  assert.deepEqual(missingDocs('Livret de famille'), { docs: [], unknown: ['Livret de famille'] });
});

test('rapprochement : nom/prénom/naissance (accents et casse ignorés), dirigeants ignorés, inconnus et ambigus signalés', () => {
  const rows = [
    { id: 1, enfant_prenom: 'Léa', enfant_nom: 'Durand', naissance: '2020-02-29' },
    { id: 2, enfant_prenom: 'Noah', enfant_nom: 'Martin', naissance: '2019-05-01', licence_doc_identite: 'manquant' },
    { id: 3, enfant_prenom: 'Sam', enfant_nom: 'Roy', naissance: '2018-01-01' },
    { id: 4, enfant_prenom: 'Sam', enfant_nom: 'Roy', naissance: '2018-01-01' },
    { id: 5, enfant_prenom: 'Inès', enfant_nom: 'Petit', naissance: '2019-03-03', numero_licence: '111' },
  ];
  const rec = (prenom, nom, naissance, statut, extra = {}) => ({ prenom, nom, naissance, statut, type: 'Joueur', pieces: '', numero: '', ...extra });
  const plan = planFootclubsImport(
    [
      rec('LEA', 'durand', '2020-02-29', 'Contrôle à effectuer', { pieces: "Photocopie d'une pièce officielle d'identité", numero: '2547896541' }),
      rec('Noah', 'Martin', '2019-05-01', 'Attestation licence créée'),
      rec('Sam', 'Roy', '2018-01-01', 'Prise de contact'),
      rec('Zoé', 'Inconnue', '2020-01-01', 'Prise de contact'),
      rec('X', 'Y', '2020-01-01', 'Prise de contact', { type: 'Dirigeant' }),
      rec('Inès', 'Petit', '2019-03-03', 'Statut jamais vu', { numero: '222' }),
    ],
    rows
  );
  assert.equal(plan.ignored, 1);
  assert.deepEqual(plan.notFound.map((r) => r.label), ['Zoé Inconnue']);
  assert.deepEqual(plan.ambiguous.map((r) => r.label), ['Sam Roy']);
  assert.deepEqual(plan.unknownStatus.map((r) => r.statut), ['Statut jamais vu']);
  const lea = plan.updates.find((u) => u.id === 1);
  assert.equal(lea.after, 'a_verifier');
  assert.equal(lea.target.docs.docIdentite, 'manquant');
  assert.equal(lea.target.numero, '2547896541');
  const noah = plan.updates.find((u) => u.id === 2);
  assert.equal(noah.after, 'validee');
  assert.equal(noah.target.docs.docIdentite, '', 'plus signalée manquante');
});

test('le n° de licence seul ne vaut pas « validée » (il existe dès la demande sur Footclubs)', () => {
  assert.equal(licenceStage({ numero_licence: '2547896541', licence_demandee_at: 'x' }), 'attente_famille');
  assert.equal(licenceStage({ numero_licence: '2547896541', licence_validee_at: 'x' }), 'validee');
});

test('confirmation : cibles revérifiées, valeurs hors liste refusées', () => {
  assert.equal(sanitizeTargets('pas du json'), null);
  assert.equal(sanitizeTargets(JSON.stringify([{ id: 'x', target: {} }])), null);
  assert.equal(sanitizeTargets(JSON.stringify([{ id: 1, target: { docs: { docPhoto: 'DROP TABLE' } } }])), null);
  assert.equal(sanitizeTargets(JSON.stringify([{ id: 1, target: { docs: { docPhoto: 'non_requis' } } }])), null, 'non requis : certificat seulement');
  const [t] = sanitizeTargets(JSON.stringify([{ id: 1, target: { steps: { licenceDemandee: true, autre: true }, numero: '123', statut: 'Prise\nde contact' } }]));
  assert.equal(t.steps.licenceDemandee, true);
  assert.equal('autre' in t.steps, false);
  assert.equal(t.statut, 'Prisede contact');
});

test('page : dépôt → récapitulatif → application, organisation de la session uniquement', async () => {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  const lea = await seedInscription(env.DB, { enfant_prenom: 'Léa', enfant_nom: 'Durand', naissance: '2020-02-29' });
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_autre', 'autre', 'Autre')").run();
  const other = await seedInscription(env.DB, { enfant_prenom: 'Léa', enfant_nom: 'Durand', naissance: '2020-02-29', email: 'autre@example.fr' });
  await env.DB.prepare("UPDATE inscriptions SET organization_id = 'org_autre' WHERE id = ?").bind(other.id).run();
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const post = (body) => importPage.onRequestPost({ request: new Request(`${HOST}/admin/adherents/footclubs`, { method: 'POST', body, headers: { Cookie: cookie } }), env });

  const body = new FormData();
  body.set('action', 'preview');
  body.set('fichier', new File([await xlsx([HEADER, ['Durand', 'Léa', '2547896541', 'Joueur', 'En attente validation ligue', '', '', '29/02/2020'], ['<b>Bad</b>', 'X', '', 'Joueur', 'Prise de contact', '', '', '01/01/2020']])], 'export_dossier.xlsx'));
  const preview = await (await post(body)).text();
  assert.match(preview, /1 fiche à mettre à jour/);
  assert.match(preview, /Attente FFF/);
  assert.ok(preview.includes('&lt;b&gt;Bad&lt;/b&gt;'), 'nom du fichier échappé');
  const before = await env.DB.prepare('SELECT licence_verif_at FROM inscriptions WHERE id = ?').bind(lea.id).first();
  assert.equal(before.licence_verif_at, null, 'rien d’écrit avant confirmation');

  const cibles = /name="cibles" value="([^"]+)"/.exec(preview)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const parsed = JSON.parse(cibles);
  parsed.push({ id: other.id, target: parsed[0].target }); // fiche d'une autre organisation glissée dans la confirmation
  const apply = new FormData();
  apply.set('action', 'apply');
  apply.set('cibles', JSON.stringify(parsed));
  const res = await post(apply);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), '/admin/adherents?footclubs=1');
  const r = await env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(lea.id).first();
  assert.equal(licenceStage(r), 'attente_fff');
  assert.equal(r.numero_licence, '2547896541');
  assert.equal(r.licence_footclubs_statut, 'En attente validation ligue');
  assert.ok(r.licence_footclubs_at);
  const o = await env.DB.prepare('SELECT licence_verif_at, numero_licence FROM inscriptions WHERE id = ?').bind(other.id).first();
  assert.equal(o.licence_verif_at, null, 'autre organisation intacte');
  assert.equal(o.numero_licence, null);

  const bad = new FormData();
  bad.set('action', 'preview');
  bad.set('fichier', new File([enc.encode('pas un excel')], 'x.xlsx'));
  const err = await post(bad);
  assert.equal(err.status, 400);
  assert.match(await err.text(), /n’est pas un fichier Excel/);
});
