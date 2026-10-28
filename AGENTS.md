# PROJET COMPLET : SAAS MULTI-TENANT DE CREATION DE SITES VITRINES & BACK-OFFICE POUR CLUBS SPORTIFS

## 1. INSTRUCTION MAITRE POUR Codex (VS CODE)

Tu es une équipe complète d'ingénieurs seniors (Architecte Next.js 15 / Supabase, Lead UI/UX Designer Tailwind/Shadcn, Ingénieur Stripe Connect/Billing, et Expert SEO/GEO).
Ce fichier contient la spécification intégrale et définitive du projet. Tu dois construire l'application complète de A à Z en suivant scrupuleusement cette architecture, sans jamais laisser de fichiers incomplets, de `// TODO` ou de données factices là où une requête Supabase doit exister.

L'application est un SaaS multi-tenant (multi-locataire) reposant sur un seul code source et une seule base de données Supabase, propulsant 4 espaces :
1. `/(marketing)` : Le site commercial de notre entreprise SaaS (pour vendre la plateforme aux clubs).
2. `/[domain]` : Le site vitrine public de chaque club sportif client (accessible via sous-domaine `slug.domaine.fr` ou domaine personnalisé `www.nomduclub.fr`).
3. `/club-admin` : Le back-office ultra-intuitif destiné aux bénévoles du club (président, secrétaire, trésorier, éducateurs/coachs).
4. `/super-admin` : Le poste de pilotage exclusif du propriétaire du SaaS (création de démos en 1 clic, Mode Miroir, CRM prospects, import CSV/Excel, devis PDF, gestion des abonnements).

---

## 2. CONFIGURATION DE BASE : PACKAGE.JSON & VARIABLES D'ENVIRONNEMENT

### A. Dépendances obligatoires (`package.json`)
- Core : `next@^15`, `react@^19`, `react-dom@^19`, `typescript`
- Supabase : `@supabase/supabase-js`, `@supabase/ssr`
- UI & Design : `tailwindcss`, `lucide-react`, `framer-motion`, `clsx`, `tailwind-merge`, `class-variance-authority`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tabs`, `@radix-ui/react-select`, `@radix-ui/react-switch`, `@radix-ui/react-tooltip`, `sonner`
- Formulaires & Validation : `react-hook-form`, `@hookform/resolvers`, `zod`
- Paiements : `stripe`, `@stripe/stripe-js`
- PDF, Visuels, QR Code & CSV : `@react-pdf/renderer`, `@vercel/og`, `qrcode`, `@types/qrcode`, `papaparse`, `@types/papaparse`
- Emails (Intégration Hybride Native) : `nodemailer`, `@types/nodemailer`, `googleapis`, `@react-email/components`
- Dates : `date-fns`

### B. Variables d'environnement
Voir `.env.example` (source de vérité).

---

## 3. REGLES D'ARCHITECTURE INVIOLABLES

1. Next.js 15 Async APIs : `params`, `searchParams`, `cookies()` et `headers()` sont des Promises. Utiliser TOUJOURS `await`.
2. Zéro texte sportif en dur : ne jamais écrire "Match", "Joueur", "Stade" en dur dans les composants. Consommer `getSportPreset(club.sport_type).vocabulary` depuis `src/config/sports-presets.ts`.
3. Contraste dynamique automatique : chaque club définit `primary_color` et `secondary_color`, injectées en variables CSS dans `/[domain]/layout.tsx` ; la couleur du texte (`#FFFFFF` ou `#09090B`) est calculée par la luminance YIQ.
4. Cache Serveur & Revalidation : les requêtes publiques de `/[domain]` utilisent `unstable_cache` avec le tag `club-${club.slug}`. Chaque Server Action modifiant un club appelle `revalidateTag('club-' + club.slug)`.
5. Frais Stripe répercutés : quand `club.pass_stripe_fees_to_parents` est `true` :
   `totalWithFees = Math.ceil(((netAmount + 0.25) / (1 - 0.015)) * 100) / 100`
   `stripeFeeAdded = Number((totalWithFees - netAmount).toFixed(2))`
6. Compression client avant upload : toute photo du tunnel d'inscription est compressée côté navigateur via `<canvas>` en `image/webp` (largeur max 1200px, < 300 Ko).
7. Base générique tous sports : toute valeur par défaut, section ou texte doit convenir à un club de n'importe quel sport.

---

## 4. ARBORESCENCE

```text
/supabase/migrations/0001_initial_complete_schema.sql   -> tables, index, fonctions, RLS, buckets
/src
  /config/sports-presets.ts        -> 12 sports, vocabulaires, données de démo
  /types/database.ts
  /lib
    /supabase   client.ts, server.ts (Mode Miroir), admin.ts (service role), storage.ts
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
    /api                webhooks/stripe-saas, webhooks/stripe-connect, og/social-card, email/google/*, pdf/*
  middleware.ts         -> routage multi-tenant par hôte
```

---

## 5. MODELE DE DONNEES

Le schéma complet est dans `supabase/migrations/0001_initial_complete_schema.sql` (clubs, staff_members, facilities, categories, schedules, club_products, family_registrations, payment_installments, members, member_product_orders, attendances, events, event_convocations, posts, sponsors, sponsor_leads, anonymous_page_views, saas_prospects, platform_announcements). Les migrations suivantes sont additives (`0002_...`), jamais réécrites.

---

## 6. ARCHITECTURE EMAIL HYBRIDE

Dans `/club-admin/parametres`, le club choisit son mode d'envoi :
1. **Défaut** : SMTP de la plateforme (Nodemailer), `Reply-To` = e-mail du club.
2. **Google OAuth (« Connecter Gmail »)** : le refresh token est stocké chiffré et l'envoi passe par l'API Gmail.
3. **SMTP privé (OVH, Infomaniak…)** : paramètres stockés chiffrés.

Routeur : `src/lib/email/mailer.ts` (Gmail → SMTP privé → SMTP plateforme).

---

## 7. FONCTIONNALITES

### A. Back-office du club
- **Validation split-screen** (`/club-admin/inscriptions`) : liste à gauche, aperçu de la pièce à droite ; « Valider » ou « Refuser une pièce » → envoi d'un lien magique de correction.
- **Feuille d'appel mobile** (`/club-admin/appel`) : présences cochées sur smartphone, liste, numéros d'urgence et autorisation de sortie seul gardés dans `localStorage` (hors ligne).
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

- **Secrets e-mail hors de `clubs`** : la table `clubs` est lisible publiquement (vitrine). Le refresh token Gmail et le mot de passe SMTP privé sont donc dans `club_mail_credentials` (RLS sans politique = service role uniquement), chiffrés AES-256-GCM (`EMAIL_CREDENTIALS_ENCRYPTION_KEY`).
- **OAuth Gmail sans next-auth** : flux OAuth direct via `googleapis` (`/api/email/google/start` et `/callback`, `state` signé HMAC). next-auth aurait ajouté une seconde session concurrente de Supabase Auth.
- **Formulaires publics via Server Actions** : pas d'`INSERT` anonyme en RLS. Inscriptions, essais et contacts sponsors passent par des Server Actions qui valident (zod) et **recalculent les montants côté serveur** avant d'écrire avec le client service role. Un client ne fixe jamais un prix ni un statut de paiement.
- **Webhooks Stripe idempotents** : signature vérifiée, statut de paiement relu dans l'objet Stripe.
- **Tables de l'espace privé** : les colonnes de statut ont des `CHECK`, les tables multi-tenant ont un index sur `club_id`.

## 9. REGLES DE TRAVAIL

- Ne jamais committer ni pousser sans demande explicite.
- Ne pas créer de ressources cloud (Supabase, Vercel, Stripe) sans demande.
- Vérifier `npm run build` (zéro erreur TypeScript) et le rendu à ~360 px et ~768 px avant d'annoncer une page terminée.
