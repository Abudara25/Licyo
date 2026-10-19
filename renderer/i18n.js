// Libellés d'interface du moteur (accessibilité, navigation), par langue. Le contenu éditorial, lui, vient de
// la configuration du site. Seul le français existe pour l'instant ; une langue inconnue est refusée.
const STRINGS = {
  'fr-FR': {
    htmlLang: 'fr',
    skipLink: 'Aller au contenu',
    mainNav: 'Navigation principale',
    openMenu: 'Ouvrir le menu',
    close: 'Fermer',
    contactSentTitle: 'Message envoyé',
    contactSentText: 'Merci, nous vous répondrons par e-mail.',
  },
};

export function strings(locale) {
  const table = STRINGS[locale];
  if (!table) throw new Error(`Langue non prise en charge : ${locale}`);
  return table;
}
