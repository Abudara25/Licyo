// Actualités (liste remplie par assets/js/actualites.js) et page introuvable.
export const sections = [
  {
    type: 'content',
    id: 'actualites.liste',
    background: 'surface',
    blocks: [
      {
        type: 'news_feed',
        variant: 'full',
        empty: {
          eyebrow: 'Bientôt disponible',
          title: ['Les actualités arrivent'],
          text: ['Le club vient de se lancer : les premières actus (inscriptions, entraînements, vie du club) seront publiées ici très prochainement.'],
        },
        filters: [
          { key: 'all', label: 'Toutes' },
          { key: 'club', label: 'Club' },
          { key: 'inscriptions', label: 'Inscriptions' },
          { key: 'benevolat', label: 'Bénévolat' },
          { key: 'evenement', label: 'Événements' },
          { key: 'partenariat', label: 'Partenaires' },
        ],
      },
    ],
  },
];

export const notFoundSections = [
  {
    type: 'content',
    id: 'introuvable.retour',
    background: 'surface',
    textAlign: 'center',
    blocks: [{ type: 'button', href: '/', label: "Retour à l'accueil", style: 'primary' }],
  },
];
