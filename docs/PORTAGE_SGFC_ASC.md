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

## Lot 4 — fiche adhérent suivie d'une saison à l'autre (réalisé le 2026-11-15, non déployé)

- **Personne permanente** (`people`, migration `0008`) : une fiche par club, à laquelle chaque inscription de
  saison est rattachée (`members.person_id`).
- **Rapprochement conservateur** par un déclencheur SQL à chaque nouvelle inscription : même prénom, nom et date de
  naissance exacte (casse et espaces ignorés). Il vaut pour tous les chemins : tunnel, essai, import, données de
  démo.
- **Réinscription** : le lien rattache explicitement à la personne de la saison précédente, même si l'orthographe a
  changé. Il n'est accepté que s'il vient d'une saison antérieure.
- **Priorité de réinscription** : la personne réinscrite par le lien du club passe outre « complet » et
  « pré-inscription », mais jamais « fermé ».
- **Reprise de l'existant** par la migration : identifiant généré ligne par ligne (le test a révélé qu'une
  sous-requête aurait donné le même identifiant à toutes les fiches). Vérifiée sur la base locale : 6 inscriptions,
  5 fiches, aucune inscription sans fiche.
- **Doublons possibles** (`src/lib/people.ts`) : même prénom et nom avec une date différente, même nom et même date
  (jumeaux ?), même prénom et même date. Ils sont signalés dans la liste et sur la fiche, jamais fusionnés.
- **Écrans** (droit `members.read`) :
  - `/club-admin/adherents` : recherche insensible aux accents ; saison courante, anciens adhérents non
    réinscrits, ou toutes les saisons ;
  - `/club-admin/adherents/<id>` : responsable légal, saisons (catégorie, statut, pièces, réponses au formulaire,
    règlement si `finance.read`, relances), e-mails envoyés à la famille, doublons possibles, notes internes
    (`members.write`).
- **Vérifié** :
  - 69 tests passent ; `tsc` et `next build` sans erreur ;
  - écrans regardés à 360 et 768 px ; notes enregistrées puis relues.
- **Reste à faire** :
  - fusion manuelle de deux fiches par le bureau, avec journal ;
  - rattacher plusieurs responsables à une même personne (aujourd'hui, le payeur de chaque saison).

## Lot 5 — pièces à fournir configurables (réalisé le 2026-11-15, non déployé)

- **Catalogue** (`src/config/registration-documents.ts`) :
  - photo d'identité (obligatoire par défaut) et pièce d'identité (facultative par défaut) ;
  - autorisation parentale signée, justificatif de domicile, justificatif d'aide, licence précédente ;
  - passeport sportif, pour les sports de combat seulement ;
  - jusqu'à 5 pièces libres du club.
- Chaque pièce se règle en masquée, facultative ou obligatoire, pour tous, les mineurs ou les majeurs. Le
  **certificat médical reste piloté par la catégorie**, pour ne jamais affaiblir une exigence fédérale. Réglage dans
  l'éditeur « Formulaire d'inscription », enregistré avec les champs (rien n'est perdu d'une partie à l'autre).
- **Stockage** : photo et identité dans les colonnes historiques ; les autres pièces dans `member_documents`
  (migration `0009`, une pièce par personne et par type, stockage R2 privé). La purge RGPD les efface aussi.
- **Mêmes règles partout** :
  - tunnel : emplacements selon l'âge, pièces obligatoires exigées par le navigateur et par le serveur ;
  - lien de complément ;
  - relances : seules les pièces obligatoires manquantes déclenchent une relance ;
  - « À traiter » et fiche adhérent ;
  - écran de validation : un onglet par pièce, aperçu par lien signé.
- **Point d'attention** : la photo devient obligatoire par défaut à l'inscription. Elle était facultative dans le
  tunnel, mais déjà relancée. Un club peut la repasser en facultative.
- **Défaut de développement corrigé** : en `next dev`, les secrets de `.dev.vars` n'arrivaient pas dans
  `process.env`, si bien que l'aperçu des pièces, le Mode Miroir et le chiffrement des identifiants e-mail
  échouaient en local. `hydrateProcessEnv()` les recopie ; sans effet en production.
- **Vérifié** :
  - 75 tests passent ; `tsc` et `next build` sans erreur ;
  - en local : réglage enregistré, tunnel (5 emplacements, pièce obligatoire exigée), lien de complément (pièces
    manquantes demandées puis déposées), écran de validation (onglets et aperçus) ; 360 et 768 px.

## Lot 6 — import financier générique, dont HelloAsso (réalisé le 2026-11-15, non déployé)

Demande du propriétaire : beaucoup d'associations n'utilisent pas que HelloAsso, donc l'import accepte toute source
d'information financière.

- **Sources pré-réglées** (`src/lib/financial-import.ts`) : HelloAsso, relevé bancaire, SumUp ou terminal de
  paiement, Stripe, « autre » (tableur, logiciel de comptabilité). Toute source passe par un fichier CSV.
  - Les colonnes sont reconnues automatiquement (accents et casse ignorés), puis ajustables.
  - Seules la date et le montant sont obligatoires.
- **Lecture** dans le navigateur (papaparse), en UTF-8 ou en encodage Windows pour les exports bancaires. Le serveur
  relit et normalise tout :
  - montants au format français ou anglais (« 1 234,56 € », « (45,00) ») ;
  - dates (jj/mm/aaaa, ISO, avec heure) ;
  - lignes écartées avec leur motif : statut non payé, débit bancaire, date ou montant illisible.
- **Doublons** : clé unique par club (référence de l'opération, sinon date, montant, payeur, libellé et rang dans le
  fichier). Réimporter un fichier n'ajoute rien, et deux paiements identiques du même jour restent distincts.
- **Rapprochement** (migration `0010`, page `/club-admin/tresorerie/import`, lien depuis la Trésorerie) :
  - suggestions : même e-mail, nom et montant cohérents, ou nom seul ; aucune suggestion en cas d'ambiguïté ;
  - rattacher une opération crée l'encaissement (`payment_installments`, statut encaissé, `source`, référence) et
    recalcule le règlement de la famille (`src/lib/finance-sync.ts`, partagé avec la Trésorerie) ;
  - annulation possible ; « mettre de côté » pour ce qui ne concerne pas les adhésions ;
  - « Correspondances sûres » : même e-mail, une seule famille, montant couvert par le reste à payer hors chèques
    remis. Tout le reste attend le trésorier.
  - Droits : lecture `finance.read`, actions `finance.write`.
- **Vérifié** :
  - 81 tests passent ; `tsc` et `next build` sans erreur ;
  - en local : export de type HelloAsso (UTF-8, `;`, statut « Refusé » écarté), relevé bancaire (Windows, débit
    écarté), réimport (2 déjà connues), rattachement manuel et annulation (règlement de la famille recalculé),
    mise de côté ; 360 et 768 px.
- **Reste à faire** :
  - connexion directe à l'API HelloAsso : faite (lot 11) ;
  - fichiers Excel `.xlsx` (aujourd'hui : exporter en CSV) ;
  - remboursements (montants négatifs) à rattacher.

## Lot 7 — newsletter aux familles (réalisé le 2026-11-15, non déployé)

- **Rédaction** (page `/club-admin/newsletter`, droit `communication.manage`) :
  - objet et texte simple : titres `##`, listes `-`, gras `**…**`, liens https cliquables ;
  - aucun HTML libre, et l'aperçu utilise les mêmes blocs que l'e-mail ;
  - brouillon, envoi de test à soi-même (lien de désinscription inactif), envoi immédiat ou programmé (90 jours
    maximum), annulation tant que l'envoi n'a pas commencé.
- **Public** (`src/lib/newsletter.ts`) :
  - responsables des inscriptions de la saison, toutes catégories ou catégories cochées, saisons passées en option ;
  - dossiers refusés exclus ;
  - une adresse reçoit le message une seule fois ;
  - les désinscrits sont toujours exclus et le compteur s'affiche avant l'envoi.
- **Envoi** (migration `0011`) :
  - le Cron Trigger des 15 minutes (`*/15 * * * *`) ne lance que cette tâche ; le créneau quotidien lance tout ;
  - le message passe de « programmé » à « en cours », une ligne par destinataire (unique par message), puis des
    envois par lots de 200 ;
  - une adresse désinscrite en cours d'envoi est sautée ;
  - un échec est compté et jamais renvoyé en boucle ;
  - le message passe en « envoyé » quand rien n'est en attente.
- **Désinscription** :
  - un lien personnel par e-mail, dont seul le hachage est stocké ;
  - en-têtes `List-Unsubscribe` et `List-Unsubscribe-Post` (RFC 8058, exigés par Gmail et Yahoo pour les envois
    groupés) ;
  - route `/api/newsletter/unsubscribe` en un clic (POST), et page de confirmation `/newsletter/desinscription/…` ;
  - les e-mails utiles à l'inscription (dossier, paiement) continuent d'être envoyés.
- **Vérifié** :
  - 88 tests passent ; `tsc` et `next build` sans erreur ;
  - en local : compteur de destinataires, e-mail de test, deux envois via `/api/cron` (10 e-mails, rejeu sur le même
    créneau ignoré, 401 sans secret), historique « 5 envoyés sur 5 » ;
  - désinscription par la page et en un clic, puis rejouée (200), jeton inconnu (404), lien de test refusé ;
  - 360 et 768 px.
- **Reste à faire** :
  - pièces jointes ou images ;
  - statistiques d'ouverture (volontairement absentes : pas de pixel de suivi) ;
  - désinscription globale tous clubs.

## Lot 8 — conservation des données RGPD (réalisé le 2026-11-15, non déployé)

- **Durées par club** (`src/lib/retention.ts`, migration `0012`, panneau « Conservation des données » dans
  Paramètres, réservé à `club.admin`). Elles sont comptées depuis la fin de saison (31 août) :
  - pièces justificatives : 3 mois par défaut, de 0 à 36 ;
  - fiches des adhérents : 3 ans par défaut, de 1 à 6 ;
  - demandes de pré-inscription closes : 6 mois par défaut, de 1 à 24.
  Les pièces ne sont jamais gardées plus longtemps que les fiches.
- **Désactivée par défaut** : rien n'est effacé tant que la présidence ne l'a pas activée. Le panneau montre avant
  ce que les durées concernent (nombre de pièces, fiches, dossiers, demandes, opérations), une date d'exemple, et
  les cinq derniers passages. « Appliquer maintenant » demande de taper SUPPRIMER.
- **Ordre d'application**, chaque nuit (tâche `conservation`) :
  1. pièces : fichiers R2 supprimés, puis absence vérifiée un par un (`deletePrivateFilesVerified`). Le chemin
     n'est effacé de la base qu'après confirmation ; sinon, nouvel essai au passage suivant. Un fichier repris par
     une saison encore conservée (réinscription) est détaché sans être supprimé ;
  2. adhérents anonymisés : nom, signature, code Pass'Sport, réponses au formulaire, motif de refus ; date de
     naissance réduite à l'année ; lien de correction changé. Seulement s'il ne reste aucune pièce ;
  3. dossiers familiaux anonymisés quand tous leurs adhérents le sont (coordonnées, contact d'urgence, adresse).
     Les montants restent, le numéro de chèque est effacé et l'accès famille est retiré ;
  4. fiches personne sans adhésion restante supprimées (notes comprises), demandes closes supprimées, payeur et
     libellé des opérations importées effacés après la même durée que les fiches.
- **Anonymiser plutôt que supprimer** : les montants, présences et statistiques par saison restent justes.
- **Ancienne purge retirée** : « Purger les anciennes saisons » supprimait aussi les règlements et ne vérifiait
  pas les fichiers.
- **Journaux techniques** (purge quotidienne) : relances et envois de newsletter supprimés au bout de 13 mois,
  journal de conservation au bout de 3 ans. Les désinscriptions newsletter sont gardées, car elles servent à
  respecter l'opposition.
- **Vérifié** :
  - 95 tests passent ; `tsc` et `next build` sans erreur ;
  - en local, avec un dossier fictif 2022-2023 et un vrai fichier dans le R2 local : aperçu « 1 pièce, 1 fiche,
    1 dossier », enregistrement et activation, application manuelle ;
  - fichier absent du R2, fiche « Ancien adhérent » née en 2012, montant de 150 € gardé, chèque effacé, journal
    « Manuel » ;
  - panneau absent pour un entraîneur ; 360 et 768 px (champs alignés).
- **Reste à faire** :
  - registre des traitements à fournir au club ;
  - avant activation en production, vérifier avec chaque club les durées imposées par sa fédération (certificat
    médical valable plusieurs saisons).

## Lot 9 — demandes d'une personne sur ses données (réalisé le 2026-11-15, non déployé)

- **Où** : carte « Demandes sur ses données (RGPD) » sur la fiche adhérent (`/club-admin/adherents/[id]`).
  - Réservé à `club.admin`.
  - Chaque export et chaque effacement est tracé dans `audit_events` (`rgpd.export`, `rgpd.effacement`), sans
    donnée personnelle.
- **Export** (droits d'accès et de portabilité, art. 15 et 20) :
  - route `/club-admin/adherents/[id]/export` et `src/lib/personal-data.ts`, fichier JSON téléchargé ;
  - contenu : toutes les saisons, catégorie, autorisations, réponses au formulaire, pièces déposées (oui/non),
    présences, convocations, dossiers familiaux et règlements, opérations importées, pré-inscriptions, relances,
    e-mails et newsletters reçus, désinscription ;
  - exclus : jetons internes, signature (seulement signalée), chemins des fichiers.
- **Effacement** (art. 17), qui réutilise le moteur du lot 8 (`removeMemberPieces`, `anonymizeMembers`) :
  - toutes les inscriptions de la personne : pièces supprimées puis vérifiées, fiches anonymisées ;
  - dossier familial anonymisé, sauf s'il concerne aussi un frère ou une sœur encore au club ;
  - fiche personne et notes supprimées ; pré-inscriptions supprimées ; relances, e-mails et newsletters effacés
    pour les adresses que plus aucun dossier conservé n'utilise ;
  - montants réglés gardés, sans nom ;
  - si un fichier résiste, la personne reste liée et une nouvelle demande termine le travail.
- **Vérifié** :
  - 99 tests passent ; `tsc` et `next build` sans erreur ;
  - en local, avec une personne fictive et un vrai fichier dans le R2 local : export téléchargé (1 inscription,
    responsable), effacement confirmé par EFFACER puis retour à la liste ;
  - ensuite : fiche en 404, fichier absent du R2, inscription « Ancien », montant de 180 € gardé, 2 traces
    d'audit ; export refusé à l'entraîneur (403) ;
  - 360 et 768 px.

## Lot 10 — autorisation parentale signée en ligne (réalisé le 2026-11-15, non déployé)

Apport du CRM d'ASC Muay Thai.

- **Réglage du club** (page Formulaire d'inscription, `src/config/parental-authorization.ts`) :
  - activée par défaut, désactivable ;
  - texte proposé, modifiable de 40 à 4 000 caractères, avec variables `{responsable}`, `{qualite}`,
    `{enfant}`, `{naissance}`, `{club}`, `{sport}`, `{saison}` ;
  - aperçu avec un exemple.
- **Tunnel d'inscription**, à l'étape signature s'il y a au moins un mineur :
  - nom du responsable légal, qualité (mère, père, tuteur), texte rendu pour chaque enfant, case d'acceptation ;
  - la signature existante vaut pour l'ensemble ;
  - sans ces éléments, l'envoi est refusé, aussi côté serveur.
- **Preuve** (migration `0013`, colonne `members.parental_authorization`) :
  - le serveur rend le texte à partir des réglages du club, jamais à partir de celui du navigateur ;
  - il enregistre une copie figée : texte exact, signataire, qualité, date, empreinte SHA-256 du modèle ;
  - une modification ultérieure du modèle ne change pas ce qui a été signé.
- **Côté bureau** :
  - sur la fiche, ligne « signée le … par … (mère) » ou « non signée en ligne » ;
  - page `/club-admin/adherents/[id]/autorisation/[memberId]` : texte, signataire, date, empreinte et image de
    la signature, à imprimer ou enregistrer en PDF (seule la feuille sort à l'impression).
- **RGPD** : incluse dans l'export de la personne ; effacée à l'anonymisation (conservation et effacement).
- **Vérifié** :
  - 103 tests passent ; `tsc` et `next build` sans erreur ;
  - en local, inscription complète d'un mineur fictif : refus sans autorisation, texte rendu (« mère de Noa
    FICTIF, né(e) le 09/03/2014 », « l'activité « Handball » »), envoi, ligne sur la fiche, page de preuve avec
    signature, aperçu d'impression ;
  - texte personnalisé enregistré puis relu ; texte trop court refusé ;
  - 360 et 768 px (champs à 16 px, sélecteur à 44 px, sans débordement).
- **Reste à faire** :
  - autorisation pour les séances d'essai (formulaire séparé) ;
  - nouvelle signature demandée aux dossiers déjà inscrits sans autorisation en ligne (aujourd'hui : signalés
    « non signée en ligne »).

## Lot 11 — connexion directe à HelloAsso (réalisé le 2026-11-15, non déployé)

- **Connexion** (carte « Connexion HelloAsso » en haut de Trésorerie > Import, droit `finance.write`) :
  - le club colle l'adresse de sa page HelloAsso (ou son identifiant), puis l'identifiant et le secret de sa clé
    API ;
  - Licyo essaie avant d'enregistrer : jeton OAuth2 `client_credentials`, puis lecture d'une page de paiements ;
  - secret chiffré (AES-256-GCM, même clé que les identifiants e-mail), jamais renvoyé au navigateur ; table
    `club_integrations` (migration `0014`) inaccessible aux clients utilisateurs ;
  - connexion et déconnexion tracées dans `audit_events`.
- **Synchronisation** (`src/lib/helloasso.ts`) : chaque nuit (tâche `helloasso`) ou à la demande.
  - Lecture de `GET /v5/organizations/{slug}/payments` : paiements « Authorized », pages de 100, du plus ancien
    au plus récent.
  - Première fois : 400 jours ; ensuite depuis le dernier passage, avec 3 jours de recouvrement. Au-delà de
    50 pages, la reprise se fait à la date du dernier paiement lu.
  - Opération normalisée : montant en centimes, date à l'heure de Paris, payeur, libellé (« Adhésion -
    formulaire - formule »), type carte.
  - Pas de doublon : clé `helloasso:payment:<id>`. Un paiement déjà importé par fichier CSV (référence = n° de
    paiement ou de commande) est écarté.
  - Écriture commune avec l'import CSV (`src/lib/financial-store.ts`). Le rapprochement est inchangé
    (suggestions, correspondances sûres).
  - Erreurs lisibles enregistrées et affichées : identifiants refusés, droits insuffisants, association
    introuvable, HelloAsso indisponible.
- **Réglage** : `HELLOASSO_API_URL` (facultatif) pour le bac à sable HelloAsso ; production par défaut.
- **Vérifié** :
  - 109 tests passent ; `tsc` et `next build` sans erreur ;
  - en local avec un faux serveur HelloAsso : mauvais secret refusé, connexion, 3 paiements importés puis 0 au
    second passage (fenêtre de 3 jours), opérations visibles « à rapprocher » ;
  - secret absent de la page, déconnexion ; 360 et 768 px.
- **Pas encore essayé avec un vrai compte HelloAsso** : il faudra une clé API d'association (ou du bac à sable).
- **Reste à faire** :
  - remboursements HelloAsso (paiement passé en « Refunded » après import) ;
  - jeton renouvelé par `refresh_token` plutôt que redemandé à chaque passage (un passage par jour aujourd'hui).

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
