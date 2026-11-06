# Références concrètes : ASC Muay Thaï et Saint-Gratien FC

Étude du 4 novembre 2026, à la demande du propriétaire qui gère ces deux clubs. Ce sont des références fonctionnelles et visuelles réelles pour Licyo, pas des données à importer automatiquement.

## Périmètre et preuves

Sites publics consultés dans le navigateur :
- https://www.asc-muaythai.fr/
- https://saintgratienfc.fr/

Sources consultées en lecture seule :
- ASC : Abudara25/asc-muaythai, main au commit `7995af9419b12d9db1afa4ac3590a60a2aa2cb73`. Le projet applicatif est dans le sous-dossier `asc-muaythai/`.
- Saint-Gratien : Abudara25/SaintGratienFC, main au commit `6edd44500c1718aa80bd5e021d78fed210ed777d`. Ce dépôt est privé ; son accès demande les droits GitHub du propriétaire.

Les interfaces publiques ont été regardées réellement. Les capacités des back-offices ci-dessous sont établies par le code des écrans, des routes et des services, pas par une session de gestion de dossiers réels. Aucun formulaire d’inscription, e-mail, paiement, changement de contenu ou accès aux documents des adhérents n’a été exécuté. Il ne s’agit pas d’un audit exhaustif de sécurité ni d’une certification de fonctionnement en production.

## 1. Deux directions graphiques démontrées

### ASC : immersion et richesse éditoriale

Fond sombre, accents rouges, photographie de grande taille, typographie condensée et très marquée. La page donne une place aux disciplines, à la pratique féminine, aux différentes tranches d’âge, au palmarès, au planning, aux cotisations et aux demandes de cours particuliers. Les pages galerie et vidéos prolongent cette identité.

À reprendre : force des médias, mise en avant des disciplines et publics, preuve de la vie du club, liens directs entre présentation, horaires et adhésion. L’état d’ouverture des inscriptions est également affiché sur la vitrine, pas seulement dans l’administration.

### Saint-Gratien : identité associative et parcours familial

Bordeaux, or et crème, diagonales, blason mis en avant, navigation claire, actions inscription/essai, repères pratiques et projet du club. Le public est orienté vers les catégories, les créneaux, les actualités et la préinscription.

À reprendre : cohérence d’une identité complète, informations pratiques immédiatement accessibles, inscription et liste d’attente reliées au parcours des familles. Ne pas conserver les catégories ou la logique « enfant + parent » pour toutes les associations : un adulte doit avoir un parcours adapté.

### Conséquence pour les trois modèles Licyo

Les deux premières directions constituent des références concrètes : identité de club avec diagonales ; univers immersif avec photographie. Le troisième modèle reste à concevoir, par exemple une composition éditoriale claire adaptée à un club de cours ou multisport. Cette troisième direction est une proposition, pas une réalisation historique retrouvée.

Un modèle doit modifier composition, hiérarchie, place des médias et manière de présenter les contenus. Trois palettes sur la même page ne suffisent pas. Tous les modèles restent utilisables par tous les sports ; ni football ni combat ne détermine le thème imposé.

## 2. ASC : ce que le back-office gère déjà dans le code

Navigation de `asc-muaythai/admin.html` :
- ouverture/fermeture des inscriptions, réouverture et réglages des réinscriptions ;
- coordonnées publiques ;
- adhérents avec recherche, filtres de paiement, documents manquants et export CSV ;
- horaires et tarifs/cotisations ;
- palmarès et photographies associées ;
- galeries par rubrique ;
- partenaires ;
- actualités ;
- vidéos ;
- sécurité du compte.

Parcours adhérent : section, saison, cotisation, mode de règlement, aide, état du paiement, documents attendus, ajout de justificatifs/attestation, relance et réinscription préremplie. Le parcours de complétion présente les seules pièces encore attendues.

Les demandes de cours particuliers recueillent niveau, disponibilités et objectif, puis passent par l’e-mail. Ce code ne prouve pas l’existence d’un agenda de réservation ni d’un suivi CRM complet de ces demandes. Dans Licyo, les transformer en demandes attribuables et suivies serait une amélioration à construire.

Sources :
- [Administration ASC](https://github.com/Abudara25/asc-muaythai/blob/7995af9419b12d9db1afa4ac3590a60a2aa2cb73/asc-muaythai/admin.html)
- [Service contenu et adhérents](https://github.com/Abudara25/asc-muaythai/blob/7995af9419b12d9db1afa4ac3590a60a2aa2cb73/asc-muaythai/api/admin/save-content.js)
- [Demande de cours](https://github.com/Abudara25/asc-muaythai/blob/7995af9419b12d9db1afa4ac3590a60a2aa2cb73/asc-muaythai/api/cours-particulier.js)
- [Routage des écrans et services](https://github.com/Abudara25/asc-muaythai/blob/7995af9419b12d9db1afa4ac3590a60a2aa2cb73/asc-muaythai/vercel.json)

## 3. Saint-Gratien : ce que le back-office gère déjà dans le code

Le tableau de bord oriente vers les actions en attente et signale les automatisations qui ne passent plus. La page « À traiter » regroupe des tâches déterministes : dossiers à vérifier, pièces de licence refusées/manquantes, étapes fédérales, paiements au club, familles à relancer, tenues et doublons à examiner.

La fiche adhérent organise les informations autour de la prochaine action, des responsables à contacter, des documents, des e-mails envoyés et de l’historique. Les notes internes sont repliées pour éviter leur affichage lorsque le responsable montre son téléphone à une famille. Les raccourcis de contact et de copie répondent au travail réel du bénévole.

Le suivi distingue cinq étapes de licence et l’état de chaque pièce. Un numéro de licence ne signifie pas que la fédération a validé le dossier. Les étapes et pièces refusées donnent des actions ciblées. L’import d’un export Footclubs propose un rapprochement avec aperçu avant écriture et conserve les cas ambigus sans fusion automatique. Il ne constitue pas une synchronisation API avec la FFF.

Préinscriptions : plusieurs groupes, capacités, distinction entre création d’un nouveau groupe et liste d’attente pour un groupe existant, invitation avec délai, rappel et expiration. Le dossier commencé est conservé. Une attente de validation par le club ne doit pas pénaliser une famille qui a effectué les démarches demandées dans les temps.

Sources privées, accessibles au propriétaire :
- [Tableau de bord](https://github.com/Abudara25/SaintGratienFC/blob/6edd44500c1718aa80bd5e021d78fed210ed777d/functions/admin/dashboard.js)
- [Règles « À traiter »](https://github.com/Abudara25/SaintGratienFC/blob/6edd44500c1718aa80bd5e021d78fed210ed777d/functions/_shared/todo.js)
- [Fiches adhérents](https://github.com/Abudara25/SaintGratienFC/blob/6edd44500c1718aa80bd5e021d78fed210ed777d/functions/_shared/crm-ui.js)
- [Étapes licence et tenue](https://github.com/Abudara25/SaintGratienFC/blob/6edd44500c1718aa80bd5e021d78fed210ed777d/functions/_shared/club-followup.js)
- [Import Footclubs](https://github.com/Abudara25/SaintGratienFC/blob/6edd44500c1718aa80bd5e021d78fed210ed777d/functions/_shared/footclubs-import.js)
- [Délais des invitations](https://github.com/Abudara25/SaintGratienFC/blob/6edd44500c1718aa80bd5e021d78fed210ed777d/functions/_shared/preinscription-deadlines.js)

## 4. Traduction en produit Licyo

| Besoin observé | Socle commun Licyo | Option ou configuration |
| --- | --- | --- |
| Identité de chaque club | Logo, palette, médias, navigation, pages et publication | Modèle choisi indépendamment du sport |
| Horaires et cotisations | Activités, groupes, lieux, séances, saisons et tarifs | Âges, niveaux, loisir/compétition |
| Mineurs et adultes | Personnes, adhésions et relations familiales explicites | Responsable légal seulement si nécessaire |
| Dossier incomplet | Liste des pièces attendues, complétion et validation | Exigences configurées par club/activité et saison |
| Paiement et attestation | Sommes dues/reçues, modes, justificatifs et historique | Prestataire et échéancier ; distincts de l’abonnement SaaS |
| Licence fédérale | Parcours d’étapes et états de pièces configurables | Adaptateur Footclubs optionnel, autre fédération possible |
| Équipements | Commande/remise et suivi de distribution | Module facultatif, vocabulaire du sport |
| Préinscription | Capacité, liste d’attente, invitation et échéance | Création de groupe distincte de libération d’une place |
| Cours particuliers | Demande, responsable, statut et prochaine action | Agenda/réservation à construire séparément si utile |
| Communication | Modèles, relances ciblées, historique et préférences | WhatsApp/SMS selon canaux autorisés, sans envoi automatique implicite |
| Vie du club | Actualités, événements et partenaires | Palmarès, galeries thématiques, vidéos à activer |
| Travail quotidien | Vue « À traiter » alimentée par les règles métier | Priorités du rôle, groupes ou clubs attribués |

L’inscription, la conformité du dossier, le paiement, la licence fédérale et la remise d’équipement sont des états distincts. Aucun booléen « complet » ne doit cacher toutes ces étapes.

Les règles de pièces et les montants présents chez les pilotes sont des réglages historiques de ces clubs. Ils ne deviennent pas des obligations universelles ni des prix SaaS Licyo.

## 5. Écarts avec la version Licyo publiée bc2cf02

La base publiée propose déjà inscription et paiements, renouvellement, dossier familial, modules, galerie, demandes de cours et sept sections de vitrine. Cela ne couvre pas encore la profondeur observée chez les pilotes.

Priorités à reprendre dans les lots de VISION_ET_CROISSANCE.md :
1. Enrichir le moteur de site et les trois identités à partir de ces références. Dépasser les formes de remplacement abstraites ; conserver aperçu, brouillon et publication versionnée comme cible.
2. Construire une fiche adhérent structurée avec prochaine action et statuts indépendants ; couvrir le dossier, le paiement, les contacts et l’historique avant les options sportives.
3. Ajouter une file « À traiter » fondée sur les règles existantes et adaptée au rôle ; éviter un simple tableau de compteurs sans suite.
4. Préparer les parcours configurables de licence, d’équipement et de liste d’attente. L’import fédéral est une option contrôlée avec aperçu et ambiguïtés visibles.
5. Compléter les modules éditoriaux manquants : palmarès, vidéos, galeries thématiques, et le suivi des demandes de cours.
6. Relier accompagnement et support Licyo aux problèmes des clubs, sans confondre tâches du club et incidents de la plateforme.

## 6. Ce qu’il ne faut pas recopier

Conserver les parcours utiles, pas les limites d’une application mono-club. Ne pas importer directement un mot de passe d’administration commun, des coordonnées en dur, un stockage sans isolation tenant ou un verrou de fichier comme architecture du SaaS.

Les choix de stockage et d’authentification d’un déploiement mono-club ne constituent pas le modèle d’autorisation du SaaS. Conserver le stockage privé des pièces, les autorisations serveur et les contrôles par club de Licyo. Aucun objet ni document d’adhérent réel n’a été demandé pendant cette étude.

Ne pas publier d’extraits de code privés ou d’informations de dossiers dans une documentation publique. Les exemples Licyo utilisent des clubs et personnes fictifs. La migration réelle d’ASC ou de Saint-Gratien constitue une opération distincte, avec inventaire, correspondance des champs et validation explicite.

## 7. Recette avec deux clubs fictifs

- Club A, football : mineur + deux responsables, préinscription, invitation, dossier, paiement, étapes fédérales et tenue.
- Club B, combat : mineur et adulte, plusieurs pratiques/niveaux, documents configurés, cotisation, demande de cours et contenus photo/vidéo.
- Chaque club peut choisir n’importe lequel des trois modèles et activer ses modules ; B ne voit aucune étape FFF si elle n’est pas configurée.
- Une donnée métier corrigée est cohérente entre planning, tarif public, inscription et back-office.
- Une famille ayant terminé ses démarches n’est pas expirée à cause du retard administratif du club.
- Un import ambigu ne modifie aucune personne automatiquement.
- Une note interne n’apparaît jamais dans l’espace famille, une attestation ou un e-mail.
- Les modèles et tâches respectent rôles, périmètres, isolation entre clubs et préférences de mouvement.

Ces scénarios deviennent des critères de reprise concrets pour Claude Code et Codex. Ils décrivent une cible et ne prouvent pas sa livraison actuelle.

## 8. Sports et photos à prévoir au lancement

Le catalogue de lancement vise sept packs photo : football, muay thaï, boxe anglaise, handball, basketball, judo et karaté. Les pilotes football et muay thaï ouvrent la recette. Les autres packs sont activés à mesure que leurs visuels et leurs parcours sont prêts. Judo et karaté appartiennent à la famille Arts martiaux, avec des visuels et réglages distincts. Les trois modèles Club, Arena et Studio restent disponibles pour chaque sport.

Objectif de départ : 20 photos par sport et 12 images communes, soit 152 images à sélectionner. Pour chaque discipline, prévoir au moins quatre images montrant des enfants, quatre des adolescents, quatre des femmes adultes et quatre des hommes adultes, ainsi que quatre photos de matériel ou de lieux. Varier filles et garçons, séances mixtes, entraînement loisir et compétition selon la réalité de la discipline. Les recadrages d’une même photo ne comptent pas comme des images supplémentaires.

L’éditeur propose Mes photos et Bibliothèque Licyo dans chaque emplacement compatible. Filtrer par discipline, public représenté, usage (couverture, activité, galerie) et orientation. Proposer des couvertures utilisables sur mobile et ordinateur pour plusieurs publics de chaque sport. Garder les photos d’illustration distinctes des portraits des équipes, des entraîneurs et des événements réels du club.

Conserver source, auteur, licence, crédit et statut des autorisations avant publication, en particulier pour les mineurs reconnaissables. Vérifier la discipline et l’équipement visibles pour éviter les images génériques mal classées.

Exemples de recherche :
- [Mini-handball enfants, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Kids_playing_Mini_handball_02.jpg), CC BY-SA 4.0.
- [Basketball féminin, Pexels](https://www.pexels.com/photo/group-of-athletes-playing-basketball-on-the-court-6767214/).
- [Judo enfants, Pexels](https://www.pexels.com/photo/kids-during-judo-class-19437725/).
- [Judo adulte en binôme, Pexels](https://www.pexels.com/photo/woman-and-man-training-on-combat-sports-6765028/).
- [Karaté féminin, Pexels](https://www.pexels.com/photo/two-women-training-martial-arts-6005457/).

