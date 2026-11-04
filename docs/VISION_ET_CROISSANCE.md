# Vision Licyo et construction pour la croissance

Statut : exigences et direction produit à construire. Ce document ne certifie pas que les capacités décrites existent déjà. Référence de décision : demande du propriétaire du 4 novembre 2026, incluant la future embauche d’employés et une démarche proactive.

## 1. Résultat recherché

Licyo doit permettre à une association de présenter son activité, recruter des adhérents et gérer sa saison sans outils dispersés. Son propriétaire doit pouvoir développer l’entreprise, recruter et déléguer en conservant le contrôle des opérations sensibles. Le produit couvre tous les sports et les clubs multisports ; aucun club pilote ne dicte le modèle commun.

Cinq expériences distinctes : site commercial Licyo ; vitrines publiques des clients ; back-office des clubs ; espace adhérent/famille ; console de l’équipe Licyo. Elles partagent un socle métier et des composants utiles, pas obligatoirement la même composition graphique ou la même navigation.

Parcours client : découverte → estimation selon l’effectif → choix d’un des trois modèles → création guidée → configuration → aperçu → publication → exploitation → renouvellement ou sortie avec récupération de ses données.

Les références historiques sont des points de départ à améliorer, pas une limite de qualité. Se reporter à HISTORIQUE_ET_REPRISE.md pour les sources et les limites de la référence.

## 2. Anticiper avec mesure

Avant chaque fonctionnalité, rechercher les besoins des utilisateurs voisins, les exceptions, les risques et les conséquences d’un volume multiplié par dix. Proposer les améliorations utiles dans le récapitulatif sans attendre que le propriétaire découvre les problèmes.

Construire les fondations coûteuses à changer dès le premier lot concerné : périmètre des permissions, isolation des clients, identité des personnes, états métier, révisions de publication, audit et extensibilité des modules. Différer les fonctions sans usage démontré : microservices, marketplace, franchises complexes, infrastructure surdimensionnée.

Une amélioration proposée se distingue d’un choix déjà validé. Les changements de modèle économique, les fournisseurs payants, les engagements de service et les opérations irréversibles ne sont pas autorisés par la seule demande d’être proactif. Continuer les travaux locaux utiles sans multiplier les demandes de confirmation.

## 3. Équipe Licyo : déléguer sans distribuer le compte propriétaire

Les rôles plateforme sont distincts des rôles club et des comptes adhérents. L’accès actuel super_admin ne constitue pas le modèle à reproduire pour tous les employés.

Chaque salarié possède un compte nominatif et des attributions explicites. Un rôle regroupe des permissions ; une permission décrit une action, une ressource et un périmètre. Le périmètre peut être les prospects attribués, les clubs attribués, une intervention temporaire ou l’ensemble du parc selon le métier. Refus par défaut, contrôles serveur sur chaque lecture et mutation, y compris exports et tâches asynchrones.

Matrice cible initiale, à implémenter progressivement :

| Profil plateforme | Accès normal | Limites par défaut |
| --- | --- | --- |
| Propriétaire | Stratégie, équipe, habilitations, tarifs, parc et supervision | Actions sensibles tracées ; pas de secrets ou de dossiers de santé exposés dans le dashboard |
| Administrateur délégué | Exploitation du parc et gestion déléguée définie explicitement | Ne transfère pas la propriété, ne s’accorde pas de permissions, ne modifie pas les secrets |
| Commercial | Prospects et clients attribués, démos, devis et relances | Aucun dossier d’adhérent, aucune modification d’accès ou de sécurité |
| Accompagnement client | Onboarding, configuration du site, progression des clubs attribués | Pas de documents personnels ni de tarifs contractuels hors autorisation |
| Support | Tickets attribués, métadonnées utiles, diagnostic et accès d’assistance accordé | Aucun accès global permanent aux familles ; pas de facturation ni de gestion des employés |
| Facturation | Contrats, abonnements, règlements SaaS et relances autorisées | Pas de dossiers sportifs, documents médicaux, identifiants bancaires complets ou clés de paiement |
| Exploitation technique | Santé des services, domaines, déploiements et diagnostics autorisés | Aucune lecture habituelle des données des adhérents ni décision commerciale |
| Lecture / audit | Rapports et journal selon habilitation, données minimisées | Aucune mutation ni export massif implicite |

Un employé peut cumuler plusieurs rôles si c’est explicitement accordé ; ce cumul ne doit pas contourner les restrictions de périmètre. Les identités techniques des tâches et intégrations ne sont pas des employés et utilisent des droits dédiés.

Exemples de permissions à affiner dans un registre central : platform.prospects.read_assigned, platform.organizations.read_assigned, platform.staff.invite, platform.roles.assign, platform.billing.manage, platform.support.session.start, platform.exports.create. Les noms sont une proposition de contrat, pas des capacités déjà disponibles. Éviter les chaînes de tests de rôle dispersées dans les écrans.

### Arrivée, évolution et départ d’un employé

- Invitation à usage unique avec expiration, compte nominatif et acceptation authentifiée ; aucun compte partagé.
- Rôle et périmètre attribués par une personne habilitée, avec aperçu des droits effectifs.
- MFA pour l’équipe plateforme avant ouverture de ces accès en production ; contrôle renforcé pour les actions les plus sensibles.
- Révocation effective des sessions, accès d’assistance, clés personnelles et attributions lors du départ ; ne pas se contenter de masquer un menu.
- Réaffectation des prospects, tickets et tâches sans perte d’historique.
- Revue périodique des droits et signalement des attributions anciennes ou sans justification.
- Protection du dernier propriétaire, procédure de récupération et transfert explicite de propriété. Un administrateur ne s’accorde jamais un rôle plus puissant que son droit de délégation.

### Actions sensibles et assistance

Journaliser l’auteur réel, l’organisation cible, la permission ou délégation utilisée, l’action, la date, le résultat et l’identifiant de corrélation. Ne pas y copier les pièces, mots de passe, tokens ou contenus médicaux. Prévoir conservation, accès au journal et export contrôlés.

L’assistance via Mode Miroir devient une session limitée, liée à un ticket ou motif, à un club, à une durée et à des capacités précises. Bandeau visible, fin explicite, lecture seule par défaut, accès aux données personnelles réduit au besoin et politique d’accord du club documentée. Conserver l’identité de l’employé, jamais prétendre qu’il est le président. La clé de service ne doit pas fournir un accès implicite depuis le navigateur.

Prévoir une politique d’approbation configurable pour transfert de propriété, élévation de droits, export massif, suppression définitive et opérations financières au-delà d’un seuil. Au démarrage, le propriétaire peut être l’approbateur ; à plusieurs, séparer demandeur et approbateur selon le risque. Aucune auto-approbation pour élargir ses propres droits. Ne pas bloquer les actions courantes et réversibles derrière des validations inutiles.

## 4. Console de direction et travail quotidien

Retrouver la hiérarchie du prototype historique clair à accents indigo, puis améliorer sa lisibilité et ses parcours. Prévoir :

- Vue direction : activité commerciale, revenu réellement mesurable, comptes à accompagner, risques et charge de travail.
- Portefeuille : fiche client, interlocuteurs, sport(s), sites, domaines, contrat, abonnement, modules, équipe, support et historique.
- Commercial : demandes entrantes, attribution, prochaine action, démo, devis, conversion ; rappels sans doublons.
- Accompagnement : checklist de mise en route et progression, blocages, responsables et échéances.
- Support : tickets, priorité, attribution, engagements à définir, historique et diagnostics.
- Exploitation : domaines/certificats, erreurs, envois en échec, paiements à vérifier, incidents et reprises.
- Équipe : invitations, rôles, périmètres, accès temporaires, revues et départs.
- Gouvernance : actions sensibles, approbations, audits et paramètres de l’entreprise.

Afficher à chacun les vues et actions de son métier. Une vue masquée n’est pas une protection : l’API applique le même refus. Une série historique absente ne devient pas une courbe inventée. Afficher les données manquantes et distinguer estimation, montant contractuel et revenu encaissé.

## 5. Clubs et adhérents : un socle qui tient plusieurs saisons

Le club actuel constitue la frontière de données. Préparer les associations multisports et plusieurs lieux/sections sans changer toute la base maintenant : sport, activité, groupe, créneau, saison et site doivent rester des notions explicites.

Séparer progressivement l’identité durable d’une personne de son inscription ou adhésion pour une saison. Une personne peut être adhérente, parent et encadrante selon le contexte. Les relations familiales et les autorisations sur un dossier sont explicites ; nom ou e-mail identique ne signifie pas fusion ni accès automatique.

Les dirigeants, secrétaires, trésoriers, entraîneurs et bénévoles du club ont leurs propres droits. Un entraîneur voit les groupes affectés et les informations nécessaires à sa séance, sans accès administratif global. Un parent voit uniquement les dossiers auxquels il est autorisé. Les dossiers médicaux et données de mineurs sont particulièrement restreints.

Prévoir renouvellement, changement de groupe, liste d’attente, capacité, tarifs de saison, aides, documents et suivi des paiements. Mettre en place les parcours complets par lots, avec états vides, erreurs, annulation ou correction adaptées. Ne pas ajouter simultanément toutes les options au détriment de l’usage quotidien.

## 6. Trois vitrines complètes et un éditeur de publication

Trois modèles réellement distincts, compatibles avec tous les sports. Une direction reprend la force graphique historique des diagonales ; les deux autres explorent d’autres compositions. Conserver contenu, thème, identité, navigation et données métier séparés. Prévoir médias réels du club et solutions de repli soignées.

Un éditeur utile couvre pages et blocs autorisés, textes, médias, navigation, SEO, ordre et visibilité. Conserver brouillon, aperçu contextualisé et publication explicite, atomique et versionnée. Détecter les modifications concurrentes. Prévoir retour à une version publiée précédente et traçabilité, sans effacer l’historique. Une prévisualisation privée ne doit pas être publiquement découvrable.

L’activation d’un module ne donne pas une permission. Distinguer capacité technique, droit contractuel, activation choisie, configuration et autorisation de l’utilisateur. Une désactivation conserve les données et explique les conséquences. Un changement d’offre ne doit pas bloquer les fonctions nécessaires pour consulter ses factures ou récupérer ses données.

Accessibilité, performance, référencement, réduction des mouvements et comportement mobile font partie du produit. Les animations accompagnent les contenus ; elles ne masquent pas une structure éditoriale pauvre.

## 7. Tarification et croissance commerciale

Le propriétaire n’a fixé aucun montant. Utiliser une grille administrable par tranches d’effectif, avec prix non publié tant qu’il n’est pas renseigné, devis et exceptions contractuelles explicites. La grille actuelle ne prouve pas le prix accepté par un client : conserver version du tarif et conditions du contrat.

Définir précisément ce qui compte comme adhérent, la période de mesure et les règles de franchissement d’une tranche. Rendre un changement compréhensible avant prise d’effet ; éviter changement rétroactif ou facturation cachée. Prévoir contestation/correction, échéancier, résiliation et export de sortie.

Les commissions des paiements des adhérents et l’abonnement SaaS du club sont deux flux distincts. Les tarifs des prestataires et règles applicables doivent être vérifiés auprès de sources actuelles avant implémentation commerciale ; les exemples historiques ne sont pas une autorité.

## 8. Exploiter avant de subir

Préparer une file de travail avec responsable, priorité, échéance, historique, déduplication et fermeture explicite pour les événements actionnables : onboarding bloqué, domaine/certificat en échec, envoi rejeté, impayé confirmé, sauvegarde ou tâche en échec.

Éviter une alerte à chaque événement technique : agréger, distinguer symptôme et incident, ne rouvrir qu’en cas de rechute. Paramètres et seuils sont configurables, pas des promesses de service inventées.

Les relances externes suivent des règles explicites, une prévisualisation des destinataires, les préférences applicables, une limite de fréquence, des reprises idempotentes et un arrêt lorsque la situation est résolue. La demande d’anticipation n’autorise aucun message à un client dans cette session.

Prévoir logs structurés sans données sensibles, corrélation par requête/club, tâches bornées avec reprise, surveillance des erreurs et coûts, sauvegarde et restauration réellement testée. Documenter objectifs de restauration et perte de données acceptable avant de promettre un engagement contractuel. Isoler développement, recette et production, avec deux organisations fictives pour les tests d’accès croisé.

Exporter les données d’un club de manière contrôlée ; limiter les exports massifs, les tracer et appliquer une expiration aux fichiers. Prévoir portabilité et conservation des données, avec règles explicites pour les dossiers sensibles et les salariés partis.

## 9. Priorités de construction

| Lot | Livrable vérifiable | Point d’arrêt avant ouverture réelle |
| --- | --- | --- |
| A — Référence et accès | État réel documenté, permissions plateforme séparées des clubs, matrice testable et migration additive | Aucun salarié branché au rôle propriétaire par défaut |
| B — Équipe Licyo | Invitations, MFA, rôles/périmètres, révocation, audit, premières vues par métier | Tests d’escalade, de révocation et de lecture interclubs réussis |
| C — Pilotage | Interface historique portée, portefeuille/attribution, données réelles et états honnêtes | Aucun bouton simulé présenté comme opérationnel |
| D — Sites | Trois modèles et moteur structuré avec brouillon, aperçu, publication, révisions et reprise des réglages | Aucune publication croisée ou perte de composition |
| E — Parcours client | Onboarding, grille versionnée, devis/abonnement, espace club et famille cohérents | Recette des services configurés et paiements en environnement de test |
| F — Exploitation | Support, alertes actionnables, reprises, suivi de charge et restauration | Procédures éprouvées avant croissance des engagements |

Ces lots fixent un ordre de dépendance, pas six refontes indépendantes. Porter le design en parallèle de l’accès est possible tant qu’aucun écran ne prétend donner une capacité non sécurisée. Démarrer par une petite équipe avec rôles prédéfinis ; un éditeur de permissions entièrement libre et le SSO entreprise peuvent attendre un besoin réel.

## 10. Critères de preuve

Pour chaque lot, annoncer ce qui est proposé, développé, testé localement, vérifié avec les services réels ou encore absent. Aucune fonctionnalité de ce document ne devient « faite » parce que son nom figure dans un menu.

Scénarios essentiels :
- Commercial : ses prospects visibles ; dossier adhérent, changement de rôle et export global refusés.
- Support : club non attribué refusé ; accès accordé expiré ou révoqué immédiatement inutilisable.
- Facturation : contrat autorisé consultable ; pièce médicale refusée.
- Administrateur délégué : impossible de s’élever propriétaire ou de retirer le dernier propriétaire.
- Salarié parti : sessions et tâches sensibles refusées même si un ancien écran reste ouvert.
- Deux clubs : aucune fuite par URL, recherche, cache, média, export ou tâche.
- Publication : brouillon non public, conflit signalé, version précédente restaurable.
- Alertes/relances : absence de doublons et arrêt après résolution.
- Interface : regarder réellement 360/768/1440 px, contrôler gouttières, cartes, clavier, focus, champs 16 px, cibles 44 px et mouvements réduits.
- Exploitation : reprise d’une tâche échouée et restauration d’une sauvegarde testées avec preuve.

Un seul récapitulatif utile par lot : résultat, validations, limites et prochain risque concret à traiter. Ne pas multiplier les micro-audits déjà clos sans nouvelle raison.
