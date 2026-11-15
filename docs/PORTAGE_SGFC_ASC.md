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

## Lot 1 — socle de fiabilité (réalisé le 2026-11-15, non déployé)

- **Journal des e-mails** (`email_log`, migration `0005`) : chaque e-mail envoyé au nom d'un club est tracé (type,
  destinataire, objet, fournisseur, statut, erreur courte, jamais le contenu). Page `/club-admin/emails` pour qui a
  `members.read` ou `communication.manage`, avec recherche par adresse et filtre par statut. Purge après 13 mois.
- **Formulaires publics** (inscription, essai, partenariat, cours particuliers, lien de connexion) :
  - les anciennes limites en mémoire ne valaient que pour une instance du Worker ; la limitation de débit se fait
    désormais en base D1, partagée entre toutes les instances ;
  - Cloudflare Turnstile est vérifié côté serveur (`src/lib/security/`). Si le service est injoignable, l'envoi est
    refusé.
  - Sans clés configurées, Turnstile est désactivé ; seule la limitation de débit protège alors les formulaires.
  - La clé publique est transmise par `<html data-turnstile-site-key>`, réglable sans recompiler.
- **Tâches planifiées** :
  - Cron Trigger quotidien (3 h 17 UTC) défini dans `wrangler.jsonc` ;
  - `worker.ts` enveloppe le Worker OpenNext et appelle `POST /api/cron`, protégé par `CRON_SECRET` (comparaison
    en temps constant, 32 caractères minimum) ;
  - chaque tâche est indépendante et verrouillée par créneau (`scheduled_runs`) ;
  - tâches actuelles : purge (e-mails de plus de 13 mois, exécutions de plus de 90 jours, limites de débit, liens
    de connexion et sessions expirés) et repérage des exécutions interrompues.
- **Secrets** : lus par `workerVar()` (liaison Cloudflare, puis `process.env`). En `next dev`, OpenNext ne recopie
  pas `.dev.vars` dans `process.env`.
- **Vérifié** :
  - 46 tests passent ; `tsc`, `next build` et `opennextjs-cloudflare build` sans erreur ;
  - `wrangler deploy --dry-run` : le Worker assemblé contient le gestionnaire planifié ;
  - en local : `/api/cron` refusé sans secret, exécuté avec, puis « déjà lancée » au second appel ;
  - formulaire d'essai soumis avec les clés de test Turnstile, e-mail visible dans le journal, à 360 et 768 px.
- **Mise en service** (à faire sur demande) :
  - `npx wrangler secret put CRON_SECRET` et `TURNSTILE_SECRET_KEY` ;
  - `TURNSTILE_SITE_KEY` dans les `vars` de `wrangler.jsonc` ;
  - créer le widget Turnstile pour le domaine ;
  - sauvegarde de la base, puis `npm run db:migrate:remote` (migrations 0002 à 0005).

## Lot 2 — pré-inscriptions et liste d'attente (réalisé le 2026-11-15, non déployé)

- **Mode d'inscription par catégorie** (migration `0006`, `categories.registration_mode`) :
  - ouvertes : inscription directe, puis liste d'attente dès que le groupe est complet ;
  - pré-inscriptions : liste d'intérêt avant l'ouverture ;
  - fermées.
- **Places restantes** = capacité - dossiers actifs - invitations en cours, car une invitation réserve la place.
  Le serveur l'applique dans le tunnel d'inscription ; les catégories indisponibles sont grisées dans la liste.
- **Page publique `/pre-inscription`** :
  - formulaire court, protégé par Turnstile et la limitation de débit en base ;
  - âge contrôlé, doublons refusés (une seule demande active par personne, catégorie et saison) ;
  - e-mail de confirmation indiquant le rang.
- **Back-office `/club-admin/preinscriptions`** :
  - lecture : `members.read` ; actions : `members.write` ; mode de la catégorie : `organization.manage` ;
  - par catégorie : places, file dans l'ordre d'arrivée, invitation, inscription faite à la main, retrait, remise
    en attente ;
  - confirmation avant de dépasser la capacité.
- **Invitation** :
  - lien personnel valable 7 jours, stocké seulement sous forme d'empreinte ;
  - il ouvre l'inscription préremplie, avec la catégorie « place réservée » ;
  - la demande est close et rattachée à l'adhérent après l'inscription ;
  - si l'e-mail ne peut pas partir, la demande reste en attente et ne bloque pas de place.
- **Tâche planifiée `liste_attente`** : les liens dépassés expirent et la place est rendue. Pour les catégories en
  « invitation automatique », chaque place libérée est proposée la nuit suivante à la personne suivante.
- **Vérifié** :
  - 53 tests passent ; `tsc` et `next build` sans erreur ;
  - parcours complet en local (demande, invitation par le bureau, lien reçu, inscription préremplie) à 360 et
    768 px.
- **Reste à faire** :
  - priorité de réinscription : un adhérent de la saison passée est aujourd'hui soumis aux mêmes places que les
    nouveaux ;
  - relance avant l'expiration du lien ;
  - export de la liste.

## Lot 3 — relances automatiques et file « À traiter » (réalisé le 2026-11-15, non déployé)

- **Politique par club** (`clubs.reminder_policy`, migration `0007`) :
  - désactivée par défaut ;
  - jusqu'à 3 relances (3, 7 et 14 jours par défaut) ;
  - types activables séparément : pièces manquantes, correction demandée, reste à payer.
  - Réglée sur `/club-admin/a-traiter`, avec le droit `settings.manage`.
- **Tâche planifiée `relances`** (`src/lib/reminders.ts`) :
  - détecte les pièces manquantes (photo, certificat quand il est exigé), les corrections non faites et le reste à
    payer (hors chèques déjà remis) ;
  - pour une correction, le délai est compté depuis l'e-mail de demande du bureau ;
  - une même relance n'est jamais envoyée deux fois : elle est réservée dans `reminder_log` avant l'envoi et
    libérée si l'envoi échoue ;
  - au plus une relance par adresse et par nuit, 2 jours au moins entre deux relances, 100 au plus par club ;
  - la dernière relance annonce que le bureau prendra contact.
- **Lien de complément** : la page `/correction/<jeton>` accepte aussi un dossier en attente tant qu'il lui manque
  des pièces. Le lien ne sert qu'une fois.
- **File « À traiter »** : dossiers complets à valider, dossiers incomplets et corrections (avec l'historique des
  relances), paiements en attente (droit `finance.read`), liste d'attente, et réglages des relances.
- **Bug corrigé** (présent depuis la bascule sur Cloudflare) : la règle des chemins R2 refusait
  `members/<saison>`, si bien que **tout dépôt de pièce d'adhérent échouait** (inscription, correction, espace
  adhérent). Règle déplacée dans `src/lib/storage-path.ts` et testée.
- **Vérifié** :
  - 64 tests passent ; `tsc` et `next build` sans erreur ;
  - en local : activation depuis l'écran, cron (« envoyees=1 »), lien de complément, photo déposée, dossier passé
    en « à valider », ancien lien invalidé ; écrans regardés à 360 et 768 px.

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
