# Licyo

Plateforme multisport : site commercial, vitrines de clubs, gestion des associations, espace adhérent/famille et pilotage central.

## Reprendre dans VS Code avec Claude Code

Lire d’abord `CLAUDE.md` et `AGENTS.md`, puis les quatre documents obligatoires :
- [Vision et croissance](docs/VISION_ET_CROISSANCE.md) : équipe Licyo, permissions, produit et priorités.
- [Historique et reprise](docs/HISTORIQUE_ET_REPRISE.md) : références originales et direction visuelle.
- [État de la refonte](docs/REFONTE.md) : code livré, migrations, validations et limites.
- [Clubs pilotes](docs/REFERENCES_CLUBS_PILOTES.md) : exemples ASC Muay Thaï et Saint-Gratien FC, parcours et scénarios de recette.

Cette version est une base de travail à poursuivre. Les droits des futurs salariés, le retour au niveau du prototype historique et le moteur complet de publication sont documentés comme travaux à réaliser ; ils ne sont pas tous implémentés.

## Démarrage local

Prévoir une version récente de Node.js prenant en charge les scripts TypeScript natifs utilisés par les tests (Node 22.18 ou ultérieur, ou Node 24).

```sh
npm ci
npm run dev
```

Ouvrir http://localhost:3000. Sans configuration des services, les pages marketing et `/decouvrir/club`, `/decouvrir/adherent`, `/decouvrir/pilotage`, `/decouvrir/modules` et `/decouvrir/site` permettent d’examiner les interfaces avec des données fictives.

Pour les parcours connectés, créer localement `.env.local` à partir de `.env.example` et renseigner les services nécessaires. Ne jamais committer ce fichier. Les valeurs d’exemple ne sont pas des identifiants opérationnels. Le Mode Miroir nécessite une clé HMAC aléatoire d’au moins 64 caractères ; ne pas réutiliser la phrase d’exemple.

## Base de données et services

Les migrations se trouvent dans `supabase/migrations/` et s’appliquent dans l’ordre 0001, 0002, 0003 sur un environnement de recette avant toute mise en service. Si 0001 est déjà appliquée, ne pas la rejouer. La livraison du code sur GitHub n’applique aucune migration distante.

Les tarifs restent à définir depuis le pilotage. Les parcours réels Supabase, Stripe et e-mail demandent encore une recette avec leurs services configurés. Aucun paiement réel n’est nécessaire pour consulter les aperçus.

## Vérifications

```sh
npm test
npm run test:db
npm run typecheck
npm run build
```

`test:db` utilise Postgres embarqué (PGlite), sans données ni connexion de production. Pour lancer un build pendant qu’un serveur de développement fonctionne, utiliser un autre `NEXT_DIST_DIR` ; sous PowerShell :

```powershell
$env:NEXT_DIST_DIR='build-verify'
npm run build
```

La vérification visuelle doit inclure 360, 768 et 1440 px. Le script `scripts/verify-redesign.mjs` est une aide locale avec Playwright/Chrome ; il ne remplace pas l’inspection du rendu.

## Références historiques

La console Platform et le thème à diagonales restent accessibles dans l’historique Git au commit `a39d12541e27777eef0f3f3761ccdff805d3e2d2`. Les liens de fichiers immuables sont fournis dans la documentation. Le serveur d’archive local utilisé pendant l’étude ne fait pas partie du produit et n’est pas nécessaire pour reprendre le développement.

## Hébergement

Voir [deploy/README.md](deploy/README.md). Le déploiement et la configuration distante constituent des opérations distinctes de la publication du code sur GitHub.
