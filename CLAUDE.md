# CLAUDE.md

Guide pour Claude Code (et tout agent) sur ce dépôt. Répondre en français, court et direct. Ne jamais utiliser le tiret cadratin dans les textes, documents et réponses.

## Le projet

**Licyo** est une plateforme site web + CRM pour **clubs sportifs, tous sports confondus** (foot, sports de combat, natation, athlé...). Chaque club client a son site public (généré par un moteur commun, à ses couleurs) et un espace d'administration identique pour gérer inscriptions, adhérents, cotisations, dossiers, e-mails et relances. Modèle visé : abonnement mensuel, un seul code pour tous les clubs.

Porteur : Abdallah (AbiWeb, Saint-Gratien, 95).

### Origine

Le code vient du dépôt `Abudara25/SaintGratienFC` (copie de `main` au 2026-10-20, commit `850df1d`, sans historique), site d'un vrai club de foot déjà en production qui avait commencé à se transformer en plateforme multi-organisations (phases 1 à 4E). **Saint-Gratien FC reste sur son propre dépôt, en production, et ne migre pas sur Licyo.** Son `CLAUDE.md` garde l'historique détaillé de chaque décision : s'y référer pour comprendre un choix technique ancien.

Tout le contenu du club réel a été remplacé par un **club de démonstration fictif** : « Club Démo », organisation `org_demo`, slug `club-demo`, ville fictive Sportville, domaine `clubdemo.licyo.fr`, blason générique « CD », photos neutres, coordonnées factices (06 00 00 00 00, RNA W000000000). Aucune donnée réelle d'adhérent n'est dans le dépôt (elles sont en base D1, jamais copiées).

## Commandes

```
npm ci          # dépendances (Node 22 ou 24)
npm run pages   # régénère les pages HTML depuis sites/ et renderer/
npm run css     # régénère assets/css/styles.css depuis styles/
npm run sync    # empreintes ?v= des assets + pages (après toute modification de assets/css ou assets/js)
npm run build   # dossier publié dist/ (allowlist) + modules générés de functions/_generated/
npm run check   # vérifie que tout est à jour, puis lance les 582 tests (node:test, D1 simulée par node:sqlite)
npm test        # tests seuls
```

Serveur local complet : `npm run build`, puis `npx wrangler pages dev dist --d1 DB --kv INSCRIPTION_STATUS --r2 DOSSIERS --binding ADMIN_PASSWORD=<test>`.

## Architecture

- **Hébergement cible** : Cloudflare Pages (site + Pages Functions), D1 (base, juridiction EU), KV (`INSCRIPTION_STATUS`, réglages par organisation), R2 (`DOSSIERS`, dossiers signés et photos), Worker programmé `workers/cron/` (relances, récapitulatif). **Aucune ressource Cloudflare n'existe encore pour Licyo** : projet Pages, D1, KV, R2 et Worker sont à créer (compte Cloudflare `Gherari.abdallah@gmail.com`).
- **Moteur de site** (`renderer/`) : pur, sans accès réseau ni base. Une configuration par organisation dans `sites/<slug>/site.js` + `sites/<slug>/content/*.js` (sections structurées, jamais de HTML). Registre dans `sites/index.js`.
- **Pages HTML de la racine GÉNÉRÉES** : ne jamais les modifier à la main (`npm run pages`).
- **CSS GÉNÉRÉ** : `assets/css/styles.css` vient de `styles/` (palette `styles/palettes/<slug>.css`, thème `styles/themes/dynamic-diagonal/1/`, base `styles/base/`). Ne jamais l'éditer à la main (`npm run css` puis `npm run sync`).
- **Multi-organisation** : tout le cœur parle d'`organization` / `organization_id`. Organisation résolue côté serveur (domaine pour le public, session pour l'admin), **jamais** lue dans une requête. Toute requête sur une table de `TENANT_TABLES` filtre `organization_id` (test statique `tests/tenant-scoping.test.mjs`, tests d'isolation A/B).
- **Schéma D1** : migrations numérotées et additives dans `functions/_shared/schema.js` (+ `crm-schema.js`, `news-schema.js`), jamais réécrites une fois publiées ; `repairSchemaInvariants` contrôle à chaque démarrage.
- **SiteConfig en base** (`functions/_shared/site-config.js`) : brouillon puis publication par organisation ; le site public ne lit que la version publiée.
- **Admin** (`functions/admin/`, habillage `functions/_shared/admin-auth.js`, `assets/css/admin.css`) : inscriptions, adhérents (CRM), catégories, pré-inscriptions, e-mails, événements, paramètres. Session D1 glissante (30 min), CSRF automatique.
- **E-mails** : `functions/_shared/confirmation-email.js` (SMTP, Brevo en secours), journal `email-log.js`.
- **Paiements** : HelloAsso (widget + notifications), `functions/_shared/helloasso.js`.
- **Fichiers jamais servis** : `functions/_shared/internal-paths.js` + allowlist de `scripts/build-public.mjs` (tout nouveau fichier à la racine doit être classé, sinon `tests/public-output.test.mjs` échoue).
- **Prototype de la console plateforme** : `prototypes/platform-crm/` (`npm run platform:preview`), nom du produit lu dans `src/config/brand.js`.

## Règles impératives

1. Ne jamais modifier à la main un fichier généré (pages HTML racine, `styles.css`, `functions/_shared/asset-versions.js`, `functions/_generated/`).
2. Données des adhérents non destructibles dès qu'un club est en production : migrations additives, testées en local puis sur une copie (`scripts/verify-d1-copy.mjs`) ; toute opération destructive se propose et attend une validation explicite. Un export de production contient des données de mineurs : jamais commité.
3. Sécurité : échapper tout champ saisi par le public, revalider côté serveur, aucun mot de passe dans un e-mail, aucune pièce jointe fournie par le navigateur, aucun secret dans le dépôt.
4. Aucune vraie personne, adresse ou ville en exemple ; le club de démo reste fictif.
5. Toute correction ou fonctionnalité s'accompagne d'un test ; `npm run check` doit rester vert.
6. Front-end : vérifier le rendu à 360 px et 768 px (débordements, cibles tactiles de 44 px, champs à 16 px).
7. Git : ne jamais forcer un push ni sauter les hooks.

## Dette héritée de Saint-Gratien FC (à traiter)

- **Le club de démo est l'ancien « locataire historique »** : `DEMO_ORG_ID`, `DEMO_DOMAINS` (`schema.js`) et `isLegacyTenant` / `LEGACY_MIRROR` (`settings-kv.js`) gardent des comportements spéciaux (anciennes clés KV globales, secret `ADMIN_PASSWORD`, secrets HelloAsso de plateforme, secours statique, valeurs par défaut des catégories). Pour une vraie plateforme, ces cas particuliers doivent disparaître : chaque organisation a ses réglages, secrets et mot de passe en base.
- **Contenu orienté football** : catégories U6-U7 / U8-U9, pré-inscription U10, licence FFF, taille de maillot, textes et articles. À rendre générique (vocabulaire par sport, catégories libres, fédération configurable) pour viser tous les sports.
- **Palette bordeaux et or** du club d'origine dans `styles/palettes/club-demo.css` et dans les constantes des e-mails : à remplacer par une palette par organisation.
- **Une seule organisation déclarée** dans `sites/index.js` et la migration 1 ; pas encore d'écran d'onboarding, de comptes utilisateurs multiples ni de rôles.
- **Sveltia CMS** (`admin/`) pointe vers le dépôt `Abudara25/Licyo` : outil mono-club, à remplacer par l'édition des actualités en base (phase 4E, services déjà prêts).
- Fichiers propres au club de démo servis sur tout domaine : `sitemap.xml`, `robots.txt`, `llms.txt`, manifestes.
