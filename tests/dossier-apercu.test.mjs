// Vérification du dossier depuis l'aperçu du document : valider ou refuser à côté du document, puis enchaîner sur le
// dossier suivant à vérifier (le plus ancien reçu) ; fin de série = retour à la fiche avec un message.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as apercu from '../functions/admin/inscriptions/[id]/apercu.js';
import * as verification from '../functions/admin/inscriptions/[id]/verification.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const HOST = 'https://clubdemo.licyo.fr';

async function setup() {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const seed = (prenom, uploadedAt, status = 'a_verifier') =>
    seedInscription(env.DB, {
      enfant_prenom: prenom, email: `${prenom.toLowerCase()}@example.test`, dossier_key: `dossiers/${prenom}`,
      dossier_content_type: 'application/pdf', dossier_uploaded_at: uploadedAt, dossier_status: status,
    });
  return { env, cookie, seed };
}

const post = (env, cookie, id, fields) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const value of [].concat(v)) body.append(k, value);
  return verification.onRequestPost({
    request: new Request(`${HOST}/admin/inscriptions/${id}/verification`, { method: 'POST', headers: { Cookie: cookie }, body }),
    env, params: { id: String(id) }, waitUntil: () => {},
  });
};

test('aperçu : panneau Valider / Refuser à côté du document, avec enchaînement', async () => {
  const { env, cookie, seed } = await setup();
  const row = await seed('Lea', '2026-10-01 10:00:00');
  const res = await apercu.onRequestGet({ request: new Request(`${HOST}/admin/inscriptions/${row.id}/apercu`, { headers: { Cookie: cookie } }), env, params: { id: String(row.id) } });
  const page = await res.text();
  assert.match(page, /id="verification"/);
  assert.match(page, /Valider le dossier/);
  assert.match(page, /Refuser le dossier/);
  assert.equal((page.match(/name="suite" value="1"/g) || []).length, 2, 'les deux formulaires enchaînent');
});

test('valider depuis l’aperçu ouvre le plus ancien dossier encore à vérifier, puis la fiche en fin de série', async () => {
  const { env, cookie, seed } = await setup();
  const a = await seed('Ana', '2026-10-01 10:00:00');
  const b = await seed('Bob', '2026-10-03 10:00:00');
  const c = await seed('Cyl', '2026-10-02 10:00:00');
  await seed('Dan', '2026-09-30 10:00:00', 'valide');

  let res = await post(env, cookie, a.id, { action: 'valider', suite: '1' });
  assert.equal(res.headers.get('Location'), `/admin/inscriptions/${c.id}/apercu?verifOk=valide&precedent=${a.id}`);
  res = await post(env, cookie, c.id, { action: 'refuser', suite: '1', motifs: 'signature' });
  assert.match(res.headers.get('Location'), new RegExp(`^/admin/inscriptions/${b.id}/apercu\\?verifOk=refuse&precedent=${c.id}$`));
  res = await post(env, cookie, b.id, { action: 'valider', suite: '1' });
  assert.equal(res.headers.get('Location'), `/admin/inscriptions/${b.id}?verifOk=valide&fin=1#dossier`);

  const statuses = (await env.DB.prepare('SELECT enfant_prenom, dossier_status FROM inscriptions ORDER BY id').all()).results.map((r) => `${r.enfant_prenom}:${r.dossier_status}`);
  assert.deepEqual(statuses, ['Ana:valide', 'Bob:valide', 'Cyl:refuse', 'Dan:valide']);

  // Le message de l'aperçu suivant nomme l'enfant précédent.
  const page = await (await apercu.onRequestGet({ request: new Request(`${HOST}/admin/inscriptions/${c.id}/apercu?verifOk=valide&precedent=${a.id}`, { headers: { Cookie: cookie } }), env, params: { id: String(c.id) } })).text();
  assert.match(page, /Ana Durand : Dossier validé\. Dossier suivant/);
});

test('refus incomplet depuis l’aperçu : retour sur l’aperçu avec l’erreur ; depuis la fiche : comportement inchangé', async () => {
  const { env, cookie, seed } = await setup();
  const a = await seed('Ana', '2026-10-01 10:00:00');
  let res = await post(env, cookie, a.id, { action: 'refuser', suite: '1' });
  assert.match(res.headers.get('Location'), new RegExp(`^/admin/inscriptions/${a.id}/apercu\\?verifError=`));
  res = await post(env, cookie, a.id, { action: 'valider' });
  assert.equal(res.headers.get('Location'), `/admin/inscriptions/${a.id}?verifOk=valide#dossier`);
});
