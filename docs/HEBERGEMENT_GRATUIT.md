# Hébergement gratuit en attendant le premier client

Décision du propriétaire, le 2026-11-15 : Licyo tourne sur l'**offre gratuite** de Cloudflare Workers tant qu'aucun
club ne paie. **Au premier client, passer à l'offre Workers Paid (5 $ par mois pour toute la plateforme)**. C'est
la bonne option pour un service réel. Rien n'a été supprimé pour tenir dans le gratuit.

## Pourquoi un mode allégé

| Limite de l'offre gratuite | Licyo complet | Licyo allégé |
| --- | --- | --- |
| Taille du Worker : 3 Mo compressé | 3,62 Mo, refusé | 2,9 Mo (mesuré le 2026-11-15) |
| Temps de calcul : 10 ms par requête | souvent dépassé par les pages Next.js | même risque, à surveiller |

Le CRM de Saint-Gratien FC reste gratuit parce qu'il sert des pages HTML toutes prêtes (Cloudflare Pages, gratuites
et illimitées) et de petites fonctions sans framework. Licyo est une application Next.js qui sert plusieurs clubs :
le serveur Next.js est embarqué dans le Worker et construit les pages à chaque visite.

## Ce qui change en mode allégé (`LICYO_LITE=1`)

- Le générateur d'images de partage (`next/og`, moteur de dessin de 1,4 Mo) n'est pas embarqué. Il est remplacé
  par `src/lib/lite/og-stub.ts`, via un alias dans `next.config.ts`. La route `/api/og/social-card` répond 503.
- L'aperçu de partage d'une vitrine (WhatsApp, réseaux) reprend la photo d'accueil ou le logo du club ; sans photo,
  c'est un aperçu texte (`src/lib/seo-geo/metadata.ts`).
- Tout le reste est identique, y compris les PDF : les écarter ne fait gagner que 10 Ko.

## Commandes

- `npm run build:gratuit` : build allégé et mesure de la taille ; arrêt si elle dépasse 3 Mo moins 30 Ko de marge.
- `npm run deploy:gratuit` : même chose, puis déploiement si la taille passe.
- `npm run deploy` : build **complet** pour l'offre Workers Paid.

## Passage à l'offre payante (premier client)

1. Tableau de bord Cloudflare, compte Abiweb, Workers & Pages > Plans : souscrire **Workers Paid**.
2. Déployer avec `npm run deploy` (build complet). Les images de partage aux couleurs du club reviennent.
3. Mettre à jour ce document.

## Limites à surveiller tant qu'on est en gratuit

- 100 000 requêtes par jour, D1 à 5 millions de lignes lues et 100 000 écrites par jour : au-delà, Cloudflare
  renvoie des erreurs et ne facture rien.
- Temps de calcul de 10 ms : une page lourde du back-office peut échouer avec l'erreur 1102. Si cela arrive avec un
  vrai club, c'est le signal de passer à l'offre payante.
- R2 : gratuit jusqu'à 10 Go stockés par mois, sans frais de téléchargement. Prévoir une alerte de facturation à
  1 $ (Billing > Notifications).
