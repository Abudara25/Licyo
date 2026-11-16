// Transfert de pré-inscriptions vers une catégorie d'inscription (2026-11-09) : sélection, écran de confirmation,
// création proposée de la catégorie manquante, fiche créée « à compléter », décompte du groupe inchangé, étape
// « Coordonnées et autorisations » de l'espace famille, cas limites (déjà inscrit, retour de corbeille, taille manquante).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../functions/api/preinscriptions.js';
import * as admin from '../functions/admin/preinscriptions.js';
import { onRequestGet as depotGet } from '../functions/depot/[token].js';
import { onRequestPost as infosPost } from '../functions/depot/[token]/infos.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { countPreinscriptions } from '../functions/_shared/preinscriptions.js';
import { isInscriptionComplete, familyHasActionPending, hasFamilyDetails } from '../functions/_shared/inscriptions-db.js';
import { COMPLETE_INSCRIPTION_SQL } from '../functions/_shared/crm.js';
import { issueFamilyLink } from '../functions/_shared/family-links.js';
import { buildPreinscriptionTransferEmail } from '../functions/_shared/confirmation-email.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const HOST = 'https://club-exemple.example';

async function setup() {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const postAdmin = async (fields, ids = []) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, String(v));
    for (const id of ids) body.append('ids', String(id));
    const waits = [];
    const res = await admin.onRequestPost({ request: new Request(`${HOST}/admin/preinscriptions`, { method: 'POST', body, headers: { Cookie: cookie } }), env, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return res;
  };
  const getAdmin = async (q = '') => (await admin.onRequestGet({ request: new Request(`${HOST}/admin/preinscriptions${q}`, { headers: { Cookie: cookie } }), env })).text();
  return { env, postAdmin, getAdmin };
}

let ip = 0;
const child = (n, extra = {}) => ({
  enfantPrenom: `Enfant${n}`, enfantNom: 'Fictif', naissance: '2017-03-0' + ((n % 9) + 1), paysNaissance: 'France', villeNaissance: 'Argenteuil', cpNaissance: '95100', tailleMaillot: '10 ans',
  parentPrenom: 'Parent', parentNom: 'Fictif', email: `p${n}@example.fr`, telephone: '0600000000', rgpd: true, ...extra,
});
async function preinscrire(env, body) {
  const waits = [];
  const res = await api.onRequestPost({
    request: new Request(`${HOST}/api/preinscriptions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `203.0.113.${(ip++ % 250) + 1}` }, body: JSON.stringify(body) }),
    env,
    waitUntil: (p) => waits.push(p),
  });
  await Promise.all(waits);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
}
const prein = (env) => env.DB.prepare('SELECT * FROM preinscriptions WHERE organization_id = ? ORDER BY id').bind(A).all().then((r) => r.results);

test('transfert : catégorie U10 proposée puis créée, fiches « à compléter », décompte 7 / 15 inchangé', async () => {
  const { env, postAdmin, getAdmin } = await setup();
  for (let n = 1; n <= 7; n += 1) await preinscrire(env, child(n));
  assert.equal(await countPreinscriptions(env.DB, A, 'U10'), 7);
  const rows = await prein(env);

  let page = await getAdmin('?groupe=U10');
  assert.match(page, /id="prein-transfer"/);
  assert.match(page, /name="ids" value="\d+" form="prein-transfer"/);
  assert.match(page, /data-check-all="prein-transfer"/);

  // Écran de confirmation : rien n'est écrit, la catégorie manquante est proposée.
  const preview = await (await postAdmin({ action: 'transfer-preview', groupe: 'U10' }, rows.slice(0, 3).map((r) => r.id))).text();
  assert.match(preview, /3 enfants sélectionnés/);
  assert.match(preview, /catégorie à créer/);
  assert.match(preview, /name="createCategory" value="1" checked/);
  assert.match(preview, /Transférer 3 enfants/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 0, 'aperçu : aucune fiche');
  assert.ok(!(await getCategoriesConfig(env, A)).categories.some((c) => c.label === 'U10'), 'aperçu : aucune catégorie');

  // Sans créer la catégorie : rien n'est transféré.
  let res = await postAdmin({ action: 'transfer', groupe: 'U10', notify: 1 }, rows.slice(0, 3).map((r) => r.id));
  assert.match(decodeURIComponent(res.headers.get('Location')), /bilanError=1/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 0);

  res = await postAdmin({ action: 'transfer', groupe: 'U10', createCategory: 1, notify: 1 }, rows.slice(0, 3).map((r) => r.id));
  const location = decodeURIComponent(res.headers.get('Location'));
  assert.match(location, /Catégorie créée : U10/);
  assert.match(location, /3 fiches d’inscription créées/);
  const cat = (await getCategoriesConfig(env, A)).categories.find((c) => c.label === 'U10');
  assert.ok(cat && cat.active !== false && cat.anneeMin === 2017 && cat.anneeMax === 2017);

  const created = (await env.DB.prepare("SELECT * FROM inscriptions WHERE organization_id = ? AND categorie = 'U10' ORDER BY id").bind(A).all()).results;
  assert.equal(created.length, 3);
  for (const row of created) {
    assert.equal(row.infos_famille_requises, 1);
    assert.equal(row.autorisation, 0);
    assert.equal(row.rgpd, 0);
    assert.equal(row.mode_paiement, null);
    assert.equal(row.ville_naissance, 'Argenteuil', 'lieu de naissance repris');
    assert.equal(row.cp_naissance, '95100', 'code postal de naissance repris');
    assert.equal(row.taille_maillot, '10 ans', 'taille reprise');
    assert.ok(row.upload_token);
    assert.equal(hasFamilyDetails(row), false);
    assert.equal(familyHasActionPending(row), true);
  }
  const after = await prein(env);
  assert.deepEqual(after.slice(0, 3).map((r) => r.inscription_id), created.map((r) => r.id), 'pré-inscriptions rattachées');
  assert.equal(after.length, 7, 'aucune pré-inscription supprimée');
  assert.equal(await countPreinscriptions(env.DB, A, 'U10'), 7, '7 / 15 après le transfert');

  page = await getAdmin('?groupe=U10');
  assert.match(page, /7<small> \/ 15<\/small>/);
  assert.match(page, /Transféré\(e\) en inscription/);
  assert.doesNotMatch(page, /Aussi dans les inscriptions/, 'pas signalé comme doublon');
  assert.equal((page.match(/form="prein-transfer"/g) || []).length, 4, 'case seulement sur les 4 restants');

  // Rejouer le même envoi : rien de recréé.
  res = await postAdmin({ action: 'transfer', groupe: 'U10', createCategory: 1, notify: 1 }, rows.slice(0, 3).map((r) => r.id));
  assert.match(decodeURIComponent(res.headers.get('Location')), /déjà transféré/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 3);

  // Catégorie existante : plus de proposition de création.
  const preview2 = await (await postAdmin({ action: 'transfer-preview', groupe: 'U10' }, [rows[3].id])).text();
  assert.doesNotMatch(preview2, /name="createCategory"/);
  assert.match(preview2, /<strong>U10<\/strong>/);
});

test('transfert : enfant déjà inscrit rattaché, fiche du transfert inverse restaurée, taille manquante refusée, identifiant inconnu ignoré', async () => {
  const { env, postAdmin } = await setup();
  await preinscrire(env, child(1));
  await preinscrire(env, child(2));
  await preinscrire(env, child(3));
  const rows = await prein(env);
  // 1 : déjà inscrit (fiche active, même enfant).
  const active = await seedInscription(env.DB, { enfant_prenom: 'Enfant1', enfant_nom: 'Fictif', naissance: rows[0].naissance, email: 'autre@example.fr', categorie: 'U8 - U9' });
  // 2 : fiche mise à la corbeille par un transfert inverse (même e-mail) : restaurée avec ses données.
  const archived = await seedInscription(env.DB, { enfant_prenom: 'Enfant2', enfant_nom: 'Fictif', naissance: rows[1].naissance, email: 'p2@example.fr', adresse: '1 rue Fictive', archived_at: '2026-10-08 10:00:00', archive_motif: 'preinscription' });
  // 3 : taille manquante (ancienne pré-inscription).
  await env.DB.prepare('UPDATE preinscriptions SET taille_maillot = NULL WHERE id = ?').bind(rows[2].id).run();

  const res = await postAdmin({ action: 'transfer', groupe: 'U10', createCategory: 1 }, [...rows.map((r) => r.id), 999999]);
  const location = decodeURIComponent(res.headers.get('Location'));
  assert.match(location, /1 fiche restaurée/);
  assert.match(location, /1 enfant déjà inscrit rattaché/);
  assert.match(location, /Enfant3 Fictif \(taille de tenue à compléter\)/);
  const after = await prein(env);
  assert.equal(after[0].inscription_id, active.id);
  assert.equal(after[1].inscription_id, archived.id);
  assert.equal(after[2].inscription_id, null);
  const restored = await env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(archived.id).first();
  assert.equal(restored.archived_at, null);
  assert.equal(restored.categorie, 'U10');
  assert.equal(restored.adresse, '1 rue Fictive', 'données conservées');
  assert.equal(restored.infos_famille_requises, 0);
  assert.equal((await env.DB.prepare('SELECT categorie FROM inscriptions WHERE id = ?').bind(active.id).first()).categorie, 'U8 - U9', 'fiche active non modifiée');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 2, 'aucune fiche créée');
});

test('espace famille : étape « Coordonnées et autorisations », champs obligatoires, puis inscription complète', async () => {
  const { env, postAdmin } = await setup();
  await preinscrire(env, child(1));
  await postAdmin({ action: 'transfer', groupe: 'U10', createCategory: 1 }, (await prein(env)).map((r) => r.id));
  const row = await env.DB.prepare("SELECT * FROM inscriptions WHERE categorie = 'U10'").first();
  // Le club a validé le reste : seules les informations de la famille manquent.
  await env.DB.prepare("UPDATE inscriptions SET paye = 1, photo_uploaded_at = '2026-11-09 10:00:00', dossier_uploaded_at = '2026-11-09 10:00:00', dossier_status = 'valide' WHERE id = ?").bind(row.id).run();
  assert.equal(isInscriptionComplete(await env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(row.id).first()), false);
  const sql = `SELECT COUNT(*) AS n FROM inscriptions i WHERE i.id = ? AND ${COMPLETE_INSCRIPTION_SQL}`;
  assert.equal((await env.DB.prepare(sql).bind(row.id).first()).n, 0, 'SQL : pas complète non plus');

  const token = await issueFamilyLink(env.DB, A, row.id);
  const page = async () => (await depotGet({ request: new Request(`${HOST}/depot/${token}`), env, params: { token } })).text();
  const post = (fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return infosPost({ request: new Request(`${HOST}/depot/${token}/infos`, { method: 'POST', body: form, headers: { Origin: HOST } }), env, params: { token }, waitUntil: () => {} });
  };
  let html = await page();
  assert.match(html, /Dossier : 4 étapes sur 5/);
  assert.match(html, /id="infos"/);
  assert.match(html, /name="autorisation" value="1" required/);
  assert.match(html, /name="rgpd" value="1" required/);
  assert.match(html, /name="droitImage" value="1"/);

  const valid = { adresse: '2 rue Fictive', codePostal: '99999', ville: 'Demoville', modePaiement: 'Chèque', autorisation: '1', rgpd: '1' };
  assert.match((await post({ ...valid, rgpd: '' })).headers.get('Location'), /infosError=/, 'RGPD obligatoire');
  assert.match((await post({ ...valid, codePostal: '952' })).headers.get('Location'), /infosError=/);
  assert.match((await post({ ...valid, modePaiement: 'Bitcoin' })).headers.get('Location'), /infosError=/);
  assert.equal((await env.DB.prepare('SELECT autorisation FROM inscriptions WHERE id = ?').bind(row.id).first()).autorisation, 0, 'rien écrit');

  assert.match((await post(valid)).headers.get('Location'), /infosOk=1#infos$/);
  const saved = await env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.deepEqual([saved.adresse, saved.code_postal, saved.ville, saved.mode_paiement, saved.autorisation, saved.rgpd, saved.droit_image], ['2 rue Fictive', '99999', 'Demoville', 'Chèque', 1, 1, 0]);
  assert.equal(isInscriptionComplete(saved), true);
  assert.equal((await env.DB.prepare(sql).bind(row.id).first()).n, 1);
  html = await page();
  assert.match(html, /Dossier : 5 étapes sur 5/);
  assert.match(html, /Rien à faire pour le moment|Tout est en ordre/);
});

test('fiche ordinaire : règle « complet » et page famille inchangées ; e-mail de transfert', () => {
  const ordinary = { infos_famille_requises: 0, autorisation: 1, rgpd: 1, mode_paiement: null, paye: 1, photo_uploaded_at: 'x', dossier_uploaded_at: 'x', dossier_status: 'valide', ville_naissance: 'A', pays_naissance: 'France' };
  assert.equal(hasFamilyDetails(ordinary), true);
  assert.equal(isInscriptionComplete(ordinary), true);
  assert.equal(hasFamilyDetails({ infos_famille_requises: undefined }), true, 'colonne absente = ancienne fiche');

  const mail = buildPreinscriptionTransferEmail(
    { enfant_prenom: 'Léa', enfant_nom: 'Fictif', categorie: 'U10', parent_prenom: 'Camille', parent_nom: 'Fictif', email: 'c@example.fr', family_link: 'fABC', infos_famille_requises: 1, autorisation: 0, rgpd: 0, ville_naissance: 'A', pays_naissance: 'France' },
    HOST
  );
  assert.match(mail.subject, /Une place pour Léa en U10/);
  assert.match(mail.text, /autorisations/);
  assert.match(mail.text, /\/depot\/fABC/);
  assert.match(mail.text, /définitive une fois l'adhésion réglée et la licence/);
  assert.doesNotMatch(mail.text, /lieu de naissance/, 'lieu déjà connu : pas demandé');
});
