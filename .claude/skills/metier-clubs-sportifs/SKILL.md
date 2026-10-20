---
name: metier-clubs-sportifs
description: Connaissance métier de la gestion d'un club sportif associatif en France (Licyo). À charger pour toute fonctionnalité touchant aux inscriptions, adhérents, familles, licences, cotisations, saisons, certificats et pièces, présences, équipes, convocations, e-mails aux familles, bureau du club ou abonnement d'un club à la plateforme.
---

# Métier : clubs sportifs associatifs

## Le club

- Association loi 1901, gérée par des **bénévoles** peu disponibles et pas forcément à l'aise avec l'informatique : écrans simples, peu de saisie, actions groupées, relances automatiques.
- **Bureau** : président (responsable légal), trésorier (argent), secrétaire (dossiers, licences). Souvent aussi entraîneurs et éducateurs qui ne doivent voir que leurs groupes.
- Le club rend des comptes à son **assemblée générale** : effectifs, finances, exports simples.

## La saison

- Saison sportive de septembre à juin ou août selon le sport ; libellée « 2026-2027 ».
- Pic d'activité de juin à octobre (réinscriptions, inscriptions, forums des associations) : l'outil doit être rapide et fiable à ce moment-là.
- Une adhésion appartient à une saison ; la réinscription crée une nouvelle adhésion et conserve l'historique.

## L'inscription

- Parcours : intérêt ou pré-inscription, dossier, pièces, validation, licence, paiement, affectation à un groupe.
- **Licence fédérale** : délivrée par la fédération (ex. Footclubs pour la FFF), distincte de la **cotisation** au club. Certains sports ou activités loisir n'ont pas de licence obligatoire : ne jamais l'imposer à tous.
- **Santé** : certificat médical ou questionnaire de santé selon l'âge, le sport et la réglementation en vigueur ; donnée sensible, accès restreint. Vérifier la règle à jour avant de coder une exigence.
- **Mineurs** : responsable légal obligatoire, autorisation parentale, contacts d'urgence, autorisation de soins, **droit à l'image** recueilli séparément.
- Catégories d'âge calculées selon l'année de naissance et les règles de la fédération (ex. U10 en football), différentes selon les sports.
- Informations propres au sport : grade ou ceinture, classement, poids, taille d'équipement, poste. Champs facultatifs et propres au club, jamais des colonnes obligatoires pour tous.

## L'argent

- Cotisation souvent payée en plusieurs fois, par chèque, espèces, virement, HelloAsso, chèques-vacances ou coupons sport, aides (Pass'Sport, aides des communes ou CAF : montants et conditions à vérifier chaque saison).
- Réductions familles (fratrie), tarifs par catégorie, remboursements rares mais à tracer.
- Les fonds vont au club, jamais à la plateforme. « Marqué payé » par un bénévole et « paiement confirmé » par le prestataire sont deux états distincts.
- Le trésorier a besoin d'exports clairs et rapprochables.

## La communication

- Familles contactées par e-mail (et souvent SMS ou messageries) : convocations, annulations d'entraînement, relances de dossier, informations de rentrée.
- Ton simple et bienveillant, identité du club (nom, couleurs, réponse vers le club).
- Désinscription possible pour tout ce qui n'est pas strictement lié au dossier.

## Données et RGPD

- Beaucoup de **mineurs** : minimisation, durée de conservation après la dernière saison, droit d'accès et d'effacement.
- Aucune vraie personne ni vrai club dans les exemples et tests : utiliser le Club Démo fictif.

## Réflexes pour Licyo

- Tout vocabulaire de fédération s'écrit dans la forme de référence football, traduite par le profil sportif (`sport-profile.js`).
- Toute nouvelle liste d'inscrits applique le filtrage par groupe de l'entraîneur.
- Penser à chaque profil : famille sur mobile, bénévole pressé, trésorier, responsable de la plateforme.
