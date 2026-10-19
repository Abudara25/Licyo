// Prototype visuel de la console Platform (prototypes/platform-crm) : logique pure, données fictives, garde-fous de sécurité
// et isolement. Les parcours dans le navigateur sont testés à part (tests/visual/platform-prototype, npm run platform:e2e).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { escape, html, safeColor, DEFAULT_SAFE_COLOR } from '../prototypes/platform-crm/src/lib/html.js';
import * as HTML from '../prototypes/platform-crm/src/lib/html.js';
import { sparkline, areaChart, barList, finite } from '../prototypes/platform-crm/src/components/charts.js';
import { icon, ICON_NAMES } from '../prototypes/platform-crm/src/components/icons.js';
import { filterOrganizations, sortOrganizations, paginate, computeKpis, moduleAvailability, sportDistribution, organizationIssue, ORG_VIEWS, lifecycleBreakdown, accessDerivation, LIFECYCLE_GROUPS } from '../prototypes/platform-crm/src/lib/query.js';
import { parseRoute } from '../prototypes/platform-crm/src/router.js';
import * as F from '../prototypes/platform-crm/src/data/fixtures.js';
import { LIFECYCLE, BILLING, ACCESS, DOMAIN_STATUS, SSL, HEALTH, SPORTS } from '../prototypes/platform-crm/src/data/status.js';
import { validateStep, slugify, firstInvalidStep, emptyWizard } from '../prototypes/platform-crm/src/pages/onboarding.js';
import { resolveFile, CSP } from '../scripts/serve-platform-prototype.mjs';
import { internalPathReason } from '../functions/_shared/internal-paths.js';
import { PUBLIC_DIRECTORIES, PUBLIC_ROOT_FILES } from '../scripts/build-public.mjs';

const ROOT = 'prototypes/platform-crm';
const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
const sources = files(ROOT).filter((f) => /\.(js|html|css)$/.test(f));
const code = (f) => readFileSync(f, 'utf8');
// Code sans commentaires (JS, CSS, HTML) : les commentaires décrivent justement ce qui est interdit.
const stripComments = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const ORG = (slug) => F.ORGANIZATIONS.find((o) => o.slug === slug);

test('gabarits : échappement par défaut, aucune primitive chaîne → balisage (ni raw, ni trusted)', () => {
  assert.equal(escape('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
  assert.equal(String(html`<p>${'<script>'}</p>`), '<p>&lt;script&gt;</p>');
  assert.equal(String(html`<p>${html`<b>${'x&y'}</b>`}</p>`), '<p><b>x&amp;y</b></p>');
  assert.equal(String(html`${[1, '<', null, false]}`), '1&lt;');
  // Plus aucune primitive exportée qui accepterait une chaîne : seules restent escape, html, safeColor, cx.
  assert.deepEqual(Object.keys(HTML).sort(), ['DEFAULT_SAFE_COLOR', 'cx', 'escape', 'html', 'safeColor']);
  assert.equal(HTML.raw, undefined);
  assert.equal(HTML.trusted, undefined);
  const hostile = '<img src=x onerror=alert(1)>';
  // html refuse les appels directs : chaîne, tableau ordinaire, tableau sans raw, nombre de valeurs incohérent.
  assert.throws(() => html(hostile), TypeError);
  assert.throws(() => html([hostile]), TypeError);
  assert.throws(() => html(Object.assign([hostile], { raw: [hostile] })), TypeError);
  assert.throws(() => html(Object.freeze([hostile]), 'x'), TypeError);
  // Un fragment produit par html ne peut pas être fabriqué à partir d'une chaîne : la valeur interne est privée.
  const fragment = html`<b>ok</b>`;
  assert.equal(Object.keys(fragment).length, 0);
  const forged = Object.create(Object.getPrototypeOf(fragment));
  assert.throws(() => String(html`${forged}`), TypeError, 'imitation de fragment refusée');
  assert.equal(String(html`${{ toString: () => hostile }}`), escape(hostile), 'objet quelconque = texte échappé');
  assert.doesNotMatch(String(html`<p title="${hostile}">${hostile}</p>`), /<img/);
});

// Aucune entrée hostile ne produit de balisage exécutable : ni balise, ni attribut d'événement, ni sortie d'attribut.
const HOSTILE = ['<script>alert(1)</script>', '" onload="alert(1)', "' onmouseover='alert(1)", 'javascript:alert(1)', '"><svg onload=alert(1)>', 'x" style="background:url(javascript:alert(1))'];
test('graphiques et icônes : entrées hostiles neutralisées, nombres et couleurs validés', () => {
  for (const bad of HOSTILE) {
    const out = [
      areaChart({ values: [1, 2, 3], labels: [bad, bad], ariaLabel: bad }),
      barList([{ label: bad, value: bad, ratio: 0.5, color: bad }]),
      sparkline([1, 2], { color: bad }),
      icon(bad),
      icon('info', bad),
      html`<span title="${bad}">${bad}</span>`,
    ].map(String).join('\n');
    assert.doesNotMatch(out, /<script|<img|<svg\s+on[a-z]+/i, bad);
    assert.doesNotMatch(out, /"\s*on[a-z]+\s*=/i, `attribut d'événement : ${bad}`);
    for (const [, name, value] of out.matchAll(/\s(style|stroke|fill)="([^"]*)"/g)) assert.doesNotMatch(value, /javascript:|url\((?!#ui-area\))|expression/i, `${name} hostile : ${bad}`);
    assert.ok(!out.includes(bad) || !/[<>"']/.test(bad), `valeur recopiée sans échappement : ${bad}`);
  }
  // Nombres : NaN, Infinity, chaînes et objets sont refusés au lieu d'être recopiés dans le SVG.
  for (const n of [Number.NaN, Infinity, '12" onload="x', '5', null, {}, []]) {
    assert.throws(() => finite(n), TypeError, String(n));
    assert.throws(() => sparkline([1, n, 3]), TypeError);
    assert.throws(() => areaChart({ values: [1, n], labels: [], ariaLabel: 'x' }), TypeError);
    assert.throws(() => barList([{ label: 'x', value: 1, ratio: n, color: '#fff' }]), TypeError);
  }
  assert.throws(() => areaChart({ values: [1, 2], labels: [], ariaLabel: 'x', height: '200" onload="x' }), TypeError);
  assert.match(String(icon('info', '18" onload="x')), /width="18"/, 'taille invalide → taille par défaut');
  assert.equal(String(icon('__proto__')), String(icon('info')), 'nom inconnu → icône par défaut');
  // Couleurs : seules #rgb, #rrggbb et var(--x) passent.
  // Icônes : catalogue fermé et structurel ; un nom hors catalogue donne l'icône d'information.
  assert.equal(ICON_NAMES.length, 52);
  for (const name of [...HOSTILE, '__proto__', 'constructor', 'toString', 'script', 'foreignObject', '', null, 42, {}]) assert.equal(String(icon(name)), String(icon('info')), String(name));
  for (const name of ICON_NAMES) {
    const out = String(icon(name));
    assert.match(out, /^<svg [^>]+>(<(path|circle|ellipse|rect)( (d|cx|cy|r|rx|ry|x|y|width|height|opacity|fill)="[^"<>]*")+\/>)+<\/svg>$/, name);
    assert.doesNotMatch(out, /on[a-z]+=|href|script|foreignObject|javascript:|style=/i, name);
  }
});

test('safeColor : trois formes seulement, longueur bornée, repli interne non contournable', () => {
  for (const ok of ['#fff', '#ABC', '#FFFFFF', '#ffffff', '#123456', 'var(--brand)', 'var(--color-accent)', 'var(--org-primary-2)', 'var(--ui-brand)']) assert.equal(safeColor(ok), ok, ok);
  const rejected = [
    'javascript:alert(1)', 'url(x)', 'url(javascript:alert(1))', 'expression(alert(1))', 'var(--x, red)', 'var( --x )', 'var(--x);background:url(x)',
    'red;background:url(x)', 'red', '<script>', '"', "'", '#fff\n', '#fff\t', '\n#fff', '#f/**/ff', '/* x */#fff', 'var(--x/**/)', '#12345', '#1234567', 'var(--)', 'var(---x)', 'var(--x-)',
    '#' + 'f'.repeat(10000), 'var(--' + 'a'.repeat(60) + ')', 'var(--' + 'a'.repeat(10000) + ')', null, undefined, 42, {}, ['#fff'],
  ];
  for (const bad of rejected) assert.equal(safeColor(bad), DEFAULT_SAFE_COLOR, JSON.stringify(bad)?.slice(0, 40));
  // Le repli n'est plus un paramètre : un second argument hostile est simplement ignoré.
  assert.equal(safeColor('bad', 'red;background:url(x)'), DEFAULT_SAFE_COLOR);
  assert.equal(safeColor.length, 1);
  assert.equal(DEFAULT_SAFE_COLOR, 'currentColor');
  // Toutes les couleurs actuelles (logos, nuanciers, sports, répartition, assistant, thème) passent telles quelles.
  const current = [...F.ORGANIZATIONS.flatMap((o) => [o.color, ...o.colors]), ...Object.values(SPORTS).map((x) => x.color), ...LIFECYCLE_GROUPS.map((g) => g.color), 'var(--ui-brand)'];
  assert.deepEqual(current.filter((c) => safeColor(c) !== c), []);
  // Longueur bornée AVANT l'expression régulière : une chaîne de 100 000 caractères est rejetée immédiatement.
  const started = performance.now();
  assert.equal(safeColor('var(--' + 'a-'.repeat(50000) + ')'), DEFAULT_SAFE_COLOR);
  assert.ok(performance.now() - started < 50);
});

test('recherche et filtres (insensibles aux accents), tri, pagination', () => {
  assert.deepEqual(filterOrganizations(F.ORGANIZATIONS, { q: 'padel' }).map((o) => o.slug).sort(), ['padel-95', 'tc-montmorency']);
  assert.deepEqual(filterOrganizations(F.ORGANIZATIONS, { q: 'athle' }).map((o) => o.slug), ['athle-pontoise']);
  assert.equal(filterOrganizations(F.ORGANIZATIONS, { lifecycle: 'TRIAL' }).length, 2);
  assert.equal(filterOrganizations(F.ORGANIZATIONS, { access: 'BLOCKED', lifecycle: 'TRIAL' }).length, 0);
  const byName = sortOrganizations(F.ORGANIZATIONS, 'name', 'asc');
  assert.equal(byName[0].slug, 'athle-pontoise');
  assert.equal(sortOrganizations(F.ORGANIZATIONS, 'name', 'desc')[0].slug, 'volley-beauchamp');
  const p = paginate(byName, 2, 8);
  assert.deepEqual({ page: p.page, pages: p.pages, from: p.from, to: p.to, n: p.items.length }, { page: 2, pages: 2, from: 9, to: 14, n: 6 });
  assert.equal(paginate([], 1, 8).from, 0);
  assert.equal(paginate(byName, 99, 8).page, 2);
});

test('indicateurs et répartition calculés depuis les données (aucune valeur en dur)', () => {
  assert.deepEqual(computeKpis({ organizations: F.ORGANIZATIONS, domains: F.DOMAINS, incidents: F.INCIDENTS }), {
    active: 8, trials: 2, onboarding: 2, pendingDomains: 4, openIncidents: 3, mrrCents: 72200,
  });
  assert.equal(F.GROWTH.mrrCents.at(-1), 72200, 'courbe cohérente avec les organisations');
  assert.equal(F.GROWTH.organizations.at(-1), F.ORGANIZATIONS.length);
  assert.equal(sportDistribution(F.ORGANIZATIONS).reduce((n, d) => n + d.count, 0), F.ORGANIZATIONS.reduce((n, o) => n + o.sports.length, 0));
});

test('modules : capacité, droit, drapeau et configuration restent quatre notions distinctes (ADR-013)', () => {
  const ctx = { plans: F.PLANS, flags: F.FLAGS };
  const mod = (k) => F.MODULES.find((m) => m.key === k);
  const sg = ORG('club-demo');
  assert.deepEqual(moduleAvailability(mod('site'), sg, ctx).available, true);
  assert.equal(moduleAvailability(mod('portal'), ORG('tc-montmorency'), ctx).reason, 'Capacité non livrée', 'droit Pro mais capacité absente');
  assert.equal(moduleAvailability(mod('payments'), ORG('judo-argenteuil'), ctx).reason, 'Non inclus dans le plan');
  assert.equal(moduleAvailability(mod('messaging'), sg, ctx).reason, 'Drapeau désactivé', 'pilote réservé à d’autres organisations');
  assert.equal(moduleAvailability(mod('messaging'), ORG('tc-montmorency'), ctx).available, true, 'organisation pilote');
  assert.equal(moduleAvailability(mod('news'), sg, ctx).available, true);
  const omni = { ...ORG('omnisports-enghien'), modules: { ...ORG('omnisports-enghien').modules, crm: false } };
  assert.equal(moduleAvailability(mod('crm'), omni, ctx).reason, 'Désactivé par le club');
});

test('routage : sections, fiche et onglets, assistant borné, page inconnue', () => {
  assert.deepEqual(parseRoute(''), { name: 'dashboard' });
  assert.deepEqual(parseRoute('#/organisations/org_x/modules'), { name: 'organization', id: 'org_x', tab: 'modules' });
  assert.deepEqual(parseRoute('#/organisations/org_x/inconnu'), { name: 'organization', id: 'org_x', tab: 'apercu' });
  assert.deepEqual(parseRoute('#/onboarding/nouveau/42'), { name: 'wizard', step: 9 });
  assert.deepEqual(parseRoute('#/onboarding/nouveau/x'), { name: 'wizard', step: 1 });
  assert.equal(parseRoute('#/admin').name, 'not-found');
  assert.equal(parseRoute('#/organisations?organizationId=org_x').name, 'organizations', 'un paramètre de requête n’est jamais lu');
});

test('assistant : validation par étape, slug, étape atteinte par l’URL', () => {
  const d = emptyWizard().data;
  assert.ok(validateStep(1, d).name);
  assert.equal(slugify("Tir à l'arc Cormeilles"), 'tir-a-l-arc-cormeilles');
  const ok = { ...d, name: 'Tennis Club des Tilleuls', slug: 'tennis-club-des-tilleuls', sport: 'tennis' };
  assert.deepEqual(validateStep(1, ok), {});
  assert.ok(validateStep(4, { ...ok, customDomain: 'pas un domaine' }).customDomain);
  assert.deepEqual(validateStep(4, { ...ok, customDomain: 'monclub.example' }), {});
  assert.ok(validateStep(7, { ...ok, adminName: 'A B', adminEmail: 'x' }).adminEmail);
  assert.equal(firstInvalidStep(7, d), 1);
  assert.equal(firstInvalidStep(7, { ...ok, adminName: '', adminEmail: '' }), null);
  assert.equal(firstInvalidStep(8, ok), 7);
});

test('données fictives : aucune donnée réelle, identifiants et adresses réservés, états valides', () => {
  const text = code(join(ROOT, 'src/data/fixtures.js'));
  for (const real of ['clubdemo.licyo.fr', 'contact@licyo', '06 00 00 00 00', '+33600000000', 'org_demo', 'Stade municipal', 'gmail.com', 'outlook']) {
    assert.ok(!text.includes(real), `donnée réelle : ${real}`);
  }
  for (const email of text.match(/[\w.+-]+@[\w.-]+/g) || []) assert.match(email, /\.example$/, email);
  for (const d of F.DOMAINS) {
    assert.match(d.hostname, /\.example$/, d.hostname);
    assert.match(d.id, /^dcl_[0-9a-f]{32}$/);
    assert.ok(DOMAIN_STATUS[d.status] && SSL[d.ssl], d.hostname);
    assert.ok(F.orgById(d.orgId), `organisation de ${d.hostname}`);
  }
  for (const o of F.ORGANIZATIONS) {
    assert.match(o.id, /^org_[0-9a-f]{32}$/);
    assert.match(o.domain, /\.example$/);
    assert.ok(LIFECYCLE[o.lifecycle] && BILLING[o.billing.status] && ACCESS[o.access.mode] && HEALTH[o.health], o.slug);
  }
  assert.equal(new Set(F.ORGANIZATIONS.map((o) => o.id)).size, F.ORGANIZATIONS.length);
  for (const a of F.AUDIT) assert.match(a.ip, /^(—|(192\.0\.2|198\.51\.100|203\.0\.113)\.•••)$/, `IP masquée et de documentation : ${a.ip}`);
  assert.doesNotMatch(text, /(token|secret|password|mot de passe)\s*[:=]/i, 'aucun secret ni jeton');
});

test('sécurité : aucun appel réseau, aucun stockage, aucune autorité côté client', () => {
  const FORBIDDEN = [
    [/\bfetch\s*\(/, 'fetch'], [/XMLHttpRequest/, 'XHR'], [/\bWebSocket\b/, 'WebSocket'], [/EventSource/, 'EventSource'], [/sendBeacon/, 'sendBeacon'],
    [/localStorage|sessionStorage|indexedDB/, 'stockage'], [/document\.cookie/, 'cookie'],
    [/isAdmin|is_admin|superAdmin|super_admin|currentUser/i, 'autorité client'], [/organizationId\s*=|[?&]organizationId/, 'organisation fournie par l’URL'],
    [/\beval\s*\(|new Function|insertAdjacentHTML|outerHTML\s*=|document\.write/, 'injection'],
    [/import\s*\(\s*['"`]https?:|from\s+['"]https?:/, 'module distant'],
  ];
  for (const file of sources) {
    const src = stripComments(code(file));
    for (const [re, label] of FORBIDDEN) assert.doesNotMatch(src, re, `${relative('.', file)} : ${label}`);
    for (const url of src.match(/https?:\/\/[^\s"'`)<]+/g) || []) assert.match(url, /^http:\/\/www\.w3\.org\//, `${relative('.', file)} : URL externe ${url}`);
    // Un attribut passé en chaîne simple serait échappé (aria-disabled=&quot;true&quot;) : il doit passer par html``.
    assert.doesNotMatch(src, /\?\s*'[a-z-]+="[^']*'\s*:/, `${relative('.', file)} : attribut en chaîne échappée`);
  }
  for (const file of sources.filter((f) => f.endsWith('.js'))) {
    const src = stripComments(code(file));
    assert.doesNotMatch(src, /\btrusted\b/, `${relative('.', file)} : primitive trusted réintroduite`);
    assert.doesNotMatch(src, /(?<!function )\bhtml\s*\(|\bhtml\.(call|apply|bind)\b/, `${relative('.', file)} : html s'utilise seulement comme gabarit étiqueté`);
    assert.doesNotMatch(src, /\braw\s*\(|export const raw\b/, `${relative('.', file)} : primitive raw réintroduite`);
  }
  const innerHtmlFiles = sources.filter((f) => /\.innerHTML\s*=/.test(code(f))).map((f) => relative(ROOT, f).replaceAll('\\', '/')).sort();
  assert.deepEqual(innerHtmlFiles, ['src/components/command-palette.js', 'src/components/modal.js', 'src/components/toast.js', 'src/main.js'], 'innerHTML réservé aux gabarits échappés');
  for (const file of ['src/main.js', 'src/components/shell.js', 'src/pages/organization-detail.js', 'src/data/fixtures.js']) {
    assert.match(code(join(ROOT, file)), /UI visibility is not authorization/, `${file} : rappel d’autorisation serveur`);
  }
});

test('nom du produit : défini dans src/config/brand.js seulement, jamais écrit en dur dans le prototype', () => {
  const brandFile = join(ROOT, 'src/config/brand.js');
  const PRODUCT_NAME = /licyo/i;
  // Aucun autre fichier du prototype (code, styles, page, commentaires compris) ne contient le nom.
  const offenders = sources.filter((f) => resolve(f) !== resolve(brandFile) && PRODUCT_NAME.test(code(f))).map((f) => relative('.', f));
  assert.deepEqual(offenders, [], 'nom du produit écrit en dur');
  // Les composants qui affichent le nom le lisent dans la configuration.
  for (const file of ['src/main.js', 'src/components/shell.js']) assert.match(code(join(ROOT, file)), /import \{ BRAND[^}]*\} from '\.{1,2}\/config\/brand\.js'/, file);
  const fixtures = code(join(ROOT, 'src/data/fixtures.js'));
  assert.doesNotMatch(fixtures, PRODUCT_NAME, 'données fictives');
  for (const host of [...F.DOMAINS.map((d) => d.hostname), ...F.ORGANIZATIONS.map((o) => o.domain), F.PLATFORM_SITE_DOMAIN]) assert.match(host, /\.example$|^[a-z]+\.example$/, host);
  // Configuration : champs attendus, figée.
  const brand = code(brandFile);
  for (const key of ['productName', 'productShortName', 'platformName', 'platformLabel', 'productDescription', 'workingName']) assert.match(brand, new RegExp(`\\b${key}\\s*:`), key);
  assert.match(brand, /Object\.freeze\(/);
  assert.match(brand, /^\s*workingName:\s*false,/m);
});

test('nom de travail : remplaçable par la seule configuration (copie temporaire, original intact)', async () => {
  const brandFile = join(ROOT, 'src/config/brand.js');
  const before = code(brandFile);
  const dir = mkdtempSync(join(tmpdir(), 'platform-brand-'));
  try {
    cpSync(ROOT, dir, { recursive: true });
    const copy = join(dir, 'src/config/brand.js');
    writeFileSync(copy, before.replaceAll('Licyo', 'Nova'));
    const { sidebar, topbar } = await import(pathToFileURL(join(dir, 'src/components/shell.js')).href);
    const { BRAND } = await import(pathToFileURL(copy).href);
    assert.equal(BRAND.productName, 'Nova');
    const out = String(sidebar({ name: 'dashboard' }, {})) + String(topbar({ name: 'organization', id: 'org_x' }, { orgName: 'Exemple' }));
    assert.match(out, /Nova/);
    assert.doesNotMatch(out, /licyo/i, 'plus aucune trace de l’ancien nom');
    assert.doesNotMatch(out, /nom de travail/, 'badge retiré quand workingName = false');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(code(brandFile), before, 'le fichier de marque du dépôt n’est pas modifié');
});

test('liste et fiche : signaux d’attention, vues rapides, répartition, calcul de l’accès', () => {
  const issues = Object.fromEntries(F.ORGANIZATIONS.map((o) => [o.slug, organizationIssue(o)]).filter(([, i]) => i));
  assert.deepEqual(Object.fromEntries(Object.entries(issues).map(([k, i]) => [k, i.tone])), {
    'padel-95': 'warning', 'athle-pontoise': 'violet', 'basket-sannois': 'warning', 'rugby-franconville': 'danger', 'badminton-herblay': 'danger',
  });
  assert.match(issues['padel-95'].label, /grâce jusqu’au 5 oct\. 2026/, 'date affichée à l’heure de Paris');
  const counts = Object.fromEntries(Object.keys(ORG_VIEWS).map((k) => [k, filterOrganizations(F.ORGANIZATIONS, { view: k }).length]));
  assert.deepEqual(counts, { all: 14, attention: 5, active: 8, trial: 2, onboarding: 2, inactive: 2 });
  assert.equal(filterOrganizations(F.ORGANIZATIONS, { view: 'attention', q: 'rugby' }).length, 1, 'vue et recherche se cumulent');
  const breakdown = lifecycleBreakdown(F.ORGANIZATIONS);
  assert.equal(breakdown.reduce((n, g) => n + g.count, 0), F.ORGANIZATIONS.length, 'chaque organisation dans un seul groupe');
  // La projection affichée est cohérente avec ses trois sources, pour chaque organisation fictive.
  for (const o of F.ORGANIZATIONS) assert.equal(accessDerivation(o).result, o.access.mode, o.slug);
  const rugby = accessDerivation(ORG('rugby-franconville'));
  assert.deepEqual({ lifecycle: rugby.lifecycle, billing: rugby.billing, hold: rugby.hold }, { lifecycle: 'FULL', billing: 'READ_ONLY', hold: null });
  assert.equal(accessDerivation(ORG('badminton-herblay')).hold.mode, 'BLOCKED');
  assert.equal(accessDerivation(ORG('judo-argenteuil')).billing, null, 'la facturation d’un essai n’a pas d’effet');
});

test('isolement : jamais publié, jamais servi par le site d’un club, serveur local strict', () => {
  assert.ok(!PUBLIC_DIRECTORIES.includes('prototypes') && !PUBLIC_ROOT_FILES.some((f) => f.startsWith('prototypes')));
  for (const path of ['/prototypes/platform-crm/index.html', '/prototypes/', '/%70rototypes/platform-crm/src/main.js', '/Prototypes/x']) {
    assert.notEqual(internalPathReason(path), null, path);
  }
  assert.match(CSP, /connect-src 'none'/);
  assert.match(CSP, /default-src 'none'/);
  assert.doesNotMatch(CSP, /unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.ok(resolveFile('/').endsWith('index.html'));
  assert.ok(resolveFile('/src/main.js'));
  const inside = resolve(ROOT) + sep;
  for (const attempt of ['/../package.json', '/%2e%2e/package.json', '/..%2f..%2fCLAUDE.md', '/../../functions/_shared/schema.js', '/%2e%2e%2f%2e%2e%2fscripts/build-public.mjs']) {
    const file = resolveFile(attempt);
    assert.ok(file === null || file.startsWith(inside), `${attempt} sort du dossier du prototype : ${file}`);
  }
  for (const refused of ['/src/%00main.js', '/README.md', '/%zz']) assert.equal(resolveFile(refused), null, refused);
});
