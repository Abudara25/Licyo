# Refonte Licyo
## Décisions
- Application Next.js et base Supabase conservées ; migrations additives.
- Le club constitue la frontière de données. Les trois modèles Club, Arena, Studio sont disponibles pour tous les sports.
- La grille dépend du nombre d’adhérents déclaré, puis comparé à l’effectif réel. Aucun prix n’est activé par défaut ; le propriétaire définit les prix et les Price Stripe.
- Modules facultatifs indépendants du modèle visuel. Les écrans et actions serveur appliquent les mêmes réglages.
- Espace famille lié à un compte dont l’adresse est confirmée, et à des droits explicites sur les dossiers. Aucun identifiant fourni par le navigateur ne confère un droit.
## Références consultées
SaintGratienFC : catégories, préinscriptions, dossiers, relances, accès famille à durée limitée.
asc-muaythai : sections, documents parentaux, cotisations, demandes de cours particuliers.
Aucune donnée personnelle de ces dépôts n’est importée.
## Mise en service
Appliquer 0002 à 0005 après 0001 sur une copie restaurée. Configurer Supabase Auth (URL du site et callback), les variables .env.example, puis les prix depuis le pilotage. Ne pas appliquer les migrations directement en production sans sauvegarde restaurable.
Les pages /decouvrir sont des aperçus publics avec données fictives, sans accès à la base ni contournement d’authentification.
## Retour arrière
Revenir au code précédent sans supprimer les nouvelles tables. Désactiver les nouveaux parcours si nécessaire ; ne pas rétablir les anciennes permissions excessives.


## Validation locale
- Compilation de production réussie sous Windows avec NEXT_DIST_DIR=build-verify ; Docker/Linux conserve le mode standalone. La construction de l’image Docker n’a pas été exécutée.
- 12 tests applicatifs passent ; les trois migrations et les régressions d’isolation sont validées sur Postgres embarqué.
- Interfaces d’aperçu inspectées réellement à 360 et 768 px : accueil, tarifs, modèles, club, famille, modules et pilotage. Gouttières 16/24 px et alignement des cartes contrôlés.
- Les parcours authentifiés avec Supabase réel, les envois e-mail et les paiements Stripe doivent encore être vérifiés en recette avec les services configurés. Aucun paiement, e-mail ou déploiement de service n’a été effectué pendant cette refonte. La publication du code sur GitHub a été demandée séparément par le propriétaire.
- Aperçu local : http://127.0.0.1:4174. Les données fictives sont confinées aux pages de présentation et /decouvrir.

## Pilotage et vitrines composables
Le pilotage propriétaire utilise ControlShell, indépendant de l’interface club : navigation bleu nuit, parc clients filtrable, alertes de démonstration et suspensions, répartition des comptes et pipeline. Les données réelles restent réservées au super-administrateur ; les aperçus utilisent des exemples explicitement fictifs.

La composition des vitrines appartient à club_site_settings, avec une ligne par club. Sept sections disponibles, ordre personnalisable et activation indépendante. Les sections sans contenu ou dont le module est désactivé ne s’affichent pas. Les gestionnaires président/secrétaire et le propriétaire peuvent enregistrer ; les lecteurs publics n’accèdent qu’aux réglages des clubs publics. Aucun HTML libre n’est accepté. Les quatre modèles utilisent la même composition et conservent leur style. Les animations d’apparition sont progressives et respectent prefers-reduced-motion.

Migration 0003 additive : sans réglage enregistré, la composition historique reste utilisée. Retour arrière possible en revenant au code précédent, sans supprimer la table. Contrôles locaux : masquage et déplacement réellement testés dans le navigateur, écriture par un club tiers et par un coach refusée, lecture publique d’un club suspendu interdite. La validation avec Supabase hébergé reste à réaliser.

## Médiathèque de vitrine

La migration 0004 enregistre les choix de photos par section et par club. La première sélection contient 20 références Pexels réparties entre sept sports. La démo permet de tester le catalogue et une photo locale. Le back-office utilise les photos déjà importées dans la galerie du club. Les sources et crédits restent accessibles dans la médiathèque. Les photos Pexels du catalogue ont une attribution facultative, donc leur auteur n’est pas superposé aux vitrines. Une image exigeant un crédit conserve une mention discrète. Les droits des personnes reconnaissables sont à vérifier avant publication.

## Quatre directions de vitrine

Les modèles validés sont Tribune (identifiant `arena`), Maison du club (`club`) et Signal (`studio`). Héritage (`heritage`) reprend les diagonales, le contraste bordeaux/or et la place du blason de la vitrine Saint-Gratien FC. Les contenus, blasons et données sont ceux du club Licyo. Les identifiants historiques restent valides et la migration 0005 accepte le nouveau modèle à l’inscription. Les sections activées, leur ordre et les images du club suivent le même moteur pour les quatre directions.

Vérifications du lot visuel. Les quatre directions ont été regardées à 360 et 768 px. Le catalogue utilise une, deux ou quatre colonnes selon la largeur. Les créneaux de Maison du club et les raccourcis de Signal sont reliés aux contenus du club. La base embarquée valide la création avec Héritage et le refus d’un modèle inconnu. La migration 0005 reste à appliquer sur la recette hébergée.

Référence des conditions d’attribution Pexels vérifiée le 9 novembre 2026. https://www.pexels.com/license/

## Bascule sur Cloudflare (9 novembre 2026)

Décision du propriétaire : tout sur Cloudflare, plus de Supabase. Réalisé et vérifié en local :

- Schéma traduit en SQLite (`migrations/0001_schema_d1.sql`) : contraintes, index, vues publiques et triggers « même club » à la place des clés composées.
- Règles d'accès de la RLS transcrites dans `src/lib/db/policies.ts`, appliquées à chaque requête par `src/lib/db/query.ts` (API proche de supabase-js, d'où un diff limité dans les pages). Refus par défaut. 11 tests d'isolation dans `tests/db-policies.test.ts` (club A/B, entraîneur, famille, colonnes sensibles, super_admin, upsert, RPC).
- Fonctions Postgres `provision_club`, `claim_family_access`, `increment_page_view` réécrites dans `src/lib/db/rpc.ts`.
- Comptes : liens de connexion à usage unique (15 min), sessions de 30 jours, empreintes SHA-256, limitation des demandes. Invitations d'équipe sans Supabase Auth.
- Fichiers sur R2 : `/media/...` pour les fichiers publics, `/api/files/private` avec jeton signé de 5 min pour les pièces des dossiers.
- E-mails : Cloudflare Email Service, ou journal tant qu'aucun domaine d'envoi n'existe. Gmail par `fetch`. Le SMTP privé n'est plus utilisable (repli sur la plateforme).
- Aperçu `wrangler dev` : pages publiques, vitrines `/<slug>`, quatre profils, droits par page, étanchéité entre clubs dans les pages rendues, validation d'un dossier depuis l'interface (écriture D1 et e-mail journalisé), captures à 360 et 768 px.

Ressources créées sur le compte Abiweb : D1 `licyo` (UE, schéma et données fictives appliqués). Restent bloquants avant la mise en ligne de test : activation de R2 dans le tableau de bord, offre Workers payante (Worker de 3,4 Mo compressé, au-dessus de la limite gratuite de 3 Mo), puis secrets et déploiement.

Limites connues : pas de cache incrémental (lectures D1 directes) ; Mode Miroir toujours en écriture complète (lot A) ; SMTP privé indisponible ; **PDF en panne sous Workers** (attestations, bilan AG, affiche, devis) : @react-pdf/pdfkit charge ses polices standard par un require() dynamique absent du bundle (« No such module #standard-fonts/Helvetica »). Les alias vers les builds navigateur cassent le réconciliateur React de @react-pdf. Piste : réécrire les 4 documents avec pdf-lib (pur JS) ; carte sociale (@vercel/og) non testée.
