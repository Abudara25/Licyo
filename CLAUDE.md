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
npm run check   # vérifie que tout est à jour, puis lance tous les tests (node:test, D1 simulée par node:sqlite)
npm test        # tests seuls
```

Serveur local complet : `npm run build`, puis `npx wrangler pages dev dist --d1 DB --kv INSCRIPTION_STATUS --r2 DOSSIERS --binding SETUP_SECRET=<test>`, puis `/admin/premier-acces` pour créer le premier compte.

## Architecture

- **Hébergement cible** : Cloudflare Pages (site + Pages Functions), D1 (base, juridiction EU), KV (`INSCRIPTION_STATUS`, réglages par organisation), R2 (`DOSSIERS`, dossiers signés et photos), Worker programmé `workers/cron/` (relances, récapitulatif). **Aucune ressource Cloudflare n'existe encore pour Licyo** : projet Pages, D1, KV, R2 et Worker sont à créer (compte Cloudflare `Gherari.abdallah@gmail.com`).
- **Moteur de site** (`renderer/`) : pur, sans accès réseau ni base. Une configuration par organisation dans `sites/<slug>/site.js` + `sites/<slug>/content/*.js` (sections structurées, jamais de HTML). Registre dans `sites/index.js`.
- **Pages HTML de la racine GÉNÉRÉES** : ne jamais les modifier à la main (`npm run pages`).
- **CSS GÉNÉRÉ** : `assets/css/styles.css` vient de `styles/` (palette `styles/palettes/<slug>.css`, thème `styles/themes/dynamic-diagonal/1/`, base `styles/base/`). Ne jamais l'éditer à la main (`npm run css` puis `npm run sync`).
- **Multi-organisation** : tout le cœur parle d'`organization` / `organization_id`. Organisation résolue côté serveur (domaine pour le public, session pour l'admin), **jamais** lue dans une requête. Toute requête sur une table de `TENANT_TABLES` filtre `organization_id` (test statique `tests/tenant-scoping.test.mjs`, tests d'isolation A/B).
- **Schéma D1** : migrations numérotées et additives dans `functions/_shared/schema.js` (+ `crm-schema.js`, `news-schema.js`), jamais réécrites une fois publiées ; `repairSchemaInvariants` contrôle à chaque démarrage.
- **SiteConfig en base** (`functions/_shared/site-config.js`) : brouillon puis publication par organisation ; le site public ne lit que la version publiée.
- **Admin** (`functions/admin/`, habillage `functions/_shared/admin-auth.js`, `assets/css/admin.css`) : inscriptions, adhérents (CRM), catégories, pré-inscriptions, e-mails, événements, paramètres, utilisateurs, journal. Session D1 glissante (30 min), CSRF automatique.
- **Comptes et rôles** (phase 3, `functions/_shared/accounts.js`) : un compte (`users`) par personne, global à la plateforme ; son accès à un club passe par une appartenance (`organization_memberships`) avec un rôle. Les permissions découlent du rôle et sont vérifiées pour chaque route par `functions/_shared/admin-access.js` (middleware admin), qui retire aussi de la navigation les liens interdits et tient le journal d'audit. **Toute nouvelle page admin doit être ajoutée à `requiredPermission`** (par défaut : `settings.manage`). Une session appartient à un compte (`admin_sessions.user_id`) ; `isAuthed()` renvoie `{ organizationId, userId, role, roleLabel, permissions, user }` et `can(admin, permission)` teste un droit. Plus aucun mot de passe partagé ni secret `ADMIN_PASSWORD`. Premier responsable d'un club : `/admin/premier-acces` avec le secret de plateforme `SETUP_SECRET`. Tests : comptes de test par `tests/helpers/accounts.mjs` (`testUser`).
- **E-mails** : `functions/_shared/confirmation-email.js` (SMTP, Brevo en secours), journal `email-log.js`. Les gabarits contiennent l'identité du club de démo comme forme de RÉFÉRENCE (nom, lieu, jeudi 17h, couleurs, adresse) : `email-identity.js` la remplace au point d'envoi (`brevoSend`) par celle du club qui envoie ; `MAIL_FROM` = adresse d'expédition de la plateforme, le club en Reply-To. Pages famille et admin : `replaceDemoContact` (`organization.js`).
- **Groupes d'un entraîneur** (migration 15) : `organization_memberships.group_scope` ; `isAuthed()` renvoie `groupScope` (null = tout) ; `scopeRows`/`inGroupScope` (`admin-auth.js`) pour les listes ; le middleware admin rend introuvables les fiches hors groupe. Toute nouvelle liste d'inscrits doit appliquer `scopeRows`.
- **Site de départ et éditeur** : `sites/starter.js` (profil vers SiteConfig complète, clé `starter`), `renderer/palette.js` (couleurs du club), `functions/_shared/site-editor.js`, `/admin/site` (+ `/apercu`).
- **Champs propres au club** (migration 16) : `functions/_shared/custom-fields.js`, définitions dans le KV, valeurs dans `inscriptions.custom_fields`.
- **Présences** (migration 17) : `functions/_shared/attendance.js`, `/admin/presences`.
- **Abonnements** (migration 18) : `functions/_shared/billing.js`, console plateforme ; aucun prestataire de paiement branché.
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

- **Valeurs de référence du club de démo dans le code** : catégories par défaut (`settings-kv.js`), lieu (`public-data.js`), pré-inscription U10 (`preinscriptions.js`), articles (`news.js`) et secours statique (`public-site.js`, `DEMO_DOMAINS`). Elles ne servent qu'au club de démo, jamais à un autre ; à terme, un « modèle de club » en base les remplacera. Les clés KV globales, la copie miroir, `ADMIN_PASSWORD` et les secrets `HELLOASSO_*` de plateforme ont disparu.
- **Secrets de plateforme** (variables Cloudflare) : `SETUP_SECRET` (premier accès d'un club), `SECRETS_KEY` (chiffrement des identifiants d'intégration des clubs, à ne jamais changer sans ressaisir ces identifiants), `CRON_SECRET`, `PLATFORM_ADMIN_EMAILS` (éditeurs de Licyo), `MAIL_FROM` (adresse d'expédition des e-mails, domaine authentifié).
- **Profil sportif** (`functions/_shared/sport-profile.js`) : les gabarits de l'admin et des e-mails écrivent le vocabulaire du football (FFF, Footclubs, « École de foot ») comme forme de RÉFÉRENCE, traduite selon le sport du club par `applySportVocabulary` (middleware admin et `brevoSend`). Écrire toute nouvelle mention de fédération avec ces mêmes formes. Taille d'équipement : exigée par `/api/inscriptions` seulement si le profil a un `equipment` ; champ absent du formulaire public si `sizes: []` dans la configuration du site, et de la réinscription si le profil n'a pas d'équipement. Champs propres au sport : voir « Champs propres au club ». Reste à faire : licence facultative selon le sport.
- **Palette bordeaux et or** du club de démo dans `styles/palettes/club-demo.css` et les constantes des e-mails : c'est la palette de RÉFÉRENCE ; les autres clubs la remplacent par leurs couleurs (`theme.colors`, `renderer/palette.js`, `email-identity.js`). L'admin garde la palette de référence.
- **Console plateforme** (`/admin/plateforme`, `functions/_shared/platform.js`) : réservée aux comptes dont l'e-mail figure dans la variable `PLATFORM_ADMIN_EMAILS` (permission `platform.manage`, hors rôles de club, aucune donnée d'adhérent). Crée un club (organisation, domaine, sport, invitation du responsable sur le domaine du club), ajoute un domaine, suspend ou réactive. Le club reçoit aussitôt un site de départ publié et un essai de 30 jours. Le domaine doit ensuite être rattaché au projet Pages à la main. Reste à faire : prélèvement automatique et factures.
- **Sveltia CMS** (`admin/`) pointe vers le dépôt `Abudara25/Licyo` : outil mono-club, à remplacer par l'édition des actualités en base (phase 4E, services déjà prêts).
- Fichiers propres au club de démo servis sur tout domaine : `sitemap.xml`, `robots.txt`, `llms.txt`, manifestes.
