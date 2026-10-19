// Second site FICTIF, réservé aux tests unitaires du moteur de site (phases 4D.1 et 4D.2A). Il n'est ni publié,
// ni inscrit en base, ni rattaché à un domaine, ni enregistré dans sites/index.js : il sert à prouver que le
// moteur ne dépend d'aucune valeur propre à Sportville. Sections structurées uniquement, aucun HTML.
export const exempleSite = {
  schemaVersion: 2,
  id: 'atelier-exemple',
  organizationId: 'org_test_exemple',
  locale: 'fr-FR',
  theme: {
    id: 'dynamic_diagonal',
    version: 1,
    palette: 'exemple',
    stylesheet: 'assets/css/styles.css',
    preloadFonts: ['assets/fonts/inter.woff2'],
  },
  brand: {
    name: 'Atelier Exemple',
    shortName: 'AEX',
    tagline: 'Quartier des Tilleuls',
    logo: { small: 'assets/images/exemple/logo-96.webp', large: 'assets/images/exemple/logo.webp', alt: "Logo de l'Atelier Exemple" },
    favicon: 'assets/images/exemple/favicon.ico',
    appleTouchIcon: 'assets/images/exemple/apple-touch-icon.png',
    manifest: 'manifest.json',
    themeColor: '#123456',
  },
  seo: {
    siteUrl: 'https://atelier.example',
    robots: 'index, follow',
    ogLocale: 'fr_FR',
    twitterCard: 'summary',
    ogImage: { url: 'https://atelier.example/assets/images/exemple/partage.jpg', width: 1200, height: 630 },
  },
  contact: {
    location: {
      short: 'Salle des Tilleuls',
      href: '/infos',
      name: 'Salle des Tilleuls',
      address: '3 allée des Tilleuls, 00000 Exempleville',
      embedUrl: 'https://www.openstreetmap.org/export/embed.html?bbox=2.29,48.85,2.30,48.86',
      mapsUrl: 'https://www.openstreetmap.org/?mlat=48.855&mlon=2.295',
      mapTitle: 'Carte — Salle des Tilleuls',
    },
    email: 'bonjour@atelier.example',
    phone: { display: '01 02 03 04 05', tel: '+33102030405' },
  },
  navigation: {
    items: [
      { label: 'Accueil', href: '/' },
      { label: 'Ateliers', href: '/ateliers' },
      { label: 'Infos', href: '/infos' },
    ],
    cta: { label: 'Réserver', href: '/reserver' },
  },
  social: [{ network: 'instagram', href: 'https://www.instagram.com/atelier.exemple' }],
  footer: {
    about: ['Ateliers de poterie pour tous les âges.'],
    navigationTitle: 'Plan du site',
    practical: { title: 'Nous trouver', items: ['location', 'email', 'phone'] },
    bottom: [
      { content: ['© 2026 Atelier Exemple'], minimal: true },
      { content: [{ link: { href: '/mentions', children: ['Mentions'] } }], minimal: true },
    ],
  },
  news: {
    route: '/journal',
    breadcrumbIndexPath: '/journal',
    homeLabel: 'Accueil',
    indexLabel: 'Journal',
    backLabel: 'Retour au journal',
    defaultCategory: 'vie',
    categories: { vie: { label: "Vie de l'atelier", icon: 'heart' } },
    scripts: ['assets/js/main.js'],
  },
  notFoundPage: 'introuvable',
  pages: [
    {
      id: 'accueil',
      route: '/',
      file: 'index.html',
      seo: { title: 'Atelier Exemple — Poterie', description: 'Ateliers de poterie.', canonical: true, ogTitle: 'Atelier Exemple', ogDescription: 'Ateliers de poterie.' },
      scripts: ['assets/js/main.js'],
      sections: [
        {
          type: 'hero',
          id: 'accueil.hero',
          eyebrow: 'Depuis 2019',
          title: ['Façonner ', { em: ['ensemble'] }],
          lead: ['Des ateliers ouverts à tous.'],
          actions: [
            { label: 'Réserver un atelier', href: '/reserver', style: 'primary' },
            { label: 'Nous écrire', href: 'mailto:bonjour@atelier.example', style: 'outline' },
          ],
          emblem: { src: 'assets/images/exemple/logo.webp', alt: "Logo de l'Atelier Exemple", width: 320, height: 320 },
          stats: [{ value: { content: ['12'] }, label: { content: ['places par atelier'] } }],
        },
        {
          type: 'content',
          id: 'accueil.presentation',
          comment: 'Présentation',
          background: 'cream',
          layout: 'split',
          align: 'center',
          columns: [
            {
              type: 'group',
              children: [
                { type: 'heading', layout: 'none', eyebrow: "L'atelier", title: ['La terre, à plusieurs'], sub: ['Un lieu associatif pour apprendre le tour et le modelage.'] },
                { type: 'text', variant: 'muted', content: ['Toutes les terres et outils sont fournis.'] },
                { type: 'button', href: '/ateliers', label: 'Voir les ateliers', style: 'primary', placement: 'spaced' },
              ],
            },
            {
              type: 'cards',
              reveal: 'grid',
              items: [
                { title: ['Tour'], text: ['Centrage, tournage, tournassage.'] },
                { title: ['Modelage'], text: ['Colombins, plaques, estampage.'] },
              ],
            },
          ],
        },
        {
          type: 'content',
          id: 'accueil.cta',
          background: 'surface',
          tight: true,
          blocks: [{ type: 'cta_banner', title: 'Envie d’essayer ?', text: ['Première séance offerte.'], actions: [{ href: '/reserver', label: 'Réserver' }] }],
        },
      ],
    },
    {
      id: 'ateliers',
      route: '/ateliers',
      file: 'ateliers.html',
      seo: { title: 'Ateliers — Atelier Exemple', canonical: true, ogTitle: 'Ateliers', ogDescription: 'Nos ateliers.' },
      sections: [
        { type: 'page_header', id: 'ateliers.header', eyebrow: 'Programme', title: 'Nos ateliers', lead: ['Tour, modelage et émaillage.'] },
        {
          type: 'content',
          id: 'ateliers.horaires',
          background: 'surface',
          blocks: [
            { type: 'heading', layout: 'start', eyebrow: 'Cette année', title: ['Horaires'] },
            {
              type: 'info_list',
              width: 'narrow',
              reveal: true,
              items: [
                { icon: 'clock', title: ['Mardi, 18h – 20h'], text: ['Tour, niveau débutant.'] },
                { icon: 'clock', title: ['Samedi, 10h – 12h'], text: ['Modelage, tous niveaux.'] },
              ],
            },
            { type: 'callout', variant: 'note', content: [{ strong: { variant: 'accent', children: ['Places limitées.'] } }, { br: true }, 'Inscription au trimestre.'] },
          ],
        },
        {
          type: 'content',
          id: 'ateliers.faq',
          background: 'cream',
          blocks: [
            { type: 'heading', eyebrow: 'Questions', title: ['Avant de venir'] },
            {
              type: 'faq',
              items: [
                { question: 'Faut-il savoir dessiner ?', answer: ['Non, aucun prérequis.'] },
                { question: 'Que faut-il apporter ?', answer: ['Une tenue qui ne craint pas la terre.'] },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'infos',
      route: '/infos',
      file: 'infos.html',
      seo: { title: 'Infos — Atelier Exemple' },
      sections: [
        { type: 'page_header', id: 'infos.header', eyebrow: 'Infos', title: 'Nous trouver', lead: ['Adresse, contact et plan.'] },
        {
          type: 'content',
          id: 'infos.contact',
          background: 'surface',
          layout: 'split',
          align: 'start',
          columns: [
            {
              type: 'group',
              children: [
                { type: 'heading', layout: 'none', eyebrow: 'Écrire', title: ['Un message'] },
                {
                  type: 'contact_form',
                  subjectLine: 'Message — Atelier Exemple',
                  name: { label: 'Nom', placeholder: 'Votre nom' },
                  email: { label: 'E-mail', placeholder: 'vous@exemple.fr' },
                  subject: { label: 'Objet', options: ['Réservation', 'Autre'] },
                  message: { label: 'Message', placeholder: 'Votre message' },
                  consent: ["J'accepte d'être recontacté."],
                  submit: 'Envoyer',
                },
              ],
            },
            {
              type: 'group',
              children: [
                {
                  type: 'info_list',
                  items: [
                    { icon: 'pin', title: ['Salle des Tilleuls'], text: ['3 allée des Tilleuls'] },
                    { icon: 'mail', title: ['E-mail'], text: [{ link: { href: 'mailto:bonjour@atelier.example', children: ['bonjour@atelier.example'] } }] },
                  ],
                },
                { type: 'map', labels: { show: 'Afficher le plan', open: 'Ouvrir le plan', note: 'Le plan est chargé depuis OpenStreetMap.' } },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'introuvable',
      route: '/404',
      file: '404.html',
      seo: { title: 'Page introuvable — Atelier Exemple', robots: 'noindex' },
      footer: 'minimal',
      sections: [
        { type: 'page_header', id: 'introuvable.header', eyebrow: 'Erreur 404', title: 'Page introuvable', lead: [{ link: { href: '/', children: ["Retour à l'accueil"] } }] },
      ],
    },
  ],
};

export const EXEMPLE_ASSET_VERSIONS = { 'assets/css/styles.css': 'aaaaaaaaaa', 'assets/js/main.js': 'bbbbbbbbbb' };
