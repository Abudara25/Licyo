# Licyo : architecture cible et feuille de route

Document de référence du produit. Il reprend l'architecture définie avec le porteur du projet (octobre 2026) et indique, pour chaque phase, l'état réel du code. Mettre à jour la colonne « État » à chaque étape terminée.

## Vision

Un seul produit SaaS pour les clubs sportifs, tous sports confondus. Pas un dépôt ni une version de code par club : la configuration d'un club vit en base, jamais dans une branche.

Six espaces, avec des permissions distinctes :

1. **Site vitrine public** de chaque club (présentation, activités, équipes, actualités, préinscription).
2. **Cœur commun** : organisations, personnes, familles, inscriptions, saisons, communications.
3. **Espace club** : administration, équipes, membres, documents, suivi des inscriptions.
4. **Espace familles** : dossiers, responsables légaux, pièces demandées, suivi.
5. **Console plateforme** : création des clubs, abonnements, domaines, assistance, supervision.
6. **Services partagés** : e-mails, hébergement, sécurité, sauvegardes, tâches automatiques.

Un parent n'accède jamais à l'administration, un club ne voit jamais les données d'un autre club, l'administrateur de la plateforme n'utilise pas le compte d'un club comme le sien.

## Décisions à ne pas perdre

- Un seul produit, une seule base de code.
- Site vitrine personnalisable et CRM reliés au même socle.
- Quatre thèmes de départ au maximum, dont le thème à lignes diagonales.
- Logo et couleurs personnalisables par club.
- Sports gérés de façon générique : aucune règle du football imposée aux autres sports (licence, grade, numéro de maillot ou certificat ne sont jamais des colonnes obligatoires pour tous).
- Données, documents, actualités et communications isolés par organisation, contrôlés côté serveur (requêtes, routes, fichiers, tâches, e-mails).
- Saisons et historique jamais écrasés par un renouvellement.
- Comptes de connexion, personnes du CRM et appartenances aux clubs : trois objets distincts. Un utilisateur peut appartenir à plusieurs clubs.
- Comptes nominatifs, rôles explicites ; jamais de mot de passe partagé par le bureau.
- Une personne, un dossier d'inscription, une adhésion annuelle et un paiement sont quatre objets différents.
- Les fonds des cotisations vont au club, jamais sur le compte de la plateforme.
- La messagerie du club fonctionne avec son propre domaine ; un incident d'envoi chez un club ne pénalise pas les autres.
- Le site public n'expose jamais un brouillon.
- Identifiants publics non énumérables.
- Le cycle commercial (abonnement) est distinct de l'état technique (site publié, organisation archivée).
- **Saint-Gratien FC reste sur son propre dépôt** : le club pilote de Licyo est le Club Démo fictif, puis un deuxième club réel d'un autre sport.

## Profils et accès

| Profil | Accès |
|---|---|
| Visiteur | Site public et formulaires |
| Parent / responsable légal | Ses dossiers familiaux, démarches, paiements |
| Membre majeur | Ses informations et activités |
| Entraîneur | Ses équipes, séances, informations nécessaires |
| Bénévole / responsable d'activité | Fonctions attribuées |
| Secrétaire | Membres, dossiers, documents |
| Trésorier | Cotisations, transactions, exports financiers |
| Administrateur du club | Gestion du club et de ses utilisateurs |
| Administrateur plateforme | Exploitation du SaaS, accès contrôlé aux données |

## Parcours d'une inscription

Découverte → préinscription → création du dossier (bon club, sans doublon) → instruction (pièces, validation, attente) → inscription définitive (saison, activité, équipe) → paiement (rapproché du dossier) → communication → suivi annuel (historique conservé pour le renouvellement).

## Modèle de données (grands domaines)

Organisation · Site (domaines, pages, thèmes, brouillons, publications) · Accès (utilisateurs, appartenances, rôles) · Activités (sports, saisons, groupes, séances) · CRM (personnes, familles, inscriptions, documents) · Finance (cotisations, reçus, paiements, remboursements) · Communication (modèles, envois, désinscriptions).

## Feuille de route et état réel

Légende : ✅ fait et testé · 🟡 partiel · ⬜ à faire.

### Phase 1 : sécuriser le moteur multisite

| Élément | État | Où |
|---|---|---|
| Organisation résolue par le domaine (public) ou la session (admin), jamais par le navigateur | ✅ | `functions/_shared/organization.js` |
| Chaque site ne lit que sa configuration publiée | ✅ | `functions/_shared/site-config.js`, `public-site.js` |
| Aucun repli servant le contenu d'un club à un autre (réponses neutres) | ✅ | `public-site.js`, tests `public-routing`, `tenant-isolation` |
| Routage des pages cohérent avec la configuration | ✅ | `functions/[[path]].js` |
| Migrations, révisions, contrôles d'intégrité | ✅ | `schema.js`, `repairSchemaInvariants` |
| Plus aucun cas spécial pour un club « historique » | 🟡 clés globales, miroir KV et secrets de plateforme retirés ; restent les valeurs de référence du club de démo (catégories, lieu, pré-inscription) et son secours statique | `settings-kv.js`, `integrations.js` |
| Tâches quotidiennes pour tous les clubs | ✅ un appel traite chaque club actif | `functions/api/cron.js` |

### Phase 2 : terminer le moteur de site vitrine

| Élément | État |
|---|---|
| Brouillon / publication en base | ✅ |
| Site de départ d'un nouveau club, généré depuis un profil simple | ✅ (`sites/starter.js`, publié à la création dans la console) |
| Écran d'édition et aperçu | ✅ (`/admin/site` : profil complet pour un site de départ, champs sûrs pour une configuration écrite à la main) |
| Retour arrière (historique des versions) | ⬜ |
| Actualités par organisation en base | 🟡 (services 4E.1 prêts, non branchés) |
| Thèmes (4 au maximum) | 🟡 (1 : diagonales) |
| Couleurs par club | ✅ deux couleurs choisies dans « Site web », nuances calculées (`renderer/palette.js`), reprises dans les e-mails |
| Couleurs déduites du logo, logo du club téléversé | ⬜ (logo générique neutre pour l'instant) |
| Domaines personnalisés automatisés | ⬜ |

### Phase 3 : identité et permissions

| Élément | État |
|---|---|
| Comptes nominatifs, invitations, réinitialisation | ✅ (`accounts.js`, `/admin/utilisateurs`, `/admin/invitation`, `/admin/mot-de-passe-oublie`) |
| Appartenances à plusieurs clubs | ✅ (un compte, plusieurs appartenances) |
| Rôles et permissions | ✅ (6 rôles, contrôle par route dans `admin-access.js`) |
| Journal d'audit, sessions sécurisées | ✅ (`/admin/journal`, sessions liées au compte) |
| Entraîneur limité à ses équipes | ✅ groupes attribués dans Utilisateurs (migration 15), listes, fiches, CSV et présences filtrés |
| Premier responsable d'un club | ✅ invité par la console plateforme (ou `/admin/premier-acces` + `SETUP_SECRET`) |

### Phase 4 : CRM de base

| Élément | État |
|---|---|
| Personnes, familles, relations, adhésions par saison, historique | ✅ (`crm.js`, `crm-schema.js`) |
| Préinscription, places, transformation | 🟡 (liste d'intérêt, ouverture automatique) |
| Dossiers, documents, validation, relances | ✅ |
| Vocabulaire par sport (fédération, plateforme des licences, équipement) | ✅ (`sport-profile.js`, 14 sports, Paramètres) |
| Champs personnalisés par club (grade, ceinture, classement…) | ✅ Paramètres, suggestions par sport, formulaire, fiche, PDF, CSV (migration 16) |
| Équipement facultatif selon le sport | ✅ ; licence encore suivie pour tous les sports (champ vide si inutile) |
| Affectation aux équipes et historique | 🟡 (`group_memberships`) |

### Phase 5 : services opérationnels

| Élément | État |
|---|---|
| E-mails transactionnels (SMTP, Brevo en secours), journal | ✅ (identifiants de plateforme) |
| Identité du club dans les e-mails (nom, lieu, créneaux, couleurs, réponse au club) | ✅ (`email-identity.js`, `MAIL_FROM`) |
| Domaine d'envoi propre à chaque club | ⬜ (adresse de la plateforme, réponse au club) |
| Paiement HelloAsso, rapprochement | ✅ identifiants propres à chaque club, chiffrés (`integrations.js`, `SECRETS_KEY`) |
| Présences et planning | ✅ séances du jour d'après le planning, appel, bilan par enfant (migration 17, `/admin/presences`) |
| Convocations (matchs, compétitions) | ⬜ |

### Phase 6 : console SaaS

| Élément | État |
|---|---|
| Maquette navigable | ✅ (`prototypes/platform-crm/`) |
| Console réelle : création de club, invitation du responsable, domaines, suspension | ✅ (`/admin/plateforme`) |
| Abonnements : formules, essai, paiements reçus, retards | ✅ suivi manuel dans la console (migration 18, `billing.js`) |
| Prélèvement automatique (prestataire de paiement) et factures PDF | ⬜ |
| Modules activables par club | ⬜ |
| Rattachement automatique du domaine au projet Pages | ⬜ |

### Phase 7 : deuxième club réel

Un club d'un autre sport (tennis, padel, judo...), parcours complet sans aucune référence au Club Démo. Pas de lancement commercial avant validation de l'isolation, des accès, des sauvegardes, du RGPD et du paiement.

## Journal des avancées

Les étapes réalisées sont ajoutées ici, la plus récente en haut.

### 2026-10-20 (suite) : groupes, site, champs, présences, abonnements

- **Entraîneur limité à ses groupes** : cases à cocher dans Utilisateurs ; listes, CSV, tableau de bord, adhérents, pré-inscriptions et présences filtrés ; fiche d'un autre groupe introuvable ; pages sans filtre possible (journal des e-mails, réinscription, contacts) réservées aux rôles qui voient tout.
- **Site web** : un club créé dans la console a aussitôt un site publié (accueil, le club, actualités, inscription, contact, mentions, confidentialité) ; « Site web » modifie le brouillon (textes, coordonnées, couleurs), montre l'aperçu avec les vraies données, puis publie.
- **Champs propres au club** : définis dans Paramètres (suggestions selon le sport), demandés à l'inscription et contrôlés par le serveur, visibles et modifiables sur la fiche, exportés.
- **E-mails** : nom, lieu, créneaux, couleurs, réseaux et adresse du club qui envoie ; pages famille et admin avec l'adresse du club.
- **Présences** : séances du jour d'après le planning, appel en quatre statuts, bilan sur la fiche.
- **Abonnements** : formules, essai de 30 jours, paiements reçus enregistrés dans la console, passage « En retard » par le cron, affichage côté club.

### 2026-10-20 : tenue facultative selon le sport

- Taille d'équipement exigée seulement si le sport du club fournit une tenue (profil sportif) ; champ masqué dans le formulaire (`sizes: []`) et dans la réinscription. Tests : `tests/sport-profile.test.mjs`.

### 2026-10-20 : console plateforme (phase 6, première version)

- `/admin/plateforme`, réservée aux e-mails listés dans `PLATFORM_ADMIN_EMAILS` (permission `platform.manage`, distincte des rôles de club).
- Créer un club : organisation, domaine, sport, invitation du responsable sur le domaine du club (7 jours). Doublons de domaine ou d'identifiant refusés.
- Ajouter un domaine, suspendre ou réactiver (son site et son admin ne répondent plus, aucune donnée supprimée). Impossible de suspendre le club depuis lequel on est connecté.
- Aucune donnée d'adhérent n'est lue par la console. Tests : `tests/platform.test.mjs`.

### 2026-10-20 : profil sportif du club

- Paramètres › « Sport et fédération » : 14 sports proposés (football, basket, hand, rugby, volley, judo, karaté, boxe, muay thaï, natation, tennis, gymnastique, athlétisme, autre), avec sigle et nom de la fédération, plateforme des licences, sous-titre, équipement, tous modifiables.
- Les gabarits gardent le vocabulaire du football comme forme de référence ; il est traduit au dernier moment pour l'admin (middleware) et pour chaque e-mail (point d'envoi unique). Le club de démo reste en football.
- Tests : `tests/sport-profile.test.mjs`.

### 2026-10-20 : fin des cas spéciaux du club historique (phase 1)

- Plus aucune clé KV globale lue ou écrite (ni copie miroir) : chaque réglage est sous `org:<club>:...`.
- Identifiants HelloAsso propres à chaque club, saisis dans Paramètres, chiffrés en AES-GCM (clé dérivée de `SECRETS_KEY` et de l'identifiant du club) ; les variables globales `HELLOASSO_*` ne valent plus rien.
- Le cron quotidien traite tous les clubs actifs (chacun avec son adresse, son état et ses alertes).
- Tests : `tests/integrations.test.mjs`, tests KV, cron et isolation mis à jour.

### 2026-10-20 : comptes nominatifs et rôles (phase 3)

- Fin du mot de passe partagé et du secret `ADMIN_PASSWORD` : connexion par e-mail + mot de passe personnel.
- Migration 14 (additive) : `users` (comptes, globaux à la plateforme), `organization_memberships` (accès d'un compte à un club, avec un rôle), `user_tokens` (invitation 7 jours, réinitialisation 1 heure, usage unique, empreinte seulement), `admin_audit_log`, `admin_sessions.user_id`.
- Rôles : Responsable du club, Administrateur, Secrétaire, Trésorier, Entraîneur, Bénévole. Permissions contrôlées pour chaque route par le middleware admin ; liens interdits retirés de la navigation.
- Pages : Utilisateurs (inviter, changer un rôle, retirer un accès, renvoyer), Journal des actions, Mon compte (nom, mot de passe), Invitation, Mot de passe oublié, Nouveau mot de passe, Premier accès.
- Garde-fous : un club garde toujours un responsable ; seul un responsable touche aux responsables ; retirer un accès ferme ses sessions ; changer son mot de passe ferme ses autres sessions ; une secrétaire ne peut pas modifier un statut de paiement.
- Tests : `tests/accounts.test.mjs` (13 scénarios), tests d'authentification réécrits.
