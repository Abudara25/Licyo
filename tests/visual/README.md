# Tests visuels du site public (phase 4B)

Filet de sécurité avant l'extraction du moteur de site (phases 4C et suivantes) : le rendu de Club Exemple
ne doit pas changer tant qu'aucune modification visuelle n'a été demandée.

## Lancer

```
npm --prefix tests/visual install                            # une fois : @playwright/test, installé ICI seulement
npx --prefix tests/visual playwright install chromium        # une fois : navigateur fixé par la version de Playwright
npm run visual                                               # compare au rendu de référence
npm run visual:baseline                                      # régénère les captures de référence
UPDATE_STYLE_SNAPSHOT=1 npm run visual                       # régénère l'instantané des styles et des tokens
```

Ne régénérer une référence qu'**avant** une modification voulue du rendu, jamais pour faire passer un test.
Ces tests ne font pas partie de `npm test` / `npm run check` : ils demandent un navigateur.

Les dépendances sont dans `tests/visual/package.json`, **pas** dans le `package.json` racine : Cloudflare Pages
publie la racine telle quelle et installe les dépendances qu'il y trouve ; le déploiement du site doit rester
strictement celui d'avant (aucune dépendance, aucun build).

## Contenu

| Fichier | Rôle |
|---|---|
| `playwright.config.mjs` | Chromium de Playwright, 1× (`deviceScaleFactor`), fr-FR / Europe/Paris, mouvement réduit, tolérance nulle. |
| `server.mjs` | Serveur local : dossier publié (`dist/`, reconstruit au démarrage par `scripts/build-public.mjs`), articles fictifs (`fixtures/articles.json`), page article rendue par la vraie Function, `/api/inscription-status` ouvert, `/api/categories` indisponible (le formulaire garde les valeurs écrites dans la page). D1 simulée en mémoire (node:sqlite) pour résoudre l'organisation de la page article ; aucun service externe, aucune donnée réelle. |
| `screenshots.spec.mjs` | 11 pages × 360/768/1280/1440 px (pleine page), header initial et après défilement, menu mobile fermé et ouvert (≤ 880 px). Tolérance **nulle**. |
| `computed-styles.spec.mjs` | Styles calculés de ~80 éléments et pseudo-éléments à 360/768/1280 px, comparés à `computed-styles.snapshot.json` ; inventaire des tokens `:root`, media queries, animations et polices comparé à `tokens-inventory.json`. |
| `legacy-tokens.spec.mjs` | Phase 4C : chaque token historique (`--maroon-*`, `--gold-*`, `--color-*`, `--shadow-*`…) appliqué à un élément sonde garde la valeur calculée de la référence capturée avant l’extraction du thème (`legacy-tokens.reference.json`). |
| `decorations-responsive.spec.mjs` | Assertions nommées : diagonales et halos (hero, header, en-tête de page, médias de cartes, visionneuse), bandeau d'appel, animation du blason ; comportements de part et d'autre de chaque point de rupture (1100/881/880, 900, 760, 700, 620, 560, 420) ; débordement et gouttière à 360/768 ; accessibilité de base (lien d'évitement, menu mobile, focus, champs à 16 px, cibles de 44 px, alt, mouvement réduit). |

## Recette admin, famille et éducateurs

`npm run journeys` depuis la racine lance la recette sur `127.0.0.1:4174`. Le serveur
`journeys-server.mjs` appelle les vraies Functions avec leurs middlewares de sécurité,
une base SQLite en mémoire, un KV et des buckets R2 simulés. Les e-mails sont interceptés ;
aucune requête ne part vers un service externe. Chaque test repart de données fictives.

Couverture : inscription par l'API, dépôts depuis le navigateur, vérification par le club,
acompte, correction des montants, solde ; ajout d'un éducateur, invitation, saisie des
certifications, photo et consultation admin ; rejets CSRF et origine ; navigation latérale,
recherche directe et menu « Plus » au clavier ; 13 écrans à 360, 768, 1024 et 1440 px
(débordements, gouttières, champs et dimensions tactiles). Captures et mesures dans
`.results/journeys/`, traces en cas d'échec. Le PDF et les paiements chez HelloAsso restent
hors de cette recette locale. Les captures sont à regarder avant de valider une modification.

Les deux suites sont séparées : `npm run journeys` ne compare et ne renouvelle aucune
référence de la suite visuelle publique.

`journeys/sidebar.e2e.mjs` vérifie aussi le mode compact de la barre latérale,
sa préférence après navigation/rechargement, les positions de défilement, les libellés
au survol et au clavier, ainsi que les replis sans stockage navigateur ou sans JavaScript.

## Stabilité

Polices chargées, images décodées, défilement complet de la page pour révéler les blocs `[data-reveal]` comme
pour un visiteur (puis attente de la fin de leur transition), `prefers-reduced-motion: reduce`, animations
figées par Playwright (le blason flottant revient à sa position initiale), fuseau et langue fixés,
`deviceScaleFactor` 1. **Rien n'est masqué.**

## Stockage des références

Les captures (`.baseline/<plateforme>/`, ~35 Mo) **ne sont pas versionnées** :

- le dépôt est aujourd’hui public ; même si `/tests/*` n’est plus servi par le site depuis la phase 4B.1
  (`functions/_shared/internal-paths.js`), versionner 35 Mo de binaires dans un dépôt public n’apporte rien ;
- le rendu d’un même CSS diffère légèrement d’un système à l’autre (polices, anticrénelage) : une référence
  Windows ne vaut pas pour Linux, et inversement ;
- en local, les captures sont reproductibles : tant que la phase 4C n’a pas commencé, le rendu n’a pas changé
  depuis la branche `feat/phase4b-safety-net`, donc `npm run visual:baseline` recrée exactement la référence.

**Référence durable : la CI Linux** (`.github/workflows/visual.yml`, depuis la phase 4B.1). Sur `main`, la
référence Linux est générée puis vérifiée à chaque push, et conservée 90 jours comme artefact
`visual-baseline-linux`. Sur une branche ou une pull request, le job télécharge la dernière référence de `main`
et compare à tolérance nulle ; **sans référence de `main` (jamais générée ou expirée), le job échoue**
(`fetch-main-baseline.sh`) : une branche ne fabrique jamais sa propre référence (phase 4B.2). Seul `main` (push
ou « Run workflow ») génère et publie la référence. Récupérer une référence : `gh run download <run> --name
visual-baseline-linux`. Le dépôt est privé depuis le 2026-09-24 : les artefacts ne sont accessibles qu’aux
collaborateurs. On pourra aussi versionner `.baseline/linux/` (Git LFS).

Les références texte (`computed-styles.snapshot.json`, ou `computed-styles.snapshot.<plateforme>.json` si les
mesures diffèrent selon le système, et `tokens-inventory.json`) sont versionnées : elles ne contiennent que des
valeurs CSS publiques. Les valeurs mesurées à chaque exécution sont écrites dans `.results/`
(`computed-styles.actual.<plateforme>.json`), récupérable dans l artefact `visual-report` en cas d’échec.
# Habillage CRM

La recette couvre aussi Catégories, Paramètres, Pré-inscriptions, Réinscription, E-mails et Événements (19 vues à chaque largeur), ainsi que les filtres ouverts, le menu d’actions de fiche et la connexion à 360/768 px. Regarder les captures après toute modification de l’habillage commun.
