// 2026-11-14 : fratries dans l'espace famille. Depuis le lien d'un enfant, la famille voit ses autres enfants (même
// adresse e-mail d'un responsable, même organisation, fiches actives) avec ce qu'il leur reste à faire, et passe de l'un
// à l'autre sans nouvel e-mail. Jamais un enfant d'une autre famille ou d'une autre organisation, jamais une fiche
// archivée, jamais une fiche dont le club a révoqué les liens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { issueFamilyLink, revokeFamilyLinks, resolveFamilyToken } from '../functions/_shared/family-links.js';
import { findSiblings } from '../functions/_shared/siblings.js';
import * as depot from '../functions/depot/[token].js';
import * as switcher from '../functions/depot/[token]/enfant/[id].js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const ORG_B = 'org_test_association';
const SITE = 'https://club-exemple.example';

async function setup() {
  clearOrganizationCache();
  const env = { ...(await fixture()), ASSETS: { fetch: async () => new Response('404', { status: 404 }) } };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name, type) VALUES (?, 'test-association', 'Test Association', 'cultural_association')").bind(ORG_B).run();
  const leo = await seedInscription(env.DB, { enfant_prenom: 'Léo', enfant_nom: 'Martin', naissance: '2019-04-04', categorie: 'U8', email: 'nadia@example.fr' });
  // Frère : même adresse, écrite autrement.
  const adam = await seedInscription(env.DB, { enfant_prenom: 'Adam', enfant_nom: 'Martin', naissance: '2021-03-03', categorie: 'U6', email: ' NADIA@example.fr ' });
  // Demi-sœur : la mère de Léo est le second responsable.
  const ines = await seedInscription(env.DB, { enfant_prenom: 'Inès', enfant_nom: 'Benali', naissance: '2020-02-02', categorie: 'U7', email: 'karim@example.fr', parent2_email: 'nadia@example.fr' });
  const autre = await seedInscription(env.DB, { enfant_prenom: 'Autre', enfant_nom: 'Famille', email: 'autre@example.fr' });
  const archive = await seedInscription(env.DB, { enfant_prenom: 'Ancien', enfant_nom: 'Martin', email: 'nadia@example.fr', archived_at: '2026-09-01' });
  const ailleurs = await seedInscription(env.DB, { organization_id: ORG_B, enfant_prenom: 'Bob', enfant_nom: 'Martin', email: 'nadia@example.fr' });
  return { env, leo, adam, ines, autre, archive, ailleurs };
}

const open = (env, token) => depot.onRequestGet({ request: new Request(`${SITE}/depot/${token}`), env, params: { token } });
const go = (env, token, id) => switcher.onRequestGet({ request: new Request(`${SITE}/depot/${token}/enfant/${id}`), env, params: { token, id: String(id) } });

test('fratrie : même adresse d’un responsable (1 ou 2), même organisation, fiches actives seulement', async () => {
  const { env, leo, adam, ines } = await setup();
  const ids = (await findSiblings(env.DB, A, leo)).map((s) => s.id);
  assert.deepEqual(ids.sort(), [adam.id, ines.id].sort());
  assert.deepEqual((await findSiblings(env.DB, A, (await env.DB.prepare('SELECT * FROM inscriptions WHERE enfant_prenom = ?').bind('Autre').first()))).length, 0);
});

test('espace famille : bloc « Vos enfants » avec ce qu’il reste à faire ; enfant seul = pas de bloc', async () => {
  const { env, leo, autre } = await setup();
  const html = await (await open(env, await issueFamilyLink(env.DB, A, leo.id))).text();
  assert.match(html, /Vos enfants inscrits/);
  assert.match(html, /aria-current="page"[\s\S]*?Léo/);
  assert.match(html, /href="\/depot\/f[^/"]+\/enfant\/\d+"[\s\S]*?Adam[\s\S]*?choses à faire/);
  assert.match(html, /Inès/);
  assert.doesNotMatch(html, /Ancien|Bob|Autre/);
  const alone = await (await open(env, await issueFamilyLink(env.DB, A, autre.id))).text();
  assert.doesNotMatch(alone, /Vos enfants inscrits/);
});

test('passage d’un enfant à l’autre : lien neuf de la fiche visée, puis son espace', async () => {
  const { env, leo, adam } = await setup();
  const token = await issueFamilyLink(env.DB, A, leo.id);
  const res = await go(env, token, adam.id);
  assert.equal(res.status, 303);
  const next = res.headers.get('Location').split('/').pop();
  assert.notEqual(next, token);
  const access = await resolveFamilyToken(env.DB, A, next);
  assert.equal(access.status, 'ok');
  assert.equal(access.row.id, adam.id);
  assert.match(await (await open(env, next)).text(), /Adam Martin/);
});

test('refus : enfant d’une autre famille, archivé, d’une autre organisation, lien expiré ou inconnu → retour sans rien révéler', async () => {
  const { env, leo, autre, archive, ailleurs, adam } = await setup();
  const token = await issueFamilyLink(env.DB, A, leo.id);
  for (const id of [autre.id, archive.id, ailleurs.id, leo.id, 0, 'abc', 999999]) {
    const res = await go(env, token, id);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('Location'), `/depot/${token}`);
  }
  const expired = await issueFamilyLink(env.DB, A, leo.id, Date.now() - 40 * 86_400_000);
  assert.equal((await go(env, expired, adam.id)).headers.get('Location'), `/depot/${expired}`);
  assert.equal((await go(env, 'finconnu', adam.id)).headers.get('Location'), '/depot/finconnu');
  const links = (await env.DB.prepare('SELECT COUNT(*) AS n FROM family_links WHERE inscription_id <> ?').bind(leo.id).first()).n;
  assert.equal(links, 0, 'aucun lien créé pour une fiche refusée');
});

test('révocation par le club respectée : fiche aux liens révoqués non proposée, jusqu’au prochain lien envoyé par le club', async () => {
  const { env, leo, adam } = await setup();
  const token = await issueFamilyLink(env.DB, A, leo.id);
  await revokeFamilyLinks(env.DB, A, adam.id, Date.now() - 1000);
  assert.ok(!(await findSiblings(env.DB, A, leo)).some((s) => s.id === adam.id));
  assert.equal((await go(env, token, adam.id)).headers.get('Location'), `/depot/${token}`);
  await issueFamilyLink(env.DB, A, adam.id); // « Envoyer un nouveau lien » du club
  assert.ok((await findSiblings(env.DB, A, leo)).some((s) => s.id === adam.id));
});
