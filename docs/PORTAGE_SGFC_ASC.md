# Portage des CRM Saint-Gratien FC et ASC Muay Thaï dans Licyo

Décision du propriétaire du 2026-11-15 : Licyo garde son application (Next.js sur Cloudflare Workers via OpenNext,
D1 UE, R2). On y **porte les capacités** des CRM de Saint-Gratien FC et d'ASC Muay Thaï. On ne reprend ni leur
infrastructure ni aucune donnée : pas de base, pas d'export, pas de fichier, pas de contenu éditorial.

Code de référence neutralisé (club fictif, 708 tests) : `C:\Users\Gherari\dev\licyo-crm`, branche locale
`feat/crm-cloudflare`, non poussée. On s'en sert pour relire la logique et les cas limites. On ne le fusionne pas.

## Écarts constatés (2026-11-15, Licyo `main` à 2da2449, 23 tests)

| Capacité | SGFC | ASC | Licyo |
| --- | --- | --- | --- |
| Adulte qui s'inscrit lui-même, règle mineur/majeur | non | oui | oui (`is_adult_self_registration`) |
| Échéancier, chèques, Pass'Sport | oui | partiel | oui |
| Pré-inscription et liste d'attente par groupe, avec ouverture automatique | oui | non | **absent** |
| Personne permanente sur plusieurs saisons (contacts, relations, adhésions par période), doublons signalés sans fusion | oui | non | **absent** (inscription saisonnière seulement) |
| Relances automatiques planifiées (Cron Trigger) et journal des e-mails | oui | non | **absent** |
| File « À traiter » (dossiers, pièces, paiements à vérifier) | oui | non | partiel |
| Liens famille à durée limitée, fratries regroupées | oui | non | partiel (`family_access`) |
| Import des paiements HelloAsso et rapprochement avec les adhérents | oui | webhook | **absent** |
| Newsletter aux familles (désinscription, envoi programmé) | oui | non | **absent** |
| Invitation des éducateurs par lien de groupe | oui | non | partiel (invitations) |
| Protection anti-robot des formulaires publics (Turnstile) | oui | non | **absent** |
| Conservation et suppression RGPD (durées, purge, suppression vérifiée) | oui | non | partiel |
| Pièces attendues configurables (certificat, autorisation parentale, identité) | partiel | oui | partiel |
| Palmarès, galerie, vidéos, cours particuliers | non | oui | oui |
| Tests | 708 | aucun | 23 |

## Réalisé le 2026-11-15 (non commité, non déployé)

Périmètre décidé par le propriétaire : **sports collectifs et sports de combat / arts martiaux** uniquement.
Les clubs sont hétérogènes, donc les formulaires sont modulables. Les gros clubs répartissent les droits entre
plusieurs rôles.

1. **Sports** (`src/config/sports-presets.ts`) :
   - presets retirés : tennis, natation, gymnastique, athlétisme, badminton, danse ;
   - champ `family` ajouté (collectif ou combat) ;
   - boxe, muay thaï, karaté et taekwondo deviennent des presets complets (mêmes identifiants qu'avant, dont
     `muaythai`).
2. **Rôles et permissions** :
   - `src/lib/permissions.ts` est la source unique : 9 rôles de club (président, vice-président, secrétaire et
     adjoint, trésorier et adjoint, éducateur, dirigeant d'équipe, bénévole) et 12 permissions ;
   - l'encadrement (éducateur, dirigeant d'équipe, bénévole) est limité à ses catégories rattachées ;
   - les règles SQL (`policies.ts`), les actions serveur, les pages et la navigation demandent désormais une
     permission, plus aucune liste de rôles écrite en dur ;
   - migration `0002_club_roles.sql` : reconstruction de `staff_members` pour élargir le CHECK, toutes les lignes
     sont recopiées. Vérifiée sur la base locale : rôles conservés.
   - Changement de comportement : le trésorier ne valide plus les dossiers ; le secrétaire lit les finances mais
     ne saisit plus de paiement.
   - Bug corrigé dans `src/lib/db/query.ts` : la vérification d'une insertion décalait les paramètres quand une
     règle citait deux fois la même colonne. La création d'un événement par un éducateur échouait à cause de ça.
3. **Formulaire d'inscription modulable** :
   - `src/config/registration-fields.ts` contient le catalogue : identité/licence, santé, second responsable,
     pratique sportive (poste par sport collectif, grade et poids pour le combat), autorisations dont
     l'autorisation parentale, vie du club ;
   - chaque champ se règle en masqué, facultatif ou obligatoire, pour tous, les mineurs ou les majeurs ;
   - le club peut ajouter jusqu'à 10 questions libres ;
   - écran du back-office : `/club-admin/formulaire` (permission `settings.manage`) ;
   - le serveur valide toujours selon les réglages du club (`validateExtraAnswers`). Les réponses sont stockées
     dans `members.extra_fields` et affichées dans la fiche du dossier ;
   - migration `0003_registration_form.sql` : ajout de colonnes et recréation de la vue `public_clubs`.

4. **Droits personnalisés par personne** (demande du propriétaire, même jour) :
   - la fonction (rôle) ne fait que pré-cocher des droits ; l'administrateur du club (`club.admin`) coche et décoche
     ensuite librement les 14 droits de chaque personne, dont l'appel et les événements « de ses catégories » ;
   - les droits sont stockés dans `staff_members.permissions` (migration `0004_staff_permissions.sql`). La valeur
     NULL signifie « droits par défaut du rôle », ce qui laisse les comptes existants inchangés. Les règles SQL et
     les contrôles serveur lisent ces droits ;
   - l'écran (`StaffAccessPanel`) montre la sensibilité de chaque droit (critique, données personnelles, sportif,
     vie du club), un rappel RGPD sur le moindre privilège, le nombre de personnes ayant accès aux dossiers ou aux
     paiements (alerte au-delà de 4) et des avertissements avant d'enregistrer ;
   - garde-fous côté serveur : au moins une personne garde `club.admin` ; personne ne peut se retirer ce droit
     soi-même ; pas d'écrasement silencieux d'une personne déjà invitée ; catégories du club uniquement ; chaque
     invitation, modification ou retrait est inscrit dans `audit_events`.

Vérifications :

- 39 tests passent (`tests/club-roles.test.ts`, `tests/registration-form.test.ts`). Les garde-fous des actions
  (dernier administrateur, auto-rétrogradation) ne sont pas couverts par un test automatique ;
- `tsc` et `next build` sans erreur ;
- éditeur, tunnel et fenêtre d'invitation regardés à 360 et 768 px sur la base locale fictive, sans débordement,
  gouttière ni champ sous 16 px.

Reste à faire :

- afficher le journal des changements de droits aux administrateurs du club (il n'est consultable que par l'équipe Licyo) ;
- des pièces jointes configurables par club (photo, certificat et identité restent fixes) ;
- l'export CSV des réponses ;
- l'accès de l'encadrement aux allergies de ses adhérents (aujourd'hui, bureau seulement).

## Lots proposés (ordre recommandé)

1. **Socle de fiabilité** : journal des e-mails par club, Turnstile sur les formulaires publics, Cron Trigger du
   Worker (tâches indépendantes, verrou, secret). C'est la condition des lots 2 et 3.
2. **Pré-inscriptions et liste d'attente** par catégorie : ouverture et fermeture, transfert vers l'inscription,
   échéances.
3. **Relances automatiques** des dossiers incomplets, sur une politique configurable par club, avec la file
   « À traiter ».
4. **Personne permanente** : contacts, relations, adhésions par saison construites à côté de
   `family_registrations` (migration additive, rapprochement prudent, doublons signalés sans fusion).
   Réinscription préremplie depuis cette base.
5. **Pièces et autorisations configurables** par club et par public (mineur/majeur), plus l'autorisation parentale
   (apport d'ASC).
6. **Paiements externes** : import HelloAsso (CSV, puis API avec secrets chiffrés par club) et rapprochement.
7. **Newsletter** aux familles, avec désinscription en un clic (RFC 8058) et envoi programmé.
8. **Conservation RGPD** : durées par type de donnée, purge planifiée, suppression vérifiée des fichiers R2.

Pour chaque lot, on porte les tests de SGFC correspondants (isolation entre clubs, concurrence, idempotence) en
plus des tests du lot lui-même.
