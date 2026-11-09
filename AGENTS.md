Décision visuelle validée le 9 novembre 2026. Les quatre modèles sont Tribune (arena), Maison du club (club), Signal (studio) et Héritage (heritage). Héritage reprend la composition bordeaux/or, les diagonales et la mise en avant du blason de Saint-Gratien FC. Utiliser les contenus et médias du club Licyo. Les identifiants historiques restent compatibles. Les nouvelles vitrines privilégient les angles nets et des compositions distinctes.

## Lecture prioritaire — vision actualisée le 4 novembre 2026

Avant de concevoir ou coder, lire intégralement, dans cet ordre :
1. `docs/VISION_ET_CROISSANCE.md` : vision produit, future équipe Licyo, permissions, exploitation et lots.
2. `docs/HISTORIQUE_ET_REPRISE.md` : sources et interfaces historiques effectivement retrouvées.
3. `docs/REFONTE.md` : état local, migrations, vérifications et limites.
4. `docs/REFERENCES_CLUBS_PILOTES.md` : références concrètes ASC Muay Thaï / Saint-Gratien FC et traduction multisport.

Ces documents font partie des consignes du projet. Les demandes récentes du propriétaire et ce bloc priment sur les spécifications initiales ci-dessous en cas de contradiction. Distinguer exigences futures et capacités réellement implémentées. Ne pas supposer que le prototype historique ou le code local constitue un design validé ou un service prêt pour la production.

- Concevoir un produit pour tous les sports avec cinq expériences distinctes : marketing, vitrine client, back-office club, espace adhérent/famille, console de l’équipe Licyo.
- Le propriétaire doit pouvoir recruter et déléguer. Les salariés ont des comptes nominatifs, des rôles plateforme et des périmètres explicites ; ne jamais leur attribuer tous les pouvoirs de `super_admin` par facilité.
- Préparer dès les lots concernés : invitations/révocation, MFA plateforme, permissions vérifiées côté serveur, assistance temporaire, journal et protection du propriétaire.
- Aller au-delà du besoin immédiat en anticipant les parcours, la charge, les échecs et les besoins de l’équipe. Proposer les améliorations utiles et les traiter en lots cohérents, sans surdimensionner ni inventer des validations historiques.
- Reprendre comme référence la console historique claire à accents indigo et la force des vitrines historiques, puis améliorer les parcours. Prévoir trois modèles réellement distincts, des pages/blocs composables et un cycle brouillon/aperçu/publication versionné.
- Aucun tarif n’est fixé. La tarification selon l’effectif doit être administrable et les conditions acceptées versionnées.
- Les améliorations locales autorisées ne nécessitent pas de micro-validation. Aucun commit, push, service cloud, envoi externe ou déploiement n’est autorisé par ces seules consignes.

Le dossier de travail est le dépôt contenant ce fichier : vérifier son chemin, son état et son diff avant édition. Préserver les modifications présentes. Ne pas confondre cette copie avec une autre copie locale de Licyo. Les références externes et les aperçus locaux peuvent manquer sur une autre machine : utiliser les liens Git immuables du document historique et signaler une source réellement inaccessible.

---

# PROJET COMPLET : SAAS MULTI-TENANT DE CREATION DE SITES VITRINES & BACK-OFFICE POUR CLUBS SPORTIFS

## 1. INSTRUCTION MAITRE POUR Codex (VS CODE)

Tu es une équipe complète d'ingénieurs seniors (Architecte Next.js 15 / Cloudflare Workers, Lead UI/UX Designer Tailwind/Shadcn, Ingénieur Stripe Connect/Billing, et Expert SEO/GEO).
Ce qui suit décrit le socle initial du projet. La vision actualisée et les priorités sont définies dans les lectures obligatoires ci-dessus. Ne jamais faire passer des données de démonstration pour des données métier réelles.

L'application est un SaaS multi-tenant (multi-locataire) reposant sur un seul code source et une seule base de données Cloudflare D1, propulsant les espaces suivants :
1. `/(marketing)` : Le site commercial de notre entreprise SaaS (pour vendre la plateforme aux clubs).
2. `/[domain]` : Le site vitrine public de chaque club sportif client (accessible via sous-domaine `slug.domaine.fr` ou domaine personnalisé `www.nomduclub.fr`).
3. `/club-admin` : Le back-office ultra-intuitif destiné aux bénévoles du club (président, secrétaire, trésorier, éducateurs/coachs).
4. `/super-admin` : La console du propriétaire et de l’équipe Licyo, avec des rôles plateforme et des périmètres distincts des rôles club (création de démos en 1 clic, Mode Miroir, CRM prospects, import CSV/Excel, devis PDF, gestion des abonnements).

5. `/espace-adherent` : L’espace personnel des adhérents et familles, limité aux dossiers explicitement autorisés.

---

## 2. CONFIGURATION DE BASE : PACKAGE.JSON & VARIABLES D'ENVIRONNEMENT

### A. Dépendances obligatoires (`package.json`)
- Core : `next@^15`, `react@^19`, `react-dom@^19`, `typescript`
- Cloudflare : `@opennextjs/cloudflare`, `wrangler` (D1, R2, Email Service). Plus de Supabase depuis le 2026-11-09.
- UI & Design : `tailwindcss`, `lucide-react`, `framer-motion`, `clsx`, `tailwind-merge`, `class-variance-authority`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tabs`, `@radix-ui/react-select`, `@radix-ui/react-switch`, `@radix-ui/react-tooltip`, `sonner`
- Formulaires & Validation : `react-hook-form`, `@hookform/resolvers`, `zod`
- Paiements : `stripe`, `@stripe/stripe-js`
- PDF, Visuels, QR Code & CSV : `@react-pdf/renderer`, `@vercel/og`, `qrcode`, `@types/qrcode`, `papaparse`, `@types/papaparse`
- Emails : `@react-email/components` ; envoi par Cloudflare Email Service, Gmail par `fetch` (ni `nodemailer` ni `googleapis` : incompatibles Workers).
- Dates : `date-fns`

### B. Variables d'environnement
Voir `.env.example` (source de vérité).

---

## 3. REGLES D'ARCHITECTURE INVIOLABLES

1. Next.js 15 Async APIs : `params`, `searchParams`, `cookies()` et `headers()` sont des Promises. Utiliser TOUJOURS `await`.
2. Zéro texte sportif en dur : ne jamais écrire "Match", "Joueur", "Stade" en dur dans les composants. Consommer `getSportPreset(club.sport_type).vocabulary` depuis `src/config/sports-presets.ts`.
3. Contraste dynamique automatique : chaque club définit `primary_color` et `secondary_color`, injectées en variables CSS dans `/[domain]/layout.tsx` ; la couleur du texte (`#FFFFFF` ou `#09090B`) est calculée par la luminance YIQ.
4. Cache Serveur & Revalidation : les requêtes publiques de `/[domain]` utilisent `unstable_cache` avec le tag `club-${club.slug}`. Chaque Server Action modifiant un club appelle `revalidateTag('club-' + club.slug)`.
5. Frais Stripe répercutés (hors parcours par défaut : Licyo n'encaisse aucune cotisation, chaque club encaisse avec ses propres moyens) : uniquement si un club active `pass_stripe_fees_to_parents` :
   `totalWithFees = Math.ceil(((netAmount + 0.25) / (1 - 0.015)) * 100) / 100`
   `stripeFeeAdded = Number((totalWithFees - netAmount).toFixed(2))`
6. Compression client avant upload : toute photo du tunnel d'inscription est compressée côté navigateur via `<canvas>` en `image/webp` (largeur max 1200px, < 300 Ko).
7. Base générique tous sports : toute valeur par défaut, section ou texte doit convenir à un club de n'importe quel sport.

---

## 4. ARBORESCENCE

```text
/migrations/0001_schema_d1.sql   -> schéma D1 (SQLite) ; supabase/migrations = historique Postgres, non utilisé
/src
  /config/sports-presets.ts        -> presets multisports, vocabulaires, données de démo
  /types/database.ts
  /lib
    /db         query.ts (requêtes), policies.ts (règles d'accès = ex-RLS), server.ts (session, Mode Miroir), admin.ts (service), rpc.ts
    /auth       session.ts (sessions et liens de connexion), links.ts
    storage.ts  fichiers R2 (public /media, privé par lien signé)
    /utils      color-contrast.ts, image-compression.ts, impersonation.ts, crypto.ts
    /stripe     client.ts, fee-calculator.ts
    /seo-geo    json-ld.ts, metadata.ts
    /pdf        quote-saas-pdf.tsx, ce-attestation-pdf.tsx, forum-poster-pdf.tsx, ag-municipality-report-pdf.tsx
    /email      mailer.ts, templates.tsx
  /actions      super-admin.actions.ts, club-admin.actions.ts, public-club.actions.ts
  /components   /ui, /marketing, /vitrine, /club-admin
  /app
    /(marketing)        page.tsx, tarifs/page.tsx
    /(auth)             login/page.tsx, auth/callback/route.ts
    /super-admin        page, demo-generator, clubs (Mode Miroir), crm, import
    /club-admin         page, inscriptions, tresorerie, appel, sportif, contenus, parametres
    /[domain]           vitrine publique + tunnel d'inscription + llms.txt + sitemap
    /api                webhooks/stripe-saas, webhooks/stripe-connect, og/social-card, email/google/*, pdf/*, domains/check
  middleware.ts         -> routage multi-tenant par hôte
```

---

## 5. MODELE DE DONNEES

Le schéma complet est dans `migrations/0001_schema_d1.sql` (clubs, staff_members, facilities, categories, schedules, club_products, family_registrations, payment_installments, members, member_product_orders, attendances, events, event_convocations, posts, sponsors, sponsor_leads, anonymous_page_views, saas_prospects, platform_announcements). Les migrations suivantes sont additives (`0002_...`), jamais réécrites une fois appliquées en ligne. Toute nouvelle table multi-tenant reçoit ses règles dans `src/lib/db/policies.ts` et un test dans `tests/db-policies.test.ts` (sans règle : accès refusé).

---

## 6. ARCHITECTURE EMAIL HYBRIDE

Dans `/club-admin/parametres`, le club choisit son mode d'envoi :
1. **Défaut** : Cloudflare Email Service (liaison `EMAIL`, `EMAIL_FROM_ADDRESS`), `Reply-To` = e-mail du club. Sans domaine d'envoi, le message est seulement journalisé.
2. **Google OAuth (« Connecter Gmail »)** : le refresh token est stocké chiffré et l'envoi passe par l'API Gmail.
3. **SMTP privé (OVH, Infomaniak…)** : paramètres stockés chiffrés, mais non utilisables sur Workers (repli plateforme) tant qu'un relais n'est pas décidé.

Routeur : `src/lib/email/mailer.ts` (Gmail → plateforme).

---

## 7. FONCTIONNALITES

### A. Back-office du club
- **Validation split-screen** (`/club-admin/inscriptions`) : liste à gauche, aperçu de la pièce à droite ; « Valider » ou « Refuser une pièce » → envoi d'un lien magique de correction.
- **Feuille d'appel mobile** (`/club-admin/appel`) : présences cochées sur smartphone, mode hors ligne limité au besoin de la séance, isolé par utilisateur et club, avec expiration et effacement à la déconnexion ; ne pas conserver de dossiers complets ou documents sensibles dans le stockage du navigateur.
- **Rapports PDF** : attestation CE (logo, RNA, SIRET, signature du président) ; bilan AG & Mairie (mineurs/majeurs, % habitant la commune, livre des recettes par méthode de paiement).
- **Suivi des chèques** : échéancier avec dates de dépôt prévues (Oct/Nov/Déc).

### B. Site vitrine & tunnel d'inscription
- **Majeur/Mineur** : âge calculé en temps réel ; à 18 ans et plus, les champs parent et autorisation de sortie disparaissent.
- **Fratries & Stripe** : inscription de toute la famille ; si `pass_stripe_fees_to_parents`, le total inclut la formule inversée (+1,5 % + 0,25 €).
- **Route GEO** : `/[domain]/llms.txt` renvoie un Markdown des horaires et tarifs.

### C. Super-admin
- **Générateur de démo** : club + 4 catégories + 6 créneaux + 2 événements + 3 actualités à partir des presets.
- **Mode Miroir** : « Prendre le contrôle » pose le cookie signé `impersonated_club_id` et ouvre le back-office du club.
- **Import CSV** : `papaparse` pour les anciens fichiers (Footclubs/Ten'Up).

---

## 8. ECARTS ASSUMES PAR RAPPORT A LA SPEC D'ORIGINE (sécurité)

- **Secrets e-mail hors de `clubs`** : les données publiques de vitrine doivent provenir d’une projection limitée ; ne pas exposer la table interne `clubs` en entier. Le refresh token Gmail et le mot de passe SMTP privé sont donc dans `club_mail_credentials` (aucune règle dans policies.ts = service uniquement), chiffrés AES-256-GCM (`EMAIL_CREDENTIALS_ENCRYPTION_KEY`).
- **OAuth Gmail sans next-auth** : flux OAuth direct par `fetch` (`/api/email/google/start` et `/callback`, `state` signé HMAC).
- **Formulaires publics via Server Actions** : pas d'`INSERT` anonyme en RLS. Inscriptions, essais et contacts sponsors passent par des Server Actions qui valident (zod) et **recalculent les montants côté serveur** avant d'écrire avec le client service role. Un client ne fixe jamais un prix ni un statut de paiement.
- **Webhooks Stripe idempotents** : signature vérifiée, statut de paiement relu dans l'objet Stripe.
- **Tables de l'espace privé** : les colonnes de statut ont des `CHECK`, les tables multi-tenant ont un index sur `club_id`.

## 9. HEBERGEMENT (décision du propriétaire du 2026-11-09 : tout sur Cloudflare)

Remplace la décision du 2026-10-28 (Docker + Caddy + Supabase Paris).

- Application : Next.js sur Cloudflare Workers via OpenNext (`wrangler.jsonc`, `open-next.config.ts`). Compte Cloudflare « Abiweb ». Offre Workers payante nécessaire (taille du Worker > 3 Mo compressé).
- Données : D1 `licyo`, juridiction UE (pas « France ») ; fichiers : R2 `licyo-public` et `licyo-private`, juridiction UE.
- Pas de RLS : les règles d'accès de `src/lib/db/policies.ts` s'appliquent à chaque requête des clients `createClient` (session) et `createPublicClient` (visiteur). `createAdminClient` ignore les règles : uniquement après contrôle explicite.
- Comptes : sessions et liens de connexion maison (`src/lib/auth`), jetons stockés sous forme d'empreinte SHA-256.
- Test : hôte `*.workers.dev`, vitrines par chemin (`/<slug>`), connexion sans e-mail par `npm run login-link`. Nom de domaine, Cloudflare for SaaS (domaines des clubs) et domaine d'envoi d'e-mails : plus tard.
- Commandes : `npm run preview` (local), `npm run deploy`, `npm run db:migrate:local|remote`, `npm run db:seed:local|remote` (données fictives).

## 10. REGLES DE TRAVAIL

- Ne jamais committer ni pousser sans demande explicite.
- Ne pas créer de ressources cloud (Cloudflare, Stripe) ni déployer sans demande.
- Vérifier `npm run build` (zéro erreur TypeScript) et le rendu à ~360 px et ~768 px avant d'annoncer une page terminée.
