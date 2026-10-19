# Console Platform — prototype visuel

Maquette navigable de la **console Platform** (plan de contrôle) : l'outil de l'éditeur pour gérer toutes les
organisations clientes. Ce n'est ni l'admin d'un club (`/admin`), ni l'espace famille.

## Nom du produit

« Licyo » est le **nom du produit**. Il est défini à un seul endroit,
`src/config/brand.js` (`productName`, `productShortName`, `platformName`, `platformLabel`, `productDescription`,
`workingName`), et aucun composant ne l'écrit en dur (vérifié par `tests/platform-prototype.test.mjs`).
Pour changer de nom : modifier ce fichier, rien d'autre. Le nom n'est jamais un domaine, un paquet, une table,
une API, une permission, un rôle, un préfixe métier ni un identifiant persistant ; les domaines fictifs sont en
`.example` (`clubs.example`, `platform.example`).

## Voir le prototype

```
npm run platform:preview
```

Puis ouvrir <http://127.0.0.1:4310/>. Raccourcis : `Ctrl K` ou `/` (recherche rapide), `Échap`.
Le menu « Platform Preview » de la barre du haut simule les états de chargement, vide et erreur.

## Garde-fous

- **Données fictives uniquement**, toutes dans `src/data/fixtures.js`. Domaines en `.example`, adresses IP des
  plages de documentation, masquées. Aucune donnée de production ni donnée personnelle réelle.
- **Aucune requête réseau** : la page n'appelle aucune API, et le serveur local impose `connect-src 'none'`.
- **Aucun stockage** : ni cookie, ni `localStorage`. L'état vit en mémoire et disparaît au rechargement.
- **Aucune session, aucun rôle, aucune autorité côté client.** *UI visibility is not authorization* : la future
  console décidera chaque action côté serveur (permission, MFA, audit), sur un domaine distinct de ceux des
  clubs (ADR-018).
- **Isolé du produit** :
  - jamais publié (hors de l'allowlist de `scripts/build-public.mjs`) ;
  - refusé par `functions/_shared/internal-paths.js` sur tout domaine de club ;
  - servi seulement sur `127.0.0.1`.
- Les trois états d'une organisation restent distincts (ADR-003) : cycle de vie, facturation, accès.
- Les modules distinguent capacité, droit, drapeau et configuration (ADR-013).
- Les offres Starter, Club et Pro sont des **exemples d'interface**, non normatifs.

## Structure

| Dossier | Contenu |
|---|---|
| `index.html` | page unique, charge `src/main.js` (modules ES natifs, sans build) |
| `styles/` | tokens, base, shell, composants, pages |
| `src/lib/` | gabarits HTML échappés par défaut, formats, logique pure (filtres, tri, disponibilité des modules) |
| `src/data/` | données fictives et libellés d'états |
| `src/components/` | Sidebar, Topbar, PageHeader, Card, MetricCard, Badge, DataTable, Tabs, Modal, Toast, Dropdown, EmptyState, Skeleton, graphiques, champs, palette de recherche |
| `src/pages/` | Dashboard, Organisations, fiche (8 onglets), Onboarding (assistant 9 étapes), Domaines, Plans, Santé, Support, Audit, Paramètres |

## Tests

- `npm test` : `tests/platform-prototype.test.mjs` (logique, données fictives, sécurité statique, isolement).
- `npm run platform:e2e` : parcours dans Chromium (`tests/visual/platform-prototype/`). Il couvre :
  - la navigation, les onglets, les filtres, l'assistant, les modales et la palette de recherche ;
  - l'absence de réseau et de stockage ;
  - le responsive à 360, 768 et 1440 px ;
  - les captures, dans `tests/visual/.platform-screens/`.

  Il faut d'abord installer les dépendances : `npm --prefix tests/visual ci`.
