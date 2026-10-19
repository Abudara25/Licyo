// Contenus réutilisés par plusieurs pages du site.
export const EMAIL = 'contact@clubdemo.licyo.fr';

// Adresse e-mail publique liée à la donnée vivante de l'organisation.
export const orgEmail = { link: { href: `mailto:${EMAIL}`, bind: [['data-org', 'org.email'], ['data-org-attr', 'href:org.mailto']], children: [EMAIL] } };

// Partenaires actuels du club (logos en version claire, affichés sur fond bordeaux).
export const partners = [
  { name: 'Sportéquip', role: 'Équipementier du club', logo: { src: 'assets/images/partenaires/equipementier.webp', width: 640, height: 86 } },
];

export const joinUsBanner = {
  type: 'cta_banner',
  title: 'Envie de nous rejoindre ?',
  text: ['Votre enfant, un talent de bénévole ou une envie de nous soutenir : il y a une place pour vous au Club Démo.'],
  actions: [{ href: '/contact', label: 'Nous contacter' }],
};

export const mapLabels = {
  show: 'Afficher la carte ici',
  open: 'Ouvrir dans Google Maps',
  note: 'Afficher la carte ici charge Google Maps, qui dépose des cookies.',
};

// Futur groupe U10 (pré-inscription, page /pre-inscription-u10) : bandeau repris sur l'accueil et la page Inscription.
export const u10Banner = {
  type: 'cta_banner',
  title: 'Nouveau : futur groupe U10',
  text: ["Votre enfant est né en 2017 ? Pré-inscrivez-le, gratuitement et sans engagement : le groupe ouvrira dès qu'il y aura assez d'enfants (15 places)."],
  actions: [{ href: '/pre-inscription-u10', label: 'Pré-inscrire mon enfant' }],
};
