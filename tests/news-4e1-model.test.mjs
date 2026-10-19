// Phase 4E.1 — modèle Article (contrat 4E v3.1 §18 à §21) : T17 (validateur), T18 (Markdown), T45
// (legacyBodyToMarkdown), et configuration de markdown-it 14.1.0 face aux avis de sécurité connus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  validateArticle, ArticleValidationError, markdownToAst, MarkdownError, legacyBodyToMarkdown, legacyParagraphs,
  MARKDOWN_OPTIONS, MARKDOWN_DISABLED_RULES, MAX_AST_NODES, mapLegacyArticle, canonicalDraftJson,
} from '../functions/_shared/article-model.js';
import { SECTIONS } from '../renderer/sections.js';
import { escapeStrict } from '../renderer/html.js';
import { newsArticlePage } from '../renderer/news.js';
import { site as demoSite } from '../sites/club-demo/site.js';
import { draft } from './helpers/news.mjs';

const CATEGORIES = ['club', 'inscriptions', 'benevolat', 'evenement', 'partenariat'];
const ok = (input, options = {}) => validateArticle(input, { mode: 'draft', categories: CATEGORIES, slug: 'titre', ...options });
const refused = (input, pattern, options = {}) => {
  let error;
  try {
    ok(input, options);
  } catch (e) {
    error = e;
  }
  assert.ok(error instanceof ArticleValidationError, `attendu : refus (${pattern})`);
  assert.equal(error.status, 422);
  assert.ok(error.errors.some((m) => pattern.test(m)), `${pattern} absent de ${JSON.stringify(error.errors)}`);
};

// Types de nœuds de l'AST v1 (liste blanche).
const BLOCK_TYPES = new Set(['p', 'h', 'ul', 'ol']);
const INLINE_TYPES = new Set(['text', 'soft', 'br', 'strong', 'em', 'link']);
function assertWhitelisted(blocks) {
  const inline = (nodes) => {
    for (const n of nodes) {
      assert.ok(INLINE_TYPES.has(n.type), `nœud hors liste blanche : ${n.type}`);
      if (n.children) inline(n.children);
    }
  };
  for (const b of blocks) {
    assert.ok(BLOCK_TYPES.has(b.type), `bloc hors liste blanche : ${b.type}`);
    if (b.items) b.items.forEach(inline);
    else inline(b.children);
  }
}

test('T17 — validateur : clé inconnue, bornes, date impossible, catégorie non publiée, legacyImage de l’entrée refusés ; sérialisation canonique stable', () => {
  for (const key of ['id', 'organizationId', 'organization_id', 'slug', 'imageUrl', '__proto__x']) refused({ ...draft(), [key]: 'x' }, /clé inconnue/);
  refused(draft({ title: 'x'.repeat(201) }), /title/);
  refused(draft({ excerpt: 'x'.repeat(501) }), /excerpt/);
  refused(draft({ content: 'é'.repeat(50_001) }), /content : au plus/); // 100 002 octets UTF-8
  refused(draft({ seoTitle: 'x'.repeat(121) }), /seoTitle/);
  refused(draft({ seoDescription: '' }), /seoDescription/);
  refused(draft({ date: '2026-02-30' }), /date/);
  refused(draft({ date: '2026-9-1' }), /date/);
  refused(draft({ category: 'inconnue' }), /category/);
  refused(draft({ category: 'club' }), /category/, { categories: ['benevolat'] }); // catégorie non publiée
  refused(draft({ title: 'Titre\u0007' }), /caractère de contrôle/);
  refused(draft({ content: 'ligne\r\nautre' }), /content : caractère de contrôle/);
  refused(draft({ v: 2 }), /v : 1/);
  refused({ ...draft(), legacyImage: '/assets/images/actualites/photo.jpg' }, /legacyImage/); // posé par l'entrée (CREATE)
  refused(draft(), /slug/, { slug: 'Pas-Valide' });
  refused(draft(), /slug : figé/, { slug: 'autre', existing: { draft: {}, slug: 'titre', firstPublishedAt: '2026-09-01 10:00:00' } });
  // SAVE : legacyImage repris du brouillon lu ; une autre valeur dans l'entrée est refusée.
  const existing = { draft: { legacyImage: '/assets/images/actualites/a.jpg' }, slug: 'titre', firstPublishedAt: null };
  assert.equal(ok(draft(), { existing }).draft.legacyImage, '/assets/images/actualites/a.jpg');
  refused({ ...draft(), legacyImage: null }, /legacyImage/, { existing });
  // Publication : champs obligatoires.
  refused(draft({ title: '' }), /title/, { mode: 'publish' });
  refused(draft({ content: '   ' }), /content : requis/, { mode: 'publish' });
  refused(draft({ category: null }), /category : requise/, { mode: 'publish' });
  refused(draft({ date: null }), /date : requise/, { mode: 'publish' });
  // Sérialisation canonique : ordre v1, NFC, bords nettoyés (sauf content), indépendante de l'ordre de l'entrée.
  const a = ok({ date: '2026-09-01', title: '  Café  ', content: '  corps  ', v: 1 });
  const b = ok({ content: '  corps  ', title: 'Café', v: 1, date: '2026-09-01' });
  assert.equal(a.json, b.json);
  assert.deepEqual(Object.keys(JSON.parse(a.json)), ['v', 'title', 'excerpt', 'content', 'category', 'date', 'seoTitle', 'seoDescription', 'legacyImage']);
  assert.equal(JSON.parse(a.json).content, '  corps  ');
  assert.equal(canonicalDraftJson(JSON.parse(a.json), { categories: CATEGORIES, slug: 'titre' }), a.json, 'idempotent');
  assert.deepEqual(a.projections, { title: 'Café', excerpt: '', category: null, date: '2026-09-01' });
});

test('T18 — Markdown : HTML, <script>, images, javascript:, data:, identifiants, #, listes imbriquées, > 5 000 nœuds : refus ou texte littéral', () => {
  const literal = (source) => {
    const blocks = markdownToAst(source);
    assertWhitelisted(blocks);
    return JSON.stringify(blocks);
  };
  // HTML brut et <script> : texte littéral (aucun nœud HTML).
  for (const source of ['<b>gras</b>', '<script>alert(1)</script>', '<iframe src="x"></iframe>', '<style>p{}</style>']) {
    const out = literal(source);
    assert.ok(out.includes(JSON.stringify(source).slice(1, -1)), `texte littéral attendu pour ${source}`);
  }
  // Rendu : le texte littéral est échappé (strict) par le moteur existant.
  const html = SECTIONS.article_body.render(
    { type: 'article_body', id: 'x', category: { label: 'Club', icon: 'heart' }, blocks: markdownToAst('<script>alert(1)</script> [lien](https://ok.fr)'), excerpt: '', back: { href: '/actualites', label: 'Retour' } },
    { text: escapeStrict, strict: true, mode: 'static' }
  );
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<a href="https://ok.fr">lien</a>'));
  // Images Markdown : refusées.
  assert.throws(() => markdownToAst('![image](https://exemple.fr/i.png)'), MarkdownError);
  assert.throws(() => markdownToAst('![](x)'), MarkdownError);
  // Protocoles dangereux : jamais un lien (texte littéral ou refus).
  for (const source of ['[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x](data:text/html,<b>)', '[x](vbscript:msgbox)', '[x](data:image/png;base64,AAAA)']) {
    let out;
    try {
      out = literal(source);
    } catch (error) {
      assert.ok(error instanceof MarkdownError);
      continue;
    }
    assert.ok(!out.includes('"link"'), `aucun lien pour ${source}`);
  }
  assert.throws(() => markdownToAst('[x](https://user:pass@exemple.fr)'), /identifiants/);
  assert.throws(() => markdownToAst('[x](//exemple.fr)'), MarkdownError);
  assert.throws(() => markdownToAst(`[x](https://exemple.fr/${'a'.repeat(2100)})`), /trop long/);
  assert.throws(() => markdownToAst('[x](https://exemple.fr "titre")'), /titre de lien/);
  // Titres : # interdit (message explicite), ## et ### admis, #### interdit.
  assert.throws(() => markdownToAst('# Titre'), /utilisez ## ou ###/);
  assert.throws(() => markdownToAst('#### Titre'), /utilisez ## ou ###/);
  assert.deepEqual(markdownToAst('## A\n\n### B').map((b) => [b.type, b.level]), [['h', 2], ['h', 3]]);
  // Listes : imbrication interdite, numérotation commençant à 1 seulement, un paragraphe par élément.
  assert.throws(() => markdownToAst('- a\n  - b'), /imbriquées/);
  assert.throws(() => markdownToAst('3. trois'), /commencer à 1/);
  assert.throws(() => markdownToAst('- a\n\n  second paragraphe'), MarkdownError);
  assert.deepEqual(markdownToAst('1. un\n2. deux').map((b) => [b.type, b.items.length]), [['ol', 2]]);
  // Syntaxe désactivée : texte littéral (citation, séparateur, code, titre souligné).
  for (const source of ['> citation', '***', '`code`', 'Titre\n===', '    indenté', '[ref]: https://x.fr']) literal(source);
  // Profondeur et taille.
  assert.throws(() => markdownToAst('*a* '.repeat(MAX_AST_NODES)), /trop complexe/);
  // Imbrication profonde : au-delà de 20 niveaux (maxNesting), refus explicite ; 20 niveaux restent admis.
  assert.throws(() => markdownToAst('*'.repeat(60) + 'x' + '*'.repeat(60)), /imbrication trop profonde/);
  const depth = (nodes) => Math.max(0, ...nodes.map((n) => (n.children ? 1 + depth(n.children) : 0)));
  assert.equal(depth(markdownToAst('**'.repeat(10) + 'x' + '**'.repeat(10))[0].children), 10);
  // Aucun jeton hors liste blanche dans un contenu riche admis.
  assertWhitelisted(markdownToAst('Texte **fort** et *em*  \nretour forcé\n\n- [lien](/actualites) \n- mailto : [écrire](mailto:contact@exemple.fr)'));
});

test('markdown-it 14.1.0 : configuration du contrat, règles linkify et smartquotes jamais actives (GHSA-38c4-r59v-3vqw, GHSA-6v5v-wf23-fmfq)', async () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.dependencies['markdown-it'], '14.1.0', 'version épinglée exactement');
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  assert.equal(lock.packages['node_modules/markdown-it'].version, '14.1.0');
  assert.deepEqual({ ...MARKDOWN_OPTIONS }, { html: false, linkify: false, typographer: false, maxNesting: 20 });
  assert.deepEqual([...MARKDOWN_DISABLED_RULES], ['image', 'html_block', 'html_inline', 'fence', 'code', 'backticks', 'reference', 'autolink', 'lheading', 'hr', 'blockquote']);
  // Charges des deux avis : traitées en temps linéaire (quelques millisecondes), jamais par les règles vulnérables.
  for (const payload of ['*'.repeat(50_000) + 'x', '"'.repeat(100_000)]) {
    const started = performance.now();
    try {
      markdownToAst(payload);
    } catch {
      // refus admis ; seule la durée compte ici
    }
    assert.ok(performance.now() - started < 2000, 'aucun blocage');
  }
});

// --- T45 ------------------------------------------------------------------------------------------------------------

const REAL = JSON.parse(readFileSync('content/articles.json', 'utf8')).articles;
const ctx = { text: escapeStrict, strict: true, mode: 'static' };
const bodyHtml = (article, blocks) => {
  const section = newsArticlePage(demoSite, article, blocks === undefined ? {} : { blocks }).sections[1];
  SECTIONS.article_body.validate(section);
  return SECTIONS.article_body.render(section, ctx);
};

// Les 5 articles de référence du contrat (empreintes figées ci-dessous). Les articles publiés ensuite depuis le CMS
// (content/articles.json évolue) sont contrôlés aussi, sans empreinte figée : une publication ne doit pas casser la CI.
const REFERENCE_SLUGS = ['bienvenue-nouveau-site', 'recherche-benevoles', 'reprise-entrainements-inscriptions-ouvertes', 'regle-foot-u6-u7', 'regle-foot-u8-u9'];

test('T45 — legacyBodyToMarkdown : HTML article_body des 5 articles réels identique octet pour octet avant et après', () => {
  const reference = REAL.filter((article) => REFERENCE_SLUGS.includes(article.slug));
  assert.equal(reference.length, 5, 'les 5 articles de référence sont toujours publiés');
  const prints = {};
  for (const article of reference) {
    const before = bodyHtml(article);
    const after = bodyHtml(article, markdownToAst(legacyBodyToMarkdown(article.body)));
    assert.equal(after, before, article.slug);
    prints[article.slug] = createHash('sha256').update(before).digest('hex').slice(0, 16);
  }
  // Empreintes de la section article_body rendue par le moteur (mesure de cette implémentation, 16 caractères).
  assert.deepEqual(prints, {
    'bienvenue-nouveau-site': '756ba2f9f3a471bc',
    'recherche-benevoles': 'c3b9b847362788f6',
    'reprise-entrainements-inscriptions-ouvertes': 'dcc3b2ea993dec95',
    'regle-foot-u6-u7': '36517a673128bb21',
    'regle-foot-u8-u9': '403ded4b321e5901',
  });
  // Les deux articles « règles » sont faits de lignes « - … » : ils restent UN paragraphe (jamais une liste).
  for (const slug of ['regle-foot-u6-u7', 'regle-foot-u8-u9']) {
    const blocks = markdownToAst(legacyBodyToMarkdown(REAL.find((a) => a.slug === slug).body));
    assert.ok(blocks.every((b) => b.type === 'p'));
  }
  // Déterministe et idempotent (même entrée, même sortie).
  for (const article of REAL) assert.equal(legacyBodyToMarkdown(article.body), legacyBodyToMarkdown(article.body));
});

test('T45 bis — articles publiés après la référence : HTML article_body identique avant et après la conversion', () => {
  for (const article of REAL.filter((a) => !REFERENCE_SLUGS.includes(a.slug))) {
    assert.equal(bodyHtml(article, markdownToAst(legacyBodyToMarkdown(article.body))), bodyHtml(article), article.slug);
  }
});

test('T45 — legacyBodyToMarkdown : \\r et caractères de contrôle refusés ; entrée non texte refusée', () => {
  for (const body of ['a\r\nb', 'a\rb', 'a\u0000b', 'a\u0008b', 'a\u000Bb', 'a\u001Fb', 'a\u007Fb']) {
    assert.throws(() => legacyBodyToMarkdown(body), /caractère de contrôle/, JSON.stringify(body));
  }
  for (const body of [null, undefined, 42, {}, ['x']]) assert.throws(() => legacyBodyToMarkdown(body), /texte attendu/);
  assert.equal(legacyBodyToMarkdown('a\tb'), 'a\tb', 'tabulation interne conservée');
});

// Générateur pseudo-aléatoire déterministe (mulberry32) : le fuzzing est reproductible.
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PIECES = [
  ...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
  ' ', ' ', '\t', '\n', '\n\n', 'a', 'é', 'mot ', 'Z9',
  '- ', '1. ', '1) ', '+ ', '* ', '# ', '## ', '> ', '***', '===', '---', '    ', '<b>', '</b>', '&amp;', '&#32;', '[a](http://x)',
  '`x`', '\\\n', '  \n', '![i](x)', '<http://a>', ' ', '　', '😀', '⚽', '–', '_a_', '**b**', '~~c~~', '|t|',
];
function fuzzBody(random) {
  let body = '';
  const n = 1 + Math.floor(random() * 24);
  for (let i = 0; i < n; i++) body += PIECES[Math.floor(random() * PIECES.length)];
  return body;
}
// Paragraphes d'un AST fait uniquement de paragraphes de texte et de retours simples.
function astParagraphs(blocks) {
  return blocks.map((b) => {
    assert.equal(b.type, 'p');
    return b.children.map((n) => {
      if (n.type === 'text') return n.value;
      if (n.type === 'soft') return '\n';
      throw new Error(`nœud inattendu : ${n.type}`);
    }).join('');
  });
}

test('T45 — fuzzing de 30 000 corps : paragraphes historiques = paragraphes de l’AST, 0 écart', () => {
  const random = rng(0x4e1);
  let gaps = 0;
  const examples = [];
  for (let i = 0; i < 30_000; i++) {
    const body = fuzzBody(random);
    const expected = legacyParagraphs(body);
    let actual;
    try {
      actual = astParagraphs(markdownToAst(legacyBodyToMarkdown(body)));
    } catch (error) {
      actual = `ERREUR ${error.message}`;
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      gaps++;
      if (examples.length < 3) examples.push({ body, expected, actual });
    }
  }
  assert.equal(gaps, 0, JSON.stringify(examples, null, 1));
});

test('§24 — mapLegacyArticle : clés admises seulement, legacyBodyToMarkdown puis validation en mode publication', () => {
  const article = { ...REAL[0] };
  const mapped = mapLegacyArticle(article, { categories: CATEGORIES });
  assert.equal(mapped.slug, article.slug);
  assert.equal(mapped.draft.content, legacyBodyToMarkdown(article.body));
  assert.equal(mapped.draft.legacyImage, article.image);
  assert.equal(mapLegacyArticle({ ...REAL[1] }, { categories: CATEGORIES }).draft.legacyImage, null, 'image vide → null');
  assert.throws(() => mapLegacyArticle({ ...article, auteur: 'x' }, { categories: CATEGORIES }), /clé inconnue/);
  assert.throws(() => mapLegacyArticle({ ...article, image: '/assets/images/actualites/../x.jpg' }, { categories: CATEGORIES }), /legacyImage/);
  assert.throws(() => mapLegacyArticle(article, { categories: [] }), /category/);
});
