// Pré-inscriptions « à l'échelle » (2026-11-13) : vue d'ensemble pensée pour beaucoup de groupes (actions d'abord,
// tableau compact, groupes sans action repliés, sélecteur avec recherche), détail d'un groupe (action conseillée,
// filtres par état), export CSV de tous les groupes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../functions/api/preinscriptions.js';
import * as admin from '../functions/admin/preinscriptions.js';
import { rowState, summarizeGroup } from '../functions/admin/preinscriptions.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID as A } from '../functions/_shared/schema.js';
import { setPreinscriptionGroups } from '../functions/_shared/preinscriptions.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const HOST = 'https://club-exemple.example';
let ip = 0;

async function setup(groups) {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  await setPreinscriptionGroups(env, A, groups);
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const get = async (q = '') => (await admin.onRequestGet({ request: new Request(`${HOST}/admin/preinscriptions${q}`, { headers: { Cookie: cookie } }), env })).text();
  const add = async (n, naissance) => {
    const res = await api.onRequestPost({
      request: new Request(`${HOST}/api/preinscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${(ip++ % 250) + 1}` },
        body: JSON.stringify({ enfantPrenom: `Enfant${n}`, enfantNom: 'Test', naissance, paysNaissance: 'France', villeNaissance: 'Argenteuil', tailleMaillot: '10 ans', parentPrenom: 'Parent', parentNom: 'Test', email: `p${n}@example.fr`, telephone: '0600000000', rgpd: true }),
      }),
      env,
      waitUntil: () => {},
    });
    assert.equal(res.status, 200, `pré-inscription Enfant${n}`);
    return (await env.DB.prepare('SELECT id FROM preinscriptions WHERE enfant_prenom = ?').bind(`Enfant${n}`).first()).id;
  };
  return { env, get, add };
}

// 22 groupes d'une année chacun (2000 à 2021), 10 places, formulaire ouvert.
const manyGroups = () => Array.from({ length: 22 }, (_, i) => ({ open: true, groupe: `G${2000 + i}`, label: `Groupe ${2000 + i}`, anneeMin: 2000 + i, anneeMax: 2000 + i, capacity: 10, autoCategory: false }));

test('22 groupes : actions d’abord, tableau filtré « À traiter », groupes sans action repliés, sélecteur complet', async () => {
  const { env, get, add } = await setup(manyGroups());
  const id = await add(1, '2015-05-05');
  await env.DB.prepare('UPDATE preinscriptions SET taille_maillot = NULL WHERE id = ?').bind(id).run();
  await add(2, '2016-05-05');

  const page = await get();
  assert.match(page, /<h1[^>]*>Pré-inscriptions<\/h1>|Pré-inscriptions/);
  assert.match(page, /À faire maintenant <em>· 1 action dans 1 groupe<\/em>/);
  assert.match(page, /1 fiche à compléter/);
  assert.match(page, /class="adm-chip is-active" href="\/admin\/preinscriptions\?vue=a-traiter" aria-current="true">À traiter <b>1<\/b>/);
  assert.match(page, /vue=tous"[^>]*>Tous <b>22<\/b>/);
  // Vue « À traiter » : seul le groupe 2015 est listé dans le tableau.
  const table = page.slice(page.indexOf('id="groupes"'));
  assert.match(table, /Groupe 2015/);
  assert.doesNotMatch(table, /href="\/admin\/preinscriptions\?groupe=G2016"/);
  // Sélecteur : tous les groupes, celui à traiter en tête.
  const picker = page.slice(page.indexOf('aria-label="Groupes en pré-inscription"'), page.indexOf('data-filter-empty="pi-picker"'));
  assert.equal((picker.match(/class="adm-pi-opt[^"]*" href="\/admin\/preinscriptions\?groupe=/g) || []).length, 22);
  assert.ok(picker.indexOf('G2015') < picker.indexOf('G2000'), 'groupe à traiter avant les autres');
  assert.match(page, /data-filter-input="pi-picker"/);

  // Vue « Tous » : 21 groupes sans action repliés derrière un bouton, rouverts par la recherche.
  const all = await get('?vue=tous');
  assert.match(all, /<details class="adm-pi-more" data-filter-open="pi-groups">[\s\S]*Afficher 21 groupes sans action/);
  assert.equal((all.match(/class="adm-pi-group" data-filter-text=/g) || []).length, 22);
  // Vue inconnue : retombe sur la vue par défaut, jamais d'erreur.
  assert.match(await get('?vue=%3Cx%3E'), /vue=a-traiter" aria-current="true"/);
});

test('détail d’un groupe : action conseillée, filtres par état, flèches vers le groupe à traiter suivant', async () => {
  const groups = manyGroups();
  const { env, get, add } = await setup(groups);
  const a = await add(1, '2015-05-05');
  const b = await add(2, '2015-06-06');
  const c = await add(3, '2016-06-06');
  const soon = new Date(Date.now() + 36 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  await env.DB.prepare('UPDATE preinscriptions SET invited_at = CURRENT_TIMESTAMP, invite_deadline_at = ? WHERE id = ?').bind(soon, a).run();
  await env.DB.prepare('UPDATE preinscriptions SET taille_maillot = NULL WHERE id = ?').bind(c).run();
  await seedInscription(env.DB, { enfant_prenom: 'Enfant2', enfant_nom: 'Test', naissance: '2015-06-06', categorie: 'U11' });

  const page = await get('?groupe=G2015');
  assert.match(page, /Pré-inscriptions Groupe 2015/);
  assert.match(page, /class="adm-pi-callout is-no"/);
  assert.match(page, /Invité\(e\) · J-2/);
  assert.match(page, /href="\/admin\/email\?preinscription=\d+">Relancer/);
  assert.match(page, /1 autre action/);
  assert.match(page, /À faire <b>2<\/b>/);
  assert.match(page, /Invités <b>1<\/b>/);
  assert.match(page, /À traiter 1 sur 2/);
  assert.match(page, /href="\/admin\/preinscriptions\?groupe=G2016" aria-label="Groupe suivant"/);
  // Groupe sans action : lien direct vers le premier groupe à traiter.
  assert.match(await get('?groupe=G2001'), /2 groupes à traiter<\/span><a class="adm-btn adm-btn-sm adm-btn-ghost adm-pi-goto" href="\/admin\/preinscriptions\?groupe=G2015">Groupe 2015/);
  // Filtre « Invités » : seule la famille invitée est affichée.
  const invites = await get('?groupe=G2015&etat=invites');
  assert.match(invites, new RegExp(`id="prein-${a}"`));
  assert.doesNotMatch(invites, new RegExp(`id="prein-${b}"`));
  // Filtre inconnu : toutes les familles.
  const unknown = await get('?groupe=G2015&etat=zzz');
  assert.match(unknown, new RegExp(`id="prein-${b}"`));
});

test('liste d’attente avec une catégorie active : la famille suivante est proposée, une seule à la fois', async () => {
  const { env, get, add } = await setup([{ open: true, groupe: 'U11', label: 'U11', anneeMin: 2016, anneeMax: 2016, capacity: 5, autoCategory: false }]);
  const { getCategoriesConfig, setCategoriesConfig } = await import('../functions/_shared/settings-kv.js');
  const cfg = await getCategoriesConfig(env, A);
  await setCategoriesConfig(env, A, { ...cfg, categories: [...cfg.categories, { id: 'u10-u11', label: 'U10 - U11', anneeMin: 2015, anneeMax: 2016, active: true }] }, { expectedVersion: cfg.configVersion });
  const first = await add(1, '2016-01-01');
  await add(2, '2016-02-02');
  let page = await get();
  assert.match(page, /Enfant1 Test<\/strong><span> : première famille de la liste/);
  assert.match(page, new RegExp(`<input type="hidden" name="id" value="${first}"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary" data-once`));
  // Une invitation en cours : plus de proposition tant qu'elle n'est pas finalisée ou expirée.
  await env.DB.prepare('UPDATE preinscriptions SET invited_at = CURRENT_TIMESTAMP WHERE id = ?').bind(first).run();
  page = await get();
  assert.doesNotMatch(page, /première famille de la liste/);
  // Délai dépassé : place libérée, la famille suivante est proposée.
  await env.DB.prepare('UPDATE preinscriptions SET expired_at = CURRENT_TIMESTAMP WHERE id = ?').bind(first).run();
  page = await get();
  assert.match(page, /Enfant2 Test<\/strong><span> : première famille de la liste/);
});

test('CSV de tous les groupes : colonne Groupe ; noms de groupe échappés partout', async () => {
  const { get, add } = await setup([
    { open: true, groupe: 'U10', label: 'U10 <b>x</b>', anneeMin: 2017, anneeMax: 2017, capacity: 15 },
    { open: true, groupe: 'U11', label: 'U11', anneeMin: 2016, anneeMax: 2016, capacity: 15 },
  ]);
  await add(1, '2017-01-01');
  await add(2, '2016-01-01');
  const csv = await get('?format=csv');
  assert.match(csv, /^﻿?"Groupe";"N°"/);
  assert.match(csv, /"U10 <b>x<\/b>";"1"/);
  assert.match(csv, /"U11";"1"/);
  const page = await get('?vue=tous');
  assert.ok(page.includes('U10 &lt;b&gt;x&lt;/b&gt;') && !page.includes('U10 <b>x</b>'));
  // Un groupe précis garde l'export d'origine (sans colonne Groupe).
  assert.match(await get('?groupe=U11&format=csv'), /^﻿?"N°"/);
});

test('états et résumé : calculés depuis les colonnes existantes', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  assert.equal(rowState({ inscription_id: 4 }, now).key, 'inscrits');
  assert.equal(rowState({ completed_at: 'x' }, now).label, 'Inscrit(e)');
  assert.equal(rowState({ expired_at: 'x' }, now).key, 'expires');
  assert.deepEqual(rowState({ invited_at: 'x', invite_deadline_at: '2026-11-20 12:00:00' }, now), { key: 'invites', label: 'Invité(e) · J-7', tone: 'wait' });
  assert.equal(rowState({ invited_at: 'x', invite_deadline_at: '2026-11-14 12:00:00' }, now).tone, 'no');
  assert.equal(rowState({}, now).key, 'attente');
  const g = { groupe: 'U9', label: 'U9', capacity: 2, open: true, anneeMin: 2018, anneeMax: 2018 };
  const rows = [
    { id: 1, enfant_prenom: 'A', enfant_nom: 'B', naissance: '2018-01-01', ville_naissance: 'X', pays_naissance: 'France', taille_maillot: '6 ans' },
    { id: 2, enfant_prenom: 'C', enfant_nom: 'D', naissance: '2018-01-01', expired_at: 'x' },
  ];
  const s = summarizeGroup(g, rows, new Map(), null, now);
  assert.equal(s.count, 1, 'délai dépassé : place libérée');
  assert.equal(s.remaining, 1);
  assert.equal(s.todos.length, 0, 'une fiche au délai dépassé ne demande plus rien');
  assert.equal(s.counts.expires, 1);
});
