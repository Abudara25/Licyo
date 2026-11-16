# CLAUDE.md — Licyo CRM (Cloudflare)

Plateforme multi-club Licyo : site vitrine + CRM d'adhérents par club, **entièrement sur Cloudflare**
(Pages + Functions, D1 en juridiction UE, R2, KV, Worker Cron). Aucun Vercel, aucun Supabase, aucun Next.js.

## Origine du code

Infrastructure reprise du CRM Saint-Gratien FC (le 2026-11-15), **sans aucune donnée client** : ni base, ni export,
ni fichiers, ni contenu éditorial, ni coordonnées du club. Toute identité de Saint-Gratien a été remplacée par un
club **fictif** « Club Exemple » (`org_demo`, domaine réservé `club-exemple.example`, ville « Demoville »),
qui sert d'organisation de démonstration et de jeu de test. Les personnes des tests sont fictives (`@example.*`).
Ne jamais importer de données réelles d'un club dans ce dépôt.

## Commandes

- `npm ci` puis `npm run check` : CSS, pages générées, empreintes d'assets, puis tous les tests (Node 24, SQLite en mémoire).
- `npm run pages` : régénère les pages HTML publiques depuis `sites/<club>/` (ne jamais éditer les `.html` à la main).
- `npm run build` : dossier publié `dist/` (liste blanche : `scripts/build-public.mjs`).

## Architecture (à respecter)

- **Frontière de données = organisation.** Toute table métier porte `organization_id` (liste `TENANT_TABLES`,
  `functions/_shared/schema.js`). L'organisation vient du domaine (public) ou de la session (admin), jamais du
  navigateur. Garde-fous : `tests/tenant-scoping.test.mjs` (analyse statique) et `tests/tenant-isolation.test.mjs`.
- **Migrations** numérotées dans `schema.js`, additives, jamais réécrites une fois en production.
- **Moteur de site** : `renderer/` + configurations `sites/<club>/` (sections structurées, aucun HTML libre).
- **CRM** : `contacts`, `contact_relationships`, `periods`, `memberships`, `group_memberships`, construits à côté de
  `inscriptions` (voir `functions/_shared/crm*.js`).
- Front sans framework : HTML généré + `assets/js` ; admin rendu côté serveur (`functions/admin`).

## Ressources Cloudflare attendues (à créer seulement sur demande)

Bindings Pages : `DB` (D1, juridiction **UE** — pas « France »), `INSCRIPTION_STATUS` (KV), `DOSSIERS` et
`DOSSIERS_BACKUP` (R2). Secrets : `CRON_SECRET`, `TURNSTILE_SECRET_KEY`, `BREVO_API_KEY` ou `SMTP_*`,
`HELLOASSO_*`. Worker planifié : `workers/cron/` (déclenche `/api/cron`). Prévisualisations : `APP_ENV=preview`
avec des ressources de staging distinctes.

## Dette connue (prochains lots)

1. L'organisation de démonstration est encore **amorcée par la migration 1** et plusieurs replis portent son nom
   (`DEMO_ORG_ID`, `DEMO_DOMAINS`, `LEGACY_MIRROR`, `ADMIN_PASSWORD` et secrets HelloAsso globaux) : à remplacer par
   la création d'organisations depuis une console plateforme et des secrets chiffrés par organisation.
2. Textes des e-mails et PDF encore rédigés pour le club fictif (`confirmation-email.js`) : à alimenter depuis
   `organizations` (nom, e-mail, adresse, réseaux).
3. Comptes et rôles (président, secrétaire, coach) + espace famille/adhérent : un seul mot de passe admin par club aujourd'hui.
4. Apports ASC Muay Thai : adhérents adultes (sans responsable), règle mineur/majeur, pièces et tarifs configurables
   par club, sections palmarès / galerie / vidéos, cours particuliers, statut compétiteur, fédération et niveaux par sport.
5. Vocabulaire encore football (U6-U9, licence FFF, tenue) dans le club fictif et certains libellés.
6. Images du club fictif = aplats de couleur générés : à remplacer par des visuels neutres.

## Règles

- Répondre en français. Aucune donnée personnelle réelle dans le dépôt, les tests ou les captures.
- Ne créer aucune ressource Cloudflare, ne rien déployer, ne rien committer sans demande explicite.
