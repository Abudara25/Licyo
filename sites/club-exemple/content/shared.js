// Contenus réutilisés par plusieurs pages du site.
export const EMAIL = 'contact@club-exemple.example';

// Adresse e-mail publique liée à la donnée vivante de l'organisation.
export const orgEmail = { link: { href: `mailto:${EMAIL}`, bind: [['data-org', 'org.email'], ['data-org-attr', 'href:org.mailto']], children: [EMAIL] } };

// Partenaires actuels du club (logos en version claire, affichés sur fond bordeaux).
export const partners = [
  { name: 'Équipementier Exemple', role: 'Équipementier du club', logo: { src: 'assets/images/partenaires/exemple.webp', width: 640, height: 86 } },
];

export const joinUsBanner = {
  type: 'cta_banner',
  title: 'Envie de nous rejoindre ?',
  text: ['Votre enfant, un talent de bénévole ou une envie de nous soutenir : il y a une place pour vous au Club Exemple.'],
  actions: [{ href: '/contact', label: 'Nous contacter' }],
};

export const mapLabels = {
  show: 'Afficher la carte ici',
  open: 'Ouvrir dans Google Maps',
  note: 'Afficher la carte ici charge Google Maps, qui dépose des cookies.',
};
