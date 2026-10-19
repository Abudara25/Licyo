import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { onRequestPost as listPost } from '../functions/admin/inscriptions.js';
import { onRequestGet as ficheGet } from '../functions/admin/inscriptions/[id].js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

// Une seule base pour le fichier : la table des sessions admin n'est créée qu'une fois par module.
let shared;
const setup = () => (shared ??= createSetup());
async function createSetup() {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  const cookie = (await createSession(env, DEMO_ORG_ID, await testUser(env, DEMO_ORG_ID))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const post = (fields, ids = []) => {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => form.set(k, v));
    ids.forEach((id) => form.append('ids', id));
    return listPost({
      request: new Request('https://clubdemo.licyo.fr/admin/inscriptions', { method: 'POST', body: form, headers: { Cookie: cookie } }),
      env,
      waitUntil: () => {},
    });
  };
  const get = (id) => env.DB.prepare('SELECT archived_at, archive_motif, archive_commentaire FROM inscriptions WHERE id = ?').bind(id).first();
  return { env, cookie, post, get };
}

test('corbeille : le motif est obligatoire, enregistré, puis effacé à la restauration', async () => {
  const { env, cookie, post, get } = await setup();
  const row = await seedInscription(env.DB);
  const redirectTo = `/admin/inscriptions/${row.id}`;

  let res = await post({ action: 'archive', id: row.id, redirectTo });
  assert.match(res.headers.get('Location'), /bulkError=/);
  assert.equal((await get(row.id)).archived_at, null, 'sans motif, rien n’est archivé');

  res = await post({ action: 'archive', id: row.id, redirectTo, archiveMotif: 'autre' });
  assert.match(res.headers.get('Location'), /bulkError=/, '« Autre » exige une précision');
  assert.equal((await get(row.id)).archived_at, null);

  await post({ action: 'archive', id: row.id, redirectTo, archiveMotif: 'desinscription', archiveCommentaire: 'Déménagement' });
  const archived = await get(row.id);
  assert.ok(archived.archived_at);
  assert.equal(archived.archive_motif, 'desinscription');
  assert.equal(archived.archive_commentaire, 'Déménagement');

  const html = await (
    await ficheGet({ request: new Request(`https://clubdemo.licyo.fr${redirectTo}`, { headers: { Cookie: cookie } }), env, params: { id: String(row.id) } })
  ).text();
  assert.match(html, /Désinscription \(la famille se retire\) : Déménagement/);

  await post({ action: 'restore', id: row.id, redirectTo });
  assert.deepEqual({ ...(await get(row.id)) }, { archived_at: null, archive_motif: null, archive_commentaire: null });
});

test('corbeille groupée : motif exigé, appliqué à chaque fiche', async () => {
  const { env, post, get } = await setup();
  const a = await seedInscription(env.DB, { enfant_prenom: 'Aya' });
  const b = await seedInscription(env.DB, { enfant_prenom: 'Bilal' });

  let res = await post({ action: 'bulk-archive', archiveMotif: 'inconnu' }, [a.id, b.id]);
  assert.match(res.headers.get('Location'), /bulkError=/);
  assert.equal((await get(a.id)).archived_at, null);

  await post({ action: 'bulk-archive', archiveMotif: 'doublon' }, [a.id, b.id]);
  for (const id of [a.id, b.id]) assert.equal((await get(id)).archive_motif, 'doublon');
});
