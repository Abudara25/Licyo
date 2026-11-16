// Lots A et B de l'audit produit (2026-11-10) : U10 cohérent, paiement en ligne par catégorie, parcours d'essai,
// espace famille « Il vous reste à faire », « À traiter » en entrée, recherche commune « Trouver un enfant ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { COOKIE_NAME, createSession, adminShell } from '../functions/_shared/admin-auth.js';
import { getCategoriesConfig, setCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { getPreinscriptionConfig, setPreinscriptionConfig } from '../functions/_shared/preinscriptions.js';
import { issueFamilyLink } from '../functions/_shared/family-links.js';
import * as preinApi from '../functions/api/preinscriptions.js';
import * as inscriptionsApi from '../functions/api/inscriptions.js';
import * as contactApi from '../functions/api/contact.js';
import * as recherche from '../functions/admin/recherche.js';
import { onRequestGet as depotGet } from '../functions/depot/[token].js';
import { fixture, seedInscription, validData } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const SITE = 'https://club-exemple.example';

async function addU10(env, extra = {}) {
  const config = await getCategoriesConfig(env, A);
  await setCategoriesConfig(env, A, { ...config, categories: [...config.categories, { id: 'u10', label: 'U10', anneeMin: 2017, anneeMax: 2017, active: true, helloAssoUrl: '', helloAssoWidgetUrl: '', ...extra }] });
}

test('pré-inscription : groupe ouvert dès que sa catégorie automatique est active ; liste d’attente inchangée', async () => {
  clearOrganizationCache();
  const env = await fixture();
  const get = async () => (await preinApi.onRequestGet({ request: new Request(`${SITE}/api/preinscriptions`), env })).json();
  const post = () =>
    preinApi.onRequestPost({
      request: new Request(`${SITE}/api/preinscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: SITE, 'CF-Connecting-IP': crypto.randomUUID() },
        body: JSON.stringify({ enfantPrenom: 'Lou', enfantNom: 'Fictif', naissance: '2017-05-12', paysNaissance: 'France', villeNaissance: 'Argenteuil', cpNaissance: '95100', tailleMaillot: '10 ans', parentPrenom: 'P', parentNom: 'F', email: 'p@example.fr', telephone: '0600000000', rgpd: true }),
      }),
      env,
      waitUntil: () => {},
    });
  assert.equal((await get()).open, true, 'sans catégorie U10 : pré-inscription ouverte');

  await addU10(env);
  const opened = await get();
  assert.equal(opened.opened, true);
  assert.equal(opened.open, false);
  assert.equal((await post()).status, 409, 'envoi refusé : inscription directe');

  // Liste d'attente (club établi) : la catégorie active ne ferme pas la pré-inscription.
  await setPreinscriptionConfig(env, A, { ...(await getPreinscriptionConfig(env, A)), autoCategory: false });
  const waitlist = await get();
  assert.equal(waitlist.opened, false);
  assert.equal(waitlist.open, true);
});

test('inscription : paiement en ligne refusé pour une catégorie sans campagne HelloAsso, accepté au club', async () => {
  const env = await fixture();
  await addU10(env);
  const submit = (patch) =>
    inscriptionsApi.onRequestPost({
      request: new Request(`${SITE}/api/inscriptions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() }, body: JSON.stringify({ ...validData, naissance: '2017-03-03', categorie: 'U10', ...patch }) }),
      env,
      waitUntil: () => {},
    });
  const refused = await submit({ modePaiement: 'HelloAsso' });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /pas encore disponible pour la catégorie U10/);
  assert.equal((await submit({ modePaiement: 'Carte bancaire' })).status, 200);
  // Le navigateur ne retombe plus sur la campagne d'une autre catégorie.
  const js = readFileSync('assets/js/inscription.js', 'utf8');
  assert.doesNotMatch(js, /firstCategorieAvecHelloAsso/);

  // Campagne U10 créée (2026-11-10, liens collés dans Catégories) : paiement en ligne accepté.
  const config = await getCategoriesConfig(env, A);
  const U10_URL = 'https://www.helloasso.com/associations/club-exemple/adhesions/adhesion-categorie-u10-club-exemple-2026-2027-2';
  await setCategoriesConfig(env, A, { ...config, categories: config.categories.map((c) => (c.label === 'U10' ? { ...c, helloAssoUrl: U10_URL, helloAssoWidgetUrl: `${U10_URL}/widget` } : c)) });
  assert.equal((await submit({ modePaiement: 'HelloAsso', enfantPrenom: 'Autre' })).status, 200);
});

test('essai gratuit : année de naissance exigée, jour facultatif et borné, message facultatif, objet explicite', async (t) => {
  clearOrganizationCache();
  const env = { ...(await fixture()), BREVO_API_KEY: 'cle-de-test' };
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
  });
  const post = (body) =>
    contactApi.onRequestPost({
      request: new Request(`${SITE}/api/contact`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() }, body: JSON.stringify(body) }),
      env,
    });
  const base = { nom: 'Camille Fictif', email: 'camille@example.fr', sujet: 'essai', message: '', rgpd: true };
  assert.equal((await post({ ...base, essaiNaissance: '' })).status, 400);
  assert.equal((await post({ ...base, essaiNaissance: '1990' })).status, 400, 'adulte');
  assert.equal((await post({ ...base, essaiNaissance: '2019', essaiDate: '2001-01-01' })).status, 400, 'date passée');
  assert.equal(sent.length, 0);

  const now = new Date();
  const year = now.getUTCFullYear() - 7;
  const nextWeek = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  assert.equal((await post({ ...base, essaiNaissance: String(year), essaiDate: nextWeek })).status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, new RegExp(`^Essai gratuit — enfant né en ${year} — \\S+ \\d+ \\S+ — Camille Fictif$`));
  assert.match(sent[0].textContent, new RegExp(`Enfant né en : ${year}`));

  // Sujet ordinaire : le message reste obligatoire.
  assert.equal((await post({ ...base, sujet: 'Autre demande' })).status, 400);
  assert.deepEqual(contactApi.trialDetails({ essaiNaissance: String(year) }), { annee: String(year), date: '' });
});

test('formulaire de contact : sujet « essai » proposé, présélectionné seulement par le lien ; clic mesuré', () => {
  const contact = readFileSync('contact.html', 'utf8');
  assert.match(contact, /<option value="essai">Séance d'essai gratuite<\/option>/);
  assert.match(contact, /<option selected>Je souhaite devenir bénévole<\/option>/, 'sans JavaScript, sujet ordinaire par défaut');
  assert.match(contact, /id="contact-essai" class="form-row" data-weekday="4" hidden/);
  const home = readFileSync('index.html', 'utf8');
  assert.match(home, /href="\/contact\?sujet=essai#formulaire-contact" class="[^"]*" data-track-event="trial_click">Essai gratuit</);
  for (const page of ['index.html', 'inscription.html', 'contact.html', 'equipe.html', 'entrainements.html']) {
    const html = readFileSync(page, 'utf8');
    assert.doesNotMatch(html, /10 septembre 2026|garantir une place|futur groupe U10|Pré-inscription U10 \(enfants de 2017\)/i, page);
  }
});

test('espace famille : « Il vous reste à faire » ne liste que les actions de la famille', async () => {
  const env = await fixture();
  const DONE = { dossier_key: 'k', dossier_uploaded_at: '2026-10-01 10:00:00', dossier_status: 'valide', photo_key: 'p', photo_uploaded_at: '2026-10-01 10:00:00', ville_naissance: 'Ville', pays_naissance: 'France', mode_paiement: 'Carte bancaire' };
  const page = async (overrides) => {
    const row = await seedInscription(env.DB, { enfant_prenom: `E${Math.random().toString(36).slice(2, 7)}`, ...overrides });
    const token = await issueFamilyLink(env.DB, row.organization_id, row.id);
    return (await depotGet({ request: new Request(`${SITE}/depot/${token}`), env, params: { token } })).text();
  };

  // Complet avec acompte : le solde est la seule chose à faire (plus de « Dossier complet » trompeur).
  const solde = await page({ ...DONE, paye: 0, montant_recu_cents: 6000, montant_du_cents: 18000 });
  assert.match(solde, /Il vous reste une chose à faire/);
  assert.match(solde, /Régler le solde de 120/);
  assert.doesNotMatch(solde, /Tout est en ordre/);
  assert.ok(solde.indexOf('id="paiement"') < solde.indexOf('id="dossier"'), 'la carte à compléter passe avant les étapes faites');
  assert.match(solde, /<summary>Revoir ou remplacer le dossier<\/summary>/, 'dossier validé : formulaire replié');

  // Payé, licence demandée sur Footclubs : la famille doit compléter le dossier de la Fédération.
  const fff = await page({ ...DONE, paye: 1, licence_demandee_at: '2026-11-01 10:00:00' });
  assert.match(fff, /Compléter le dossier de licence envoyé par e-mail par la Fédération/);

  // Payé, licence pas encore demandée : rien à faire pour la famille, le club s'en occupe.
  const club = await page({ ...DONE, paye: 1 });
  assert.match(club, /Rien à faire pour le moment/);
  assert.match(club, /le club s'occupe de la licence/);

  // Rien de fait : actions dans l'ordre.
  const neuf = await page({ paye: 0, mode_paiement: 'Espèces' });
  assert.match(neuf, /Il vous reste 4 choses à faire/);
});

test('admin : « À traiter » dans la barre latérale et du bas, arrivée après connexion', async () => {
  const shell = adminShell({ active: 'a-traiter', title: 'X' });
  const top = shell.slice(shell.indexOf('class="adm-sidebar-nav"'), shell.indexOf('</nav>'));
  assert.match(top, /href="\/admin\/a-traiter"/);
  assert.match(top, /href="\/admin\/events"/, 'Communication visible dans la barre latérale');
  const bottom = shell.slice(shell.indexOf('class="adm-tabbar"'));
  const visible = bottom.slice(0, bottom.indexOf('<details'));
  for (const href of ['/admin/a-traiter', '/admin/inscriptions', '/admin/adherents']) assert.ok(visible.includes(`href="${href}"`), `${href} visible sur mobile`);
  assert.match(shell, /href="\/admin\/recherche"[^>]*title="Rechercher"/);
  const auth = readFileSync('functions/_shared/admin-auth.js', 'utf8');
  assert.match(auth, /Location: '\/admin\/a-traiter'/);
});

test('trouver un enfant : toutes les listes, organisation de la session seulement', async () => {
  const env = await fixture();
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_b_test', 'b-test', 'B')").run();
  const DONE = { dossier_key: 'k', dossier_uploaded_at: 'x', dossier_status: 'valide', photo_key: 'p', photo_uploaded_at: 'x', ville_naissance: 'V', pays_naissance: 'France', paye: 1 };
  await seedInscription(env.DB, { enfant_prenom: 'Zoé', enfant_nom: 'Adhérente', ...DONE });
  await seedInscription(env.DB, { enfant_prenom: 'Zoé', enfant_nom: 'Corbeille', archived_at: '2026-10-01 10:00:00' });
  await seedInscription(env.DB, { enfant_prenom: 'Zoé', enfant_nom: 'Ailleurs', organization_id: 'org_b_test' });
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const search = async (q) => (await recherche.onRequestGet({ request: new Request(`${SITE}/admin/recherche?q=${encodeURIComponent(q)}`, { headers: { Cookie: cookie } }), env })).text();

  const html = await search('zoe');
  assert.match(html, /Zoé Adhérente[\s\S]*?Adhérent</);
  assert.match(html, /Zoé Corbeille[\s\S]*?Corbeille</);
  assert.doesNotMatch(html, /Ailleurs/, 'autre organisation invisible');
  assert.match(await search('parent@example.fr'), /3 résultats[\s\S]*Enfants <em>2[\s\S]*Responsables légaux <em>1/, 'deux enfants et leur responsable, regroupé');
  assert.match(await search('z'), /au moins 2 lettres/);
  assert.match(await search('introuvable'), /Aucun résultat pour/);
  assert.equal(recherche.matches({ enfant_prenom: 'Léa-Rose', enfant_nom: 'Durand' }, 'lea rose'), true);
});
