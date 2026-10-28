# Déployer Licyo

Objectif : un serveur en France et la possibilité de changer d'hébergeur sans réécrire le code.

## Pièces

| Pièce | Choix initial | Pour déménager |
|---|---|---|
| Application Next.js | Image Docker (`Dockerfile`, sortie `standalone`) sur un VPS français (OVH Gravelines/Roubaix, Scaleway Paris) | Relancer la même image ailleurs |
| Base, connexion, fichiers | Supabase cloud, région **Paris (eu-west-3)**, ou Supabase auto-hébergé sur le VPS | `pg_dump` / `pg_restore` (Postgres standard) + copie du stockage |
| HTTPS et domaines des clubs | Caddy (`deploy/Caddyfile`), certificats automatiques à la demande | Aucun changement |
| DNS / CDN | Au choix (Cloudflare, OVH…) | Aucun changement |

## Étapes

1. Créer le projet Supabase (région Paris) et appliquer `supabase/migrations/*.sql` dans l'ordre.
2. Dans Supabase > Authentication > URL Configuration : URL du site = `NEXT_PUBLIC_APP_URL`, redirection autorisée = `${NEXT_PUBLIC_APP_URL}/auth/callback`.
3. Créer le premier super-admin : inviter l'adresse depuis Supabase (Authentication > Users), puis exécuter
   `insert into staff_members (user_id, club_id, full_name, email, role) values ('<uuid>', null, 'Nom', 'email', 'super_admin');`
4. DNS : `licyo.fr`, `*.licyo.fr` et `sites.licyo.fr` vers l'IP du VPS.
5. Sur le VPS : copier `.env.example` en `.env`, le compléter (`openssl rand -base64 32` pour `EMAIL_CREDENTIALS_ENCRYPTION_KEY`, 64 caractères aléatoires pour `IMPERSONATION_SECRET_KEY`), puis `cd deploy && docker compose up -d --build`.
6. Stripe : webhooks `…/api/webhooks/stripe-saas` (événements `checkout.session.completed`, `customer.subscription.*`) et `…/api/webhooks/stripe-connect` (Connect : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `account.updated`).
7. Google Cloud (bouton « Connecter Gmail ») : URI de redirection `${NEXT_PUBLIC_APP_URL}/api/email/google/callback`, portée `gmail.send`.

## Brancher ou changer le nom de domaine

Aucun domaine n'est écrit dans le code : tout découle de `NEXT_PUBLIC_ROOT_DOMAIN`.

1. Chez le registraire (OVH, Gandi…), créer : `@` (A → IP du VPS), `*` (A → IP du VPS, sous-domaines des clubs), `sites` (A → IP du VPS, cible des domaines personnalisés).
2. Dans `.env` : `NEXT_PUBLIC_ROOT_DOMAIN=mondomaine.fr`, `NEXT_PUBLIC_APP_URL=https://mondomaine.fr`, `CUSTOM_DOMAIN_CNAME_TARGET=sites.mondomaine.fr`, `SMTP_USER`/`EMAIL_FROM` sur ce domaine (avec SPF et DKIM chez le fournisseur d'e-mail), `PLATFORM_CONTACT_EMAIL` (facultatif, affiché sur les devis).
3. Supabase > Authentication > URL Configuration : mettre à jour l'URL du site et `https://mondomaine.fr/auth/callback`.
4. Stripe (URL des deux webhooks) et Google Cloud (URI de redirection Gmail) : remplacer l'ancien domaine.
5. `docker compose up -d --build` (les variables `NEXT_PUBLIC_*` sont intégrées au build). Caddy obtient seul les nouveaux certificats.

Les clubs qui ont leur propre domaine n'ont rien à changer, sauf si `CUSTOM_DOMAIN_CNAME_TARGET` change : il faut alors mettre à jour leur CNAME.

## Sauvegardes

Supabase cloud : sauvegardes quotidiennes incluses. Auto-hébergé : `pg_dump` planifié vers un stockage objet français, avec un test de restauration chaque trimestre.
