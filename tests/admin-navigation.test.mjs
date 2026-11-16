import test from 'node:test';
import assert from 'node:assert/strict';
import { adminShell, adminHead, loginPage, createSession, COOKIE_NAME } from '../functions/_shared/admin-auth.js';
import { fixture } from './helpers/inscriptions.mjs';
import { createEducateur } from '../functions/_shared/educateurs.js';
import { DEMO_ORG_ID as ORG } from '../functions/_shared/schema.js';
import { onRequestGet as dashboardGet } from '../functions/admin/dashboard.js';
import { onRequestGet as todoGet } from '../functions/admin/a-traiter.js';

test('navigation CRM : rubriques partagées, toutes les destinations conservées, corbeille séparée', () => {
  const html = adminShell({ active: 'educateurs', title: 'Éducateurs' });
  const sidebar = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
  for (const label of ['Aujourd’hui', 'Saison', 'Club', 'Communication']) {
    assert.ok(sidebar.includes(`class="adm-nav-label">${label}</p>`), label);
  }
  // « À traiter » ouvre la barre ; la flèche de repli est dans l'en-tête de la barre, plus dans la barre du haut.
  assert.ok(sidebar.indexOf('href="/admin/a-traiter"') < sidebar.indexOf('href="/admin/dashboard" class="adm-nav-link'));
  assert.match(sidebar, /class="adm-sidebar-head">[\s\S]*?class="adm-sidebar-toggle"/);
  assert.equal((html.match(/class="adm-sidebar-toggle"/g) || []).length, 1);
  for (const path of ['dashboard', 'a-traiter', 'inscriptions', 'preinscriptions', 'reinscription', 'adherents', 'educateurs', 'email', 'events', 'categories', 'parametres']) {
    assert.ok(sidebar.includes(`href="/admin/${path}"`), path);
  }
  assert.match(sidebar, /href="\/admin\/educateurs" class="adm-nav-link is-active" aria-current="page"/);
  assert.match(sidebar, /class="adm-sidebar-foot"><a href="\/admin\/parametres"[\s\S]*?href="\/admin\/inscriptions\?view=archive"/);
  assert.doesNotMatch(html, /class="adm-tabs"/);
  assert.match(html, /action="\/admin\/recherche" method="GET" role="search"/);
  assert.doesNotMatch(loginPage(), /class="adm-sidebar"/, 'la connexion garde sa mise en page');
});

test('mobile : quatre liens directs, Plus regroupé et aucune destination perdue', () => {
  const html = adminShell({ active: 'educateurs', title: 'Éducateurs' });
  const mobile = html.slice(html.indexOf('<nav class="adm-tabbar"'));
  const direct = mobile.slice(0, mobile.indexOf('<details'));
  assert.equal((direct.match(/class="adm-tabbar-link/g) || []).length, 4);
  for (const path of ['dashboard', 'a-traiter', 'inscriptions', 'adherents']) assert.ok(direct.includes(`href="/admin/${path}"`));
  assert.match(mobile, /class="adm-tabbar-link is-active">[\s\S]*?<span>Plus<\/span>/);
  for (const label of ['Saison', 'Club', 'Communication']) assert.ok(mobile.includes(`class="adm-nav-label">${label}</p>`));
  for (const path of ['preinscriptions', 'reinscription', 'educateurs', 'email', 'events', 'categories', 'parametres', 'logout']) assert.ok(mobile.includes(`href="/admin/${path}"`));
});

test('barre repliable : commande accessible et préférence chargée avant les styles', () => {
  const html = adminShell({ title: 'Test' });
  assert.match(html, /id="adm-sidebar"/);
  assert.match(html, /<button[^>]+aria-controls="adm-sidebar"[^>]+aria-expanded="true"[^>]+aria-label="Replier la barre latérale"[^>]+hidden>/);
  const head = adminHead('Test');
  assert.ok(head.indexOf('/assets/js/admin-layout.js') < head.indexOf('rel="stylesheet"'));
  assert.match(head, /<script src="\/assets\/js\/admin-layout\.js\?v=[^"]+"><\/script>/);
});

test('accueil et À traiter : les fiches éducateurs en attente comptent dans les deux vues', async () => {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'test' };
  const cookie = (await createSession(env, ORG)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  await createEducateur(env.DB, ORG, { prenom: 'Encadrant', nom: 'Exemple', email: 'encadrant@example.invalid', role: 'educateur' });
  const get = async (handler, path) => (await handler({ request: new Request(`https://club-exemple.example${path}`, { headers: { Cookie: cookie } }), env })).text();
  assert.match(await get(dashboardGet, '/admin/dashboard'), /1 action à traiter/);
  const todo = await get(todoGet, '/admin/a-traiter');
  assert.match(todo, /Éducateurs : fiches à compléter/);
  assert.match(todo, /<h1>1 action à traiter<\/h1>/, 'compteur dans le titre : les indicateurs de saison sont dans la Vue d’ensemble');
  assert.doesNotMatch(todo, /encaissés sur/, 'plus d’indicateurs financiers dans À traiter (doublon)');
});
