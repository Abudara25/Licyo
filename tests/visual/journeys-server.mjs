// Serveur de recette LOCAL uniquement : vraies Functions et middlewares, D1/KV/R2 en mémoire,
// messages interceptés. Aucun secret, aucune donnée ni requête réseau de production.
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPublic } from '../../scripts/build-public.mjs';
import { fixture, seedInscription } from '../helpers/inscriptions.mjs';
import { createR2 } from '../helpers/d1.mjs';
import { createSession, COOKIE_NAME } from '../../functions/_shared/admin-auth.js';
import { DEMO_ORG_ID as ORG } from '../../functions/_shared/schema.js';
import { issueFamilyLink } from '../../functions/_shared/family-links.js';
import { createEducateur, issueEducateurLink, saveEducateurForm } from '../../functions/_shared/educateurs.js';
import { clearOrganizationCache } from '../../functions/_shared/organization.js';
import { clearPublicDataCache } from '../../functions/_shared/public-data.js';
import { onRequest as rootMiddleware } from '../../functions/_middleware.js';
import { onRequest as publicSite } from '../../functions/_shared/public-site.js';
import { onRequest as adminMiddleware } from '../../functions/admin/_middleware.js';
import { onRequest as familyMiddleware } from '../../functions/depot/_middleware.js';
import { onRequest as educMiddleware } from '../../functions/educateur/_middleware.js';
import { onRequest as newsletterMiddleware } from '../../functions/newsletter/_middleware.js';

const PORT = Number(process.env.JOURNEYS_PORT || 4174);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ROOT = resolve(await buildPublic(await mkdtemp(join(tmpdir(), 'demo-journeys-'))));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html;charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };
let env, state, mails = [];
globalThis.fetch = async (url, init) => {
  if (String(url) !== 'https://api.brevo.com/v3/smtp/email') throw new Error('Réseau externe interdit dans la recette locale');
  mails.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ messageId: `local-${mails.length}` }), { status: 201 });
};

async function asset(input) {
  const url = new URL(input instanceof Request ? input.url : input, ORIGIN);
  const path = resolve(ROOT, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
  if (!path.startsWith(ROOT + sep)) return new Response('', { status: 404 });
  try { return new Response(await readFile(path), { headers: { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' } }); }
  catch { return new Response('', { status: 404 }); }
}

async function reset() {
  clearOrganizationCache(); clearPublicDataCache(); mails = [];
  env = { ...(await fixture()), ADMIN_PASSWORD: 'local-test', BREVO_API_KEY: 'local-test', DOSSIERS: createR2(), DOSSIERS_BACKUP: createR2(), ASSETS: { fetch: asset } };
  const cookies = await createSession(env, ORG);
  const cookie = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const pending = await seedInscription(env.DB, { enfant_prenom: 'Enfant', enfant_nom: 'Exemple', naissance: '2021-03-03', categorie: 'U6', telephone: '0600000000', email: 'parent@example.invalid', mode_paiement: 'Carte bancaire', ville_naissance: 'Ville fictive', pays_naissance: 'France', cp_naissance: '00000', created_at: '2026-09-01 12:00:00' });
  const partial = await seedInscription(env.DB, { enfant_prenom: 'Autre', enfant_nom: 'Exemple', naissance: '2020-03-03', categorie: 'U7', email: 'autre@example.invalid', mode_paiement: 'Carte bancaire', ville_naissance: 'Ville fictive', pays_naissance: 'France', paye: 0, montant_du_cents: 18000, montant_recu_cents: 6000, dernier_versement_at: new Date().toISOString().slice(0, 19).replace('T', ' '), dossier_key: 'test-dossier', dossier_uploaded_at: '2026-10-01 12:00:00', dossier_status: 'valide', photo_key: 'test-photo', photo_uploaded_at: '2026-10-01 12:00:00', photo_content_type: 'image/png' });
  const transferred = await seedInscription(env.DB, { enfant_prenom: 'Transfert', enfant_nom: 'Exemple', naissance: '2019-03-03', categorie: 'U8', email: 'transfert@example.invalid', infos_famille_requises: 1, autorisation: 0, rgpd: 0, mode_paiement: null });
  await env.DOSSIERS.put('test-photo', PNG);
  await env.DOSSIERS.put('test-dossier', PNG);
  const educator = await createEducateur(env.DB, ORG, { prenom: 'Encadrant', nom: 'Exemple', email: 'encadrant@example.invalid', role: 'educateur', categories: 'U6, U7' });
  const completeEducator = await createEducateur(env.DB, ORG, { prenom: 'Responsable', nom: 'Exemple de nom composé', email: 'encadrant.adresse.longue@example.invalid', role: 'responsable', categories: 'U6, U7, U8, U9' });
  await saveEducateurForm(env.DB, completeEducator, {
    civilite: 'Madame', prenom: completeEducator.prenom, nom: completeEducator.nom, nom_naissance: 'Nom de naissance fictif', naissance: '1990-01-01', pays_naissance: 'France', cp_naissance: '00000', ville_naissance: 'Ville fictive', nationalite: 'Française', telephone: '0600000000', adresse: 'Adresse fictive', code_postal: '00000', ville: 'Ville fictive', urgence_nom: 'Contact de démonstration', urgence_lien: 'Proche', urgence_telephone: '0600000001', diplomes: 'cfi_u6u9,df_ref,psc', diplomes_autre: 'Formation de démonstration, organisme fictif, en cours', numero_licence: '0000000000', taille_tenue: 'M', disponibilites: 'Disponibilités fictives, à confirmer avec le club.', droit_image: 0, rgpd: 1, attestation: 1,
  });
  // Fratrie (JOURNEYS_SIBLINGS=1) : un frère et une sœur de « Enfant Exemple » (même adresse), pour l'espace famille regroupé.
  if (process.env.JOURNEYS_SIBLINGS) {
    await seedInscription(env.DB, { enfant_prenom: 'Frère', enfant_nom: 'Exemple', naissance: '2019-05-05', categorie: 'U8', email: 'parent@example.invalid', mode_paiement: 'Carte bancaire', ville_naissance: 'Ville fictive', pays_naissance: 'France', paye: 1, dossier_key: 'test-dossier', dossier_uploaded_at: '2026-10-01 12:00:00', dossier_status: 'valide', photo_key: 'test-photo', photo_uploaded_at: '2026-10-01 12:00:00', photo_content_type: 'image/png' });
    await seedInscription(env.DB, { enfant_prenom: 'Sœur au prénom assez long', enfant_nom: 'Exemple', naissance: '2020-06-06', categorie: 'U7', email: 'autre.adresse@example.invalid', parent2_email: 'parent@example.invalid', mode_paiement: 'Carte bancaire' });
  }
  state = { cookie, pending: pending.id, partial: partial.id, transferred: transferred.id, educator: educator.id, completeEducator: completeEducator.id,
    pendingToken: await issueFamilyLink(env.DB, ORG, pending.id), partialToken: await issueFamilyLink(env.DB, ORG, partial.id), transferredToken: await issueFamilyLink(env.DB, ORG, transferred.id), educatorToken: await issueEducateurLink(env.DB, ORG, educator.id) };
  return state;
}

const routeNames = [
  'api/inscriptions', 'api/categories', 'api/inscription-status', 'api/track-event', 'api/preinscriptions',
  'admin/inscriptions/[id]/verification', 'admin/inscriptions/[id]/apercu', 'admin/inscriptions/[id]/photo', 'admin/inscriptions/[id]/dossier', 'admin/inscriptions/[id]', 'admin/inscriptions',
  'admin/educateurs/[id]/photo', 'admin/educateurs/[id]', 'admin/educateurs',
  'admin/adherents/[id]', 'admin/adherents', 'admin/helloasso', 'admin/dashboard', 'admin/a-traiter', 'admin/recherche', 'admin/session', 'admin/categories', 'admin/parametres', 'admin/preinscriptions', 'admin/reinscription', 'admin/email', 'admin/newsletter', 'admin/events',
  'depot/[token]/nouveau-lien', 'depot/[token]/photo', 'depot/[token]/naissance', 'depot/[token]/infos', 'depot/[token]/paiement', 'depot/[token]/pass-sport', 'depot/[token]/enfant/[id]', 'depot/[token]',
  'educateur/[token]/nouveau-lien', 'educateur/[token]/photo', 'educateur/[token]', 'espace-famille', 'newsletter/desinscription/[token]',
];
const routes = await Promise.all(routeNames.map(async (name) => {
  const keys = [];
  const pattern = name.replace(/\[(\w+)\]/g, (_, key) => { keys.push(key); return '([^/]+)'; });
  return { pattern: new RegExp(`^/${pattern}/?$`), keys, module: await import(`../../functions/${name}.js`) };
}));
async function dispatch(request) {
  const pathname = new URL(request.url).pathname;
  const tasks = [];
  const context = { request, env, params: {}, waitUntil: (task) => tasks.push(task), data: {} };
  const route = routes.find((r) => r.pattern.test(pathname));
  if (route) {
    const match = route.pattern.exec(pathname);
    context.params = Object.fromEntries(route.keys.map((key, i) => [key, match[i + 1]]));
  }
  const method = `onRequest${request.method.charAt(0)}${request.method.slice(1).toLowerCase()}`;
  const handler = route ? route.module[method] || route.module.onRequest : pathname.startsWith('/assets/') || pathname.startsWith('/manifest') ? () => asset(request) : publicSite;
  const middleware = pathname.startsWith('/admin/') ? adminMiddleware : pathname.startsWith('/depot/') ? familyMiddleware : pathname.startsWith('/educateur/') ? educMiddleware : pathname.startsWith('/newsletter/') ? newsletterMiddleware : [];
  const chain = [rootMiddleware, ...[].concat(middleware), handler || (() => new Response('', { status: 405 }))];
  const run = (index) => chain[index]({ ...context, next: () => run(index + 1) });
  const response = await run(0);
  await Promise.all(tasks);
  return response;
}

await reset();
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, ORIGIN);
    const buffers = []; for await (const chunk of req) buffers.push(chunk);
    let response;
    if (url.pathname === '/__test__/reset' && req.method === 'POST') response = Response.json(await reset());
    else if (url.pathname === '/__test__/state') response = Response.json(state);
    else if (url.pathname === '/__test__/mails') response = Response.json(mails);
    else if (url.pathname === '/__test__/inscriptions') response = Response.json((await env.DB.prepare('SELECT id, enfant_prenom, paye, montant_recu_cents, montant_du_cents FROM inscriptions WHERE organization_id = ? ORDER BY id').bind(ORG).all()).results);
    else {
      const body = buffers.length ? Buffer.concat(buffers) : undefined;
      response = await dispatch(new Request(url, { method: req.method, headers: req.headers, body }));
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(String(error.stack));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Recette locale sur ${ORIGIN}`));
