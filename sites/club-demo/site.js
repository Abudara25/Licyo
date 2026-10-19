// Configuration du site public de Club Démo (SiteConfig, schemaVersion 2) — organisation « org_demo ».
// SOURCE DE VÉRITÉ des pages publiques depuis la phase 4D.1 : les pages HTML de la racine sont GÉNÉRÉES à partir
// de ce fichier (npm run pages, scripts/build-pages.mjs) ; ne plus les modifier à la main.
//
// Structure, textes éditoriaux et valeurs de secours uniquement (phase 4D.2A : plus aucun fragment HTML, chaque
// page est une liste de sections structurées, voir content/). Les données métier vivantes (groupes, créneaux,
// lieux, tarif, coordonnées) restent en base D1 et sont injectées à l'exécution par
// functions/_shared/page-data.js dans les éléments liés (data-org-*) : les textes présents ici n'en sont que la
// valeur de secours. Aucun secret. Le document produit est du JSON pur (tests/site-renderer.test.mjs).
import { sections as accueil } from './content/accueil.js';
import { sections as actualites, notFoundSections } from './content/actualites.js';
import { sections as equipe } from './content/equipe.js';
import { sections as entrainements } from './content/entrainements.js';
import { sections as inscription } from './content/inscription.js';
import { sections as preinscription } from './content/preinscription.js';
import { sections as contact } from './content/contact.js';
import { sections as partenaires } from './content/partenaires.js';
import { mentionsSections, privacySections } from './content/legal.js';
import { partners } from './content/shared.js';

export const site = {
  schemaVersion: 2,
  id: 'club-demo',
  organizationId: 'org_demo',
  locale: 'fr-FR',
  theme: {
    id: 'dynamic_diagonal',
    version: 1,
    palette: 'club-demo',
    stylesheet: 'assets/css/styles.css',
    preloadFonts: ['assets/fonts/inter.woff2', 'assets/fonts/oswald.woff2'],
  },
  brand: {
    name: 'Club Démo',
    shortName: 'DEMO',
    tagline: 'Club de démonstration',
    logo: {
      small: 'assets/images/logo-96.webp',
      large: 'assets/images/logo.webp',
      alt: 'Blason du Club Démo',
    },
    favicon: 'assets/images/favicon.ico',
    appleTouchIcon: 'assets/images/apple-touch-icon.png',
    manifest: 'manifest.json',
    themeColor: '#4f1414',
  },
  seo: {
    siteUrl: 'https://clubdemo.licyo.fr',
    robots: 'index, follow',
    ogLocale: 'fr_FR',
    twitterCard: 'summary_large_image',
    ogImage: { url: 'https://clubdemo.licyo.fr/assets/images/og-image.jpg', width: 1200, height: 630 },
  },
  contact: {
    // Lieu principal (valeur de secours du lieu en base) : footer, carte.
    location: {
      short: 'Stade municipal, Sportville',
      href: '/contact',
      name: 'Stade municipal',
      address: "1 rue du Stade, 00000 Sportville",
      embedUrl: "https://www.google.com/maps?q=Stade%20municipal%201%20rue%20du%20Stade%2C%2000000%20Sportville&output=embed",
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Stade+municipal+1+rue+du+Stade+00000+Sportville',
      mapTitle: 'Carte — Stade municipal, Sportville',
    },
    email: 'contact@clubdemo.licyo.fr',
    phone: { display: '06 00 00 00 00', tel: '+33600000000' },
  },
  navigation: {
    items: [
      { label: 'Accueil', href: '/' },
      { label: 'Actualités', href: '/actualites' },
      { label: 'Le Club', href: '/equipe' },
      { label: 'Entraînements', href: '/entrainements' },
      { label: 'Partenaires', href: '/partenaires' },
      { label: 'Contact', href: '/contact' },
    ],
    cta: { label: 'Inscription', href: '/inscription', statusHook: true },
  },
  social: [
    { network: 'facebook', href: 'https://www.facebook.com/clubdemo' },
    { network: 'instagram', href: 'https://www.instagram.com/clubdemo' },
  ],
  footer: {
    about: [
      'Nouveau club de football loisir à Sportville, le Club Démo accueille les filles et les garçons de 5 à 8 ans',
      {
        bind: {
          tag: 'span',
          attrs: [['data-org-if', 'groups.any']],
          children: [
            ' (',
            {
              bind: { tag: 'span', attrs: [['data-org-list', 'groups-names']], children: ['U6-U7 et U8-U9'] },
            },
            ')',
          ],
        },
      },
      ' dans un esprit familial, 100% porté par des bénévoles.',
    ],
    navigationTitle: 'Navigation',
    practical: { title: 'Infos pratiques', items: ['location', 'email', 'phone'] },
    bottom: [
      { content: ['© 2026 Club Démo — Tous droits réservés.'], minimal: true },
      {
        content: [
          { link: { href: '/mentions-legales', children: ['Mentions légales'] } },
          ' · ',
          { link: { href: '/confidentialite', children: ['Confidentialité'] } },
        ],
        minimal: true,
      },
      { content: ['Club de démonstration · Depuis 2020'] },
      {
        content: [
          'Site créé par ',
          { link: { href: 'https://abiweb.fr', variant: 'external-nofollow', children: ['Abiweb'] } },
        ],
        minimal: true,
      },
    ],
  },
  // Actualités (content/articles.json, Sveltia CMS) : une page par article, rendue à l'exécution par
  // functions/actualites/[slug].js. Les clés de catégorie sont celles du CMS (admin/config.yml).
  news: {
    route: '/actualites',
    breadcrumbIndexPath: '/actualites.html',
    homeLabel: 'Accueil',
    indexLabel: 'Actualités',
    backLabel: 'Retour aux actualités',
    defaultCategory: 'club',
    categories: {
      club: { label: 'Club', icon: 'shield-check' },
      inscriptions: { label: 'Inscriptions', icon: 'clipboard' },
      benevolat: { label: 'Bénévolat', icon: 'heart' },
      evenement: { label: 'Événement', icon: 'calendar-star' },
      partenariat: { label: 'Partenariat', icon: 'briefcase' },
    },
    scripts: ['assets/js/main.js'],
  },
  notFoundPage: 'introuvable',
  pages: [
    {
      id: 'accueil',
      route: '/',
      file: 'index.html',
      seo: {
        title: 'Club Démo — École de football U6-U9 | Club de démonstration',
        description: 'Le Club Démo est un nouveau club de football loisir à Sportville (Club de démonstration), ouvert aux filles et aux garçons de 5 à 8 ans (U6-U7, U8-U9). Inscriptions ouvertes pour la première saison.',
        canonical: true,
        ogTitle: 'Club Démo — École de football U6-U9',
        ogDescription: 'Nouveau club de football loisir à Sportville (Club de démonstration), ouvert aux filles et aux garçons de 5 à 8 ans (U6-U7, U8-U9). Inscriptions ouvertes.',
      },
      head: {
        preloadImages: [{ href: 'assets/images/logo.webp', fetchpriority: 'high' }],
        jsonLd: [
          {
            binding: 'club',
            data: {
              '@context': 'https://schema.org',
              '@type': 'SportsClub',
              name: 'Club Démo',
              url: 'https://clubdemo.licyo.fr/',
              logo: 'https://clubdemo.licyo.fr/assets/images/logo-96.webp',
              image: 'https://clubdemo.licyo.fr/assets/images/og-image.jpg',
              sport: 'Football',
              foundingDate: '2020',
              areaServed: 'Sportville, Club de démonstration',
              address: {
                '@type': 'PostalAddress',
                streetAddress: '1 rue du Stade',
                postalCode: '00000',
                addressLocality: 'Sportville',
                addressCountry: 'FR',
              },
              email: 'contact@clubdemo.licyo.fr',
              telephone: '+33600000000',
              sameAs: ['https://www.instagram.com/clubdemo', 'https://www.facebook.com/clubdemo'],
              description: 'Club de football loisir ouvert aux filles et aux garçons de Sportville, catégories U6-U7 et U8-U9.',
            },
          },
        ],
      },
      scripts: ['assets/js/main.js', 'assets/js/actualites.js'],
      lightbox: true,
      sections: [
        {
          type: 'hero',
          id: 'accueil.hero',
          comment: 'Hero',
          eyebrow: 'Nouveau club loisir · Club de démonstration',
          title: ['L\'esprit d\'équipe,', { br: true }, 'la passion du ', { em: ['ballon\u00a0rond'] }],
          lead: [
            'Le foot loisir pour les filles et les garçons de Sportville',
            {
              bind: {
                tag: 'span',
                attrs: [['data-org-if', 'groups.any']],
                children: [
                  ', en ',
                  {
                    bind: { tag: 'span', attrs: [['data-org-list', 'groups-names']], children: ['U6-U7 et U8-U9'] },
                  },
                ],
              },
            },
            ', dans une ambiance familiale.',
          ],
          actions: [
            { href: '/inscription', label: 'Inscription', style: 'primary', statusHook: true },
            // Revue UX 2026-10-16 : l'essai gratuit à côté de l'inscription (« Le Club » reste dans le menu).
            { href: '/contact', label: 'Essai gratuit', style: 'outline' },
          ],
          emblem: {
            src: 'assets/images/logo.webp',
            alt: 'Blason du Club Démo',
            width: 360,
            height: 360,
            fetchpriority: 'high',
          },
          notice: { tag: 'Nouveau', label: 'Pré-inscription U10 (enfants de 2017)', href: '/pre-inscription-u10' },
          partner: { label: 'Équipementier du club', name: partners[0].name, logo: partners[0].logo },
          stats: [
            { value: { content: ['5 à 8 ans'] }, label: { content: ['Filles et garçons'] } },
            {
              bind: [['data-org-if', 'schedule.any']],
              value: {
                bind: [['data-org-list', 'slots-compact']],
                content: [
                  { bind: { tag: 'span', attrs: [['data-org', 'schedule.Day']], children: ['Jeudi'] } },
                  ' ',
                  { bind: { tag: 'span', attrs: [['data-org', 'schedule.start']], children: ['17h'] } },
                ],
              },
              label: {
                bind: [['data-org', 'location.name'], ['data-org-if', 'location.name']],
                content: ['Stade municipal'],
              },
            },
            {
              bind: [['data-org-if', 'price.season']],
              value: { bind: [['data-org', 'price.season']], content: ['180 €'] },
              label: { content: ['La saison, tenue incluse'] },
            },
            { value: { content: ['1er essai'] }, label: { content: ['Gratuit, sans engagement'] } },
          ],
        },
        ...accueil,
      ],
    },
    {
      id: 'actualites',
      route: '/actualites',
      file: 'actualites.html',
      seo: {
        title: 'Actualités — Club Démo (École de foot U6-U9)',
        description: 'Actualités du Club Démo : ouverture du club, inscriptions, vie associative et événements pour les U6-U9.',
        canonical: true,
        ogTitle: 'Actualités — Club Démo',
        ogDescription: 'Actualités du Club Démo : ouverture du club, inscriptions, vie associative et événements pour les U6-U9.',
      },
      scripts: ['assets/js/main.js', 'assets/js/actualites.js'],
      lightbox: true,
      sections: [
        {
          type: 'page_header',
          id: 'actualites.header',
          eyebrow: 'Vie du club',
          title: 'Actualités',
          lead: ['Suivez les débuts du Club Démo : inscriptions, entraînements et vie associative.'],
        },
        ...actualites,
      ],
    },
    {
      id: 'equipe',
      route: '/equipe',
      file: 'equipe.html',
      seo: {
        title: 'Le Club — Club Démo (École de foot U6-U9)',
        description: 'Découvrez le Club Démo : notre mission, notre encadrement et nos catégories U6-U7 et U8-U9, ouvertes aux filles comme aux garçons.',
        canonical: true,
        ogTitle: 'Le Club — Club Démo',
        ogDescription: 'Découvrez le Club Démo : notre mission, notre encadrement et nos catégories U6-U7 et U8-U9, ouvertes aux filles comme aux garçons.',
      },
      scripts: ['assets/js/main.js'],
      sections: [
        {
          type: 'page_header',
          id: 'equipe.header',
          eyebrow: '1ère saison · 2026',
          title: 'Le Club',
          lead: ['Notre mission, notre encadrement et nos catégories, pour une première saison pleine de plaisir.'],
        },
        ...equipe,
      ],
    },
    {
      id: 'entrainements',
      route: '/entrainements',
      file: 'entrainements.html',
      seo: {
        title: 'Entraînements — Club Démo (École de foot U6-U9)',
        description: 'Horaires d\'entraînement, lieu et infos pratiques pour rejoindre le Club Démo, club de foot U6-U9 à Sportville.',
        canonical: true,
        ogTitle: 'Entraînements — Club Démo',
        ogDescription: 'Horaires d\'entraînement, lieu et infos pratiques pour rejoindre le Club Démo, club de foot U6-U9 à Sportville.',
      },
      head: {
        jsonLd: [
          {
            binding: 'faq',
            data: {
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: [
                {
                  '@type': 'Question',
                  name: 'Quel âge faut-il pour rejoindre le Club Démo ?',
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Filles et garçons sont les bienvenus : le club accueille les enfants nés en 2020 ou 2021 en catégorie U6-U7 et ceux nés en 2018 ou 2019 en catégorie U8-U9, pour la saison 2026-2027.',
                  },
                },
                {
                  '@type': 'Question',
                  name: 'Où et quand ont lieu les entraînements ?',
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Les entraînements ont lieu tous les jeudis de 17h à 18h au Stade municipal, 1 rue du Stade, 00000 Sportville.',
                  },
                },
                {
                  '@type': 'Question',
                  name: 'Puis-je assister à un entraînement avant d\'inscrire mon enfant ?',
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Oui, une séance d\'essai gratuite et sans engagement est possible avant de s\'inscrire.',
                  },
                },
                {
                  '@type': 'Question',
                  name: 'Quel est le prix de l\'adhésion au Club Démo ?',
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'L\'adhésion coûte 180 € pour la saison, licence et tenue complète incluses (maillot, short, survêtement, sac). Le club accepte le Pass\'Sport, une aide de l\'État de 50 € pour les enfants de 6 ans et plus, sous conditions de ressources.',
                  },
                },
                {
                  '@type': 'Question',
                  name: 'Comment inscrire mon enfant au club ?',
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'L\'inscription se fait en ligne via le formulaire du site, avec paiement par HelloAsso, chèque ou espèces.',
                  },
                },
                {
                  '@type': 'Question',
                  name: 'Le club propose-t-il un second créneau d\'entraînement ?',
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: 'Pas pour cette saison : un seul créneau (jeudi 17h-18h) est disponible. Un second créneau est envisagé pour une saison suivante, selon le nombre d\'adhérents et la possibilité de louer un terrain supplémentaire.',
                  },
                },
              ],
            },
          },
        ],
      },
      scripts: ['assets/js/main.js'],
      sections: [
        {
          type: 'page_header',
          id: 'entrainements.header',
          eyebrow: 'Rejoignez-nous sur le terrain',
          title: 'Entraînements',
          lead: ['Toutes les infos pratiques pour venir découvrir le club avec votre enfant.'],
        },
        ...entrainements,
      ],
    },
    {
      id: 'inscription',
      route: '/inscription',
      file: 'inscription.html',
      seo: {
        title: 'Inscription — Club Démo (École de foot U6-U9)',
        description: 'Inscrivez votre enfant au Club Démo (U6-U9) : générez votre dossier d\'inscription et réglez l\'adhésion en ligne. Pass\'Sport accepté (50 € de réduction).',
        canonical: true,
        ogTitle: 'Inscription — Club Démo',
        ogDescription: 'Inscrivez votre enfant au Club Démo (U6-U9) : générez votre dossier d\'inscription et réglez l\'adhésion en ligne.',
      },
      scripts: [
        'assets/js/main.js',
        'assets/js/pdf-inscription.js',
        'assets/js/inscription.js',
        'assets/js/adresse-autocomplete.js',
        'assets/js/naissance-autocomplete.js',
      ],
      sections: [
        {
          type: 'page_header',
          id: 'inscription.header',
          eyebrow: 'Rejoignez le club',
          title: 'Inscrire mon enfant',
          action: { href: '#formulaire', label: 'Remplir le formulaire' },
          lead: [
            'Saison ',
            { hook: { attr: 'data-saison-text', children: ['2026-2027'] } },
            ' : trois étapes pour préparer le dossier de votre enfant, puis vous le finalisez depuis votre espace famille.',
          ],
        },
        ...inscription,
      ],
    },
    {
      id: 'pre-inscription-u10',
      route: '/pre-inscription-u10',
      file: 'pre-inscription-u10.html',
      seo: {
        title: 'Pré-inscription U10 — Club Démo',
        description: 'Votre enfant est né en 2017 ? Pré-inscrivez-le au futur groupe U10 du Club Démo : gratuit, sans engagement, 15 places.',
        canonical: true,
        ogTitle: 'Pré-inscription U10 — Club Démo',
        ogDescription: 'Futur groupe U10 (enfants nés en 2017) : pré-inscription gratuite et sans engagement, 15 places.',
      },
      scripts: ['assets/js/main.js', 'assets/js/preinscription.js', 'assets/js/naissance-autocomplete.js'],
      sections: [
        {
          type: 'page_header',
          id: 'pre-inscription-u10.header',
          eyebrow: 'Nouveau groupe en projet',
          title: 'Pré-inscription U10',
          lead: ['Votre enfant est né en 2017 ? Le club prépare un groupe U10 : pré-inscrivez-le pour nous aider à l\'ouvrir.'],
        },
        ...preinscription,
      ],
    },
    {
      id: 'contact',
      route: '/contact',
      file: 'contact.html',
      seo: {
        title: 'Contact — Club Démo (École de foot U6-U9)',
        description: 'Contactez le Club Démo pour devenir bénévole, partenaire, ou toute autre question.',
        canonical: true,
        ogTitle: 'Contact — Club Démo',
        ogDescription: 'Contactez le Club Démo pour devenir bénévole, partenaire, ou toute autre question.',
      },
      scripts: ['assets/js/main.js', 'assets/js/contact.js'],
      sections: [
        {
          type: 'page_header',
          id: 'contact.header',
          eyebrow: 'On vous répond vite',
          title: 'Contact',
          lead: [
            'Une question, une envie de devenir bénévole ou partenaire ? Écrivez-nous. Pour inscrire votre enfant, direction la ',
            { link: { href: '/inscription', variant: 'inherit-underline', children: ['page Inscription'] } },
            '.',
          ],
        },
        ...contact,
      ],
    },
    {
      id: 'partenaires',
      route: '/partenaires',
      file: 'partenaires.html',
      seo: {
        title: 'Devenez Partenaire — Club Démo (Sponsoring)',
        description: 'Soutenez le Club Démo : devenez partenaire ou sponsor de ce nouveau club de football loisir à Sportville (Club de démonstration). Maillots, matériel, terrain — chaque contribution compte.',
        canonical: true,
        ogTitle: 'Devenez Partenaire — Club Démo',
        ogDescription: 'Soutenez le Club Démo : maillots, matériel, terrain — chaque contribution compte pour cette première saison.',
      },
      scripts: ['assets/js/main.js'],
      sections: [
        {
          type: 'page_header',
          id: 'partenaires.header',
          eyebrow: 'Dossier de sponsoring',
          title: 'Construisons le club ensemble',
          lead: [
            'Un nouveau club, une immense ambition. Rejoignez l\'aventure Club Démo dès sa première saison et associez votre nom à un projet sportif et humain qui démarre.',
          ],
        },
        ...partenaires,
      ],
    },
    {
      id: 'mentions-legales',
      route: '/mentions-legales',
      file: 'mentions-legales.html',
      seo: {
        title: 'Mentions légales — Club Démo',
        description: 'Mentions légales du site du Club Démo : éditeur, hébergement, propriété intellectuelle.',
        canonical: true,
        ogTitle: 'Mentions légales — Club Démo',
        ogDescription: 'Mentions légales du site du Club Démo : éditeur, hébergement, propriété intellectuelle.',
      },
      scripts: ['assets/js/main.js'],
      sections: [
        {
          type: 'page_header',
          id: 'mentions-legales.header',
          eyebrow: 'Informations légales',
          title: 'Mentions légales',
          lead: ['Éditeur du site, hébergement et propriété intellectuelle.'],
        },
        ...mentionsSections,
      ],
    },
    {
      id: 'confidentialite',
      route: '/confidentialite',
      file: 'confidentialite.html',
      seo: {
        title: 'Politique de confidentialité — Club Démo',
        description: 'Comment le Club Démo collecte, utilise et protège les données transmises via le site (formulaire d\'inscription et de contact).',
        canonical: true,
        ogTitle: 'Politique de confidentialité — Club Démo',
        ogDescription: 'Comment le Club Démo collecte, utilise et protège les données transmises via le site.',
      },
      scripts: ['assets/js/main.js'],
      sections: [
        {
          type: 'page_header',
          id: 'confidentialite.header',
          eyebrow: 'Vos données',
          title: 'Politique de confidentialité',
          lead: ['Comment nous collectons, utilisons et protégeons vos informations.'],
        },
        ...privacySections,
      ],
    },
    {
      id: 'introuvable',
      route: '/404',
      file: '404.html',
      seo: { title: 'Page introuvable — Club Démo', robots: 'noindex, follow' },
      footer: 'minimal',
      mainLeadingBlankLine: false,
      sections: [
        {
          type: 'page_header',
          id: 'introuvable.header',
          eyebrow: 'Erreur 404',
          title: 'Page introuvable',
          lead: ['Cette page n\'existe pas ou plus. Retournez à l\'accueil ou consultez nos autres pages.'],
        },
        ...notFoundSections,
      ],
    },
  ],
};
