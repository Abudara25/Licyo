# AGENTS.md

Consignes pour Codex (et tout agent de code) sur ce dépôt. **La référence complète est `CLAUDE.md`** : architecture,
historique des décisions, pièges connus. Lis la section concernée avant de modifier une partie du site. Ce fichier ne
reprend que l'essentiel ; en cas de doute, `CLAUDE.md` fait foi.

## Le projet

**Licyo** : plateforme site web + CRM pour clubs sportifs de tous sports. Code repris du site Saint-Gratien FC
(qui reste sur son propre dépôt), avec un **club de démonstration fictif** (« Club Démo », `org_demo`, Sportville).
Pas encore en production : aucune ressource Cloudflare n'est créée. Voir `CLAUDE.md` (dette à traiter, règles).

- Pages publiques HTML **générées** (moteur `renderer/`, configuration `sites/club-demo/`).
- Feuille publique `assets/css/styles.css` **générée** depuis `styles/`.
- Serveur : Pages Functions (`functions/`), base Cloudflare D1 (`DB`), KV (`INSCRIPTION_STATUS`), R2 (`DOSSIERS`).
- E-mails SMTP / Brevo ; paiements HelloAsso ; Worker programmé `workers/cron/` (relances, récapitulatif).

## Commandes

```
npm run pages   # régénère les pages HTML depuis sites/ et renderer/
npm run css     # régénère assets/css/styles.css depuis styles/
npm run sync    # empreintes ?v= des assets + pages (après toute modification de assets/css ou assets/js)
npm run build   # dossier publié dist/ (allowlist) + modules générés de functions/_generated/
npm run check   # vérifie que tout est à jour, puis lance tous les tests (node:test, D1 simulée par node:sqlite)
npm test        # tests seuls
```

Serveur local complet : `npm run build`, puis
`npx wrangler pages dev dist --d1 DB --kv INSCRIPTION_STATUS --r2 DOSSIERS --binding SETUP_SECRET=<test>`, puis `/admin/premier-acces`.

## Règles impératives

1. **Ne jamais modifier à la main** les pages HTML de la racine, `assets/css/styles.css`,
   `functions/_shared/asset-versions.js` ni `functions/_generated/` : modifier la source puis `npm run pages` /
   `npm run css` / `npm run sync`. `npm run check` échoue sinon.
2. **Données des adhérents non destructibles** : aucune suppression, écrasement, recréation de table, invalidation de
   jeton ou modification silencieuse de données réelles. Migrations additives uniquement, testées en local puis sur
   une copie de la production (`scripts/verify-d1-copy.mjs`). Toute opération destructive se propose et attend une
   validation explicite. Un export de production contient des données de mineurs : jamais commité, supprimé après usage.
3. **Organisation toujours résolue côté serveur** (domaine ou session), jamais lue dans une requête ; toute requête sur
   une table de `TENANT_TABLES` filtre `organization_id` (test statique `tests/tenant-scoping.test.mjs`).
4. **Sécurité** : échapper tout champ saisi par le public (`escapeHtml`), revalider côté serveur ce que le navigateur
   contrôle, CSRF automatique sur `/admin/*` (jeton injecté côté serveur), aucun mot de passe dans un e-mail, aucune
   pièce jointe fournie par le navigateur.
5. **Club de démo fictif** : aucune vraie ville, adresse ou personne en exemple ; inscription jamais présentée comme
   définitive avant paiement ; pas de déduction fiscale sur les dons.
6. **Front-end** : afficher la page et vérifier le rendu à 360 px et 768 px (gouttières, débordements, cibles tactiles
   ≥ 44 px, champs à 16 px), pas seulement des assertions.
7. **Git** : ne jamais committer, pousser ni fusionner sans demande explicite ; ne jamais forcer un push ni sauter les
   hooks. Répondre en français, de façon courte et directe.

## Où trouver quoi

| Sujet | Fichiers |
|---|---|
| Formulaire d'inscription | `renderer/registration.js`, `sites/club-demo/content/inscription.js`, `assets/js/inscription.js`, `functions/api/inscriptions.js` |
| Pré-inscription U10 | `functions/_shared/preinscriptions.js`, `functions/api/preinscriptions.js`, `functions/admin/preinscriptions.js`, `renderer/preregistration.js`, `assets/js/preinscription.js` |
| Aides à la saisie (communes, adresses) | `assets/js/naissance-autocomplete.js`, `assets/js/adresse-autocomplete.js` (géocodage IGN) |
| Admin (habillage, session, CSRF) | `functions/_shared/admin-auth.js`, `functions/_shared/csrf.js`, `assets/css/admin.css` |
| Fiche, vérification du dossier | `functions/admin/inscriptions/[id].js`, `[id]/apercu.js`, `[id]/verification.js`, `functions/_shared/admin-dossier.js` |
| Schéma D1 et migrations | `functions/_shared/schema.js`, `functions/_shared/inscriptions-db.js` (`ensureSchema`, raccourci par build) |
| Ouvert / fermé | `functions/_shared/settings-kv.js` (`getEffectiveInscriptionStatus`), revérifié par `functions/api/inscriptions.js` |
| E-mails | `functions/_shared/confirmation-email.js`, journal `functions/_shared/email-log.js` |
| Tâches programmées | `functions/api/cron.js`, `functions/_shared/automations.js`, `workers/cron/` |
| Fichiers jamais servis | `functions/_shared/internal-paths.js` (tout nouveau fichier interne à la racine doit y être ajouté) |

## Tests

Toute correction ou fonctionnalité s'accompagne d'un test dans `tests/` (D1 en mémoire, services externes simulés,
aucune donnée réelle). Tests visuels séparés : `tests/visual/` (Playwright, voir son README), références régénérées
seulement avant une modification voulue du rendu.
