Lire d’abord VISION_ET_CROISSANCE.md : la demande récente étend le pilotage à une équipe Licyo avec rôles et délégation. Le présent document conserve les références de reprise visuelle.

# Licyo — Reprise fondée sur l’historique, pour Claude Code

## Référence de reprise pour Claude Code et Codex

Tu reprends Licyo pour réaliser une plateforme multisport soignée et complète. La dernière refonte visuelle locale ne constitue pas une référence validée : le propriétaire a demandé de revenir aux interfaces historiques pour retrouver le niveau attendu. Ne te contente pas de changer les couleurs.

### Dossier de travail et état à préserver

Travailler dans le dépôt contenant AGENTS.md, CLAUDE.md et package.json. Dans la session d’origine, il se trouve sous `C:/Users/Gherari/.codex/.chatgpt-projects/g-p-6abbc57f9200819189fd72c2927fda55/licyo`. Vérifier le chemin effectif sur une autre machine.

Ce dossier contient une refonte locale NON COMMITTÉE. L’autre dépôt local dans OneDrive n’est pas cette copie de travail. Ne travaille pas dans la mauvaise copie et ne remplace pas les modifications présentes.

Lis AGENTS.md, CLAUDE.md et docs/REFONTE.md. Examine le diff avant toute édition. Aucun commit, push, PR, déploiement ni modification de service distant n’est demandé. Ne lis ni ne recopie les secrets des fichiers .env.

### Références historiques effectivement retrouvées

Ancienne base : dépôt Abudara25/Licyo, commit
`a39d12541e27777eef0f3f3761ccdff805d3e2d2` du 20 octobre 2026.

Elle est accessible en lecture dans l’historique du dépôt local :
`C:/Users/Gherari/OneDrive/Administratif/Documents/GitHub/ProjetsWeb/Licyo`
Utilise git show ou la copie extraite ci-dessous ; ne checkout/reset pas ce dépôt.

Copie de référence extraite sans modification des originaux :
`C:/Users/Gherari/.codex/.chatgpt-projects/g-p-6abbc57f9200819189fd72c2927fda55/historique-licyo`

- Console : prototypes/platform-crm/, notamment styles/tokens.css, src/components/shell.js, src/pages/dashboard.js et organization-detail.js.
- Vitrines : assets/css/styles.css, sites/starter.js, sites/club-demo/site.js, renderer/render.js, sections.js, blocks.js, validate.js.
- Éditeur historique : functions/_shared/site-editor.js et site-config.js, à lire dans le commit source.
- Ancienne interface club : assets/css/admin.css et functions/_shared/crm-ui.js, à lire dans le commit source.

Aperçus historiques, si le serveur de référence fonctionne :
- http://127.0.0.1:4312/console/#/dashboard
- http://127.0.0.1:4312/

Le serveur se relance avec `node historique-licyo/serve.mjs` depuis le dossier parent de licyo. Il ne fournit que des références locales. La console est un prototype à données fictives ; le site est une archive visuelle, sans API métier et sans tunnel fonctionnel. Ce ne sont pas des services de production à brancher tels quels.

Sources vérifiables :
- https://github.com/Abudara25/Licyo/tree/a39d12541e27777eef0f3f3761ccdff805d3e2d2/prototypes/platform-crm
- https://github.com/Abudara25/Licyo/blob/a39d12541e27777eef0f3f3761ccdff805d3e2d2/sites/starter.js
- https://github.com/Abudara25/Licyo/blob/a39d12541e27777eef0f3f3761ccdff805d3e2d2/functions/_shared/site-editor.js
- https://github.com/Abudara25/Licyo/commit/bb9e16de787bdc82d613961c733444ccb3867f77

Le commit du 28 octobre remplace l’ancienne base par Next.js/Supabase/Stripe. Ce constat explique la rupture ; il n’autorise pas un retour aveugle à toute l’ancienne architecture.

Conversations relues : « Afficher le CRM », « Structure du CRM sportif », « PR #13 visual », « Résumé production 4E1 », « Accès au dépôt GitHub » et « Structure visuelle multisite CRM ».
Les textes d’anciens assistants sont des indices historiques ; ne les présente pas comme une approbation explicite du propriétaire. Le code et les rendus consultés établissent ce qui existait réellement.

### Besoin actuel du propriétaire, prioritaire sur les anciens choix

- Un site principal Licyo vend la plateforme.
- Le club choisit une formule selon son nombre d’adhérents et l’un de TROIS modèles de vitrine.
- Les tarifs ne sont pas fixés : grille modifiable, montants non publiés tant qu’ils ne sont pas renseignés. Pas de facturation réelle pour une démonstration.
- Tous les sports, y compris clubs de football, sports de combat et associations multisports.
- Un back-office client pour gérer le site, les membres et les modules utiles.
- Un espace adhérent/famille.
- Un pilotage propriétaire avec une identité, une navigation et des tâches distinctes de celles d’un club.
- Des vitrines à la fois vivantes visuellement et composables par sections.

### Niveau de design à retrouver

Console propriétaire : reprendre la richesse et la hiérarchie du prototype historique, son interface claire, ses accents indigo, ses tableaux lisibles, ses graphiques contextualisés, ses filtres, sa recherche, ses fiches à onglets et ses vues d’exploitation. Les changements nécessaires pour adapter cette référence au produit actuel doivent être expliqués. Une sidebar sombre ajoutée à quelques cartes ne suffit pas.

Vitrines : conserver le caractère sportif de la référence à diagonales comme point de départ d’un des trois modèles. Concevoir deux autres compositions réellement distinctes, toutes compatibles avec tous les sports. Le choix d’un sport ne doit pas imposer un modèle. Utiliser les vrais médias configurés par le club, des titres travaillés, une hiérarchie éditoriale et des mouvements discrets. Les grandes formes abstraites ne doivent pas constituer l’essentiel du résultat final. Respecter la réduction des mouvements.

Ne recopie pas les noms, photos de personnes, prix ou textes football du club pilote dans les nouveaux clubs. Les exemples restent explicitement fictifs.

### Découpage visuel initial (complété par VISION_ET_CROISSANCE.md)

1. **Pilotage central** : porter le système visuel et les interactions utiles du prototype vers les composants React existants. Relier les listes, indicateurs et actions aux services disponibles. Traiter comptes clients, prospects, abonnements, modules et audit. Pour domaines, support et incidents, exposer honnêtement les états disponibles ; ne pas inventer de données de santé, de courbes, de tickets ou de commandes qui prétendent être réels. Conserver les contrôles serveur et la traçabilité du Mode Miroir.
2. **Moteur de vitrines** : remplacer la seule liste de sections par un véritable modèle structuré de pages et blocs autorisés : contenu, médias, ordre, visibilité, navigation, identité et thème séparés. Prévoir aperçu contextualisé, brouillon, publication explicite et révisions évitant l’écrasement concurrent. Migrer de manière additive depuis la composition actuelle, sans perdre les réglages. Ne jamais accepter de HTML, JavaScript ou classes arbitraires.
3. **Trois modèles complets** : accueil et pages utiles, photos, groupes/créneaux, événements, actualités, partenaires, contact et inscription selon les modules. Aucun bouton factice. États vides utiles.
4. **Espaces club et adhérent** : finitions cohérentes avec leurs tâches propres, vocabulaire sportif issu des presets, gestion des documents et familles, clarté des statuts et actions sur téléphone. L’espace adhérent n’est pas une version réduite de la console propriétaire.

Conserve Next.js/Supabase et les protections déjà mises en place. L’ancien moteur fournit une référence de séparation des responsabilités, pas un motif pour importer des dépendances Cloudflare ou effectuer une seconde réécriture globale.

### Recette et résultat exigés

Pour chaque lot terminé :
- commandes de validation adaptées, compilation et tests nécessaires ;
- isolation club A / club B et refus des rôles insuffisants pour toute nouvelle écriture ;
- vérification visuelle réelle à environ 360, 768 et 1440 px ;
- contrôle des gouttières, alignement des titres, cibles tactiles de 44 px, champs à 16 px, clavier, focus et réduction des mouvements ;
- captures et parcours permettant de vérifier le résultat ;
- distinction explicite entre aperçu fictif, fonctionnalité connectée et service encore non configuré.

Rends un seul récapitulatif utile par lot : changements, références réemployées, vérifications, limites réelles. Ne présente pas une interface de démonstration comme une fonctionnalit�� de production terminée.
