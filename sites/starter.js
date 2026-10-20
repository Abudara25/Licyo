// Site de départ d'un nouveau club (2026-10-20) : à partir d'un « profil » simple (nom, sport, ville, coordonnées,
// textes d'accueil, couleurs), construit une configuration de site complète (SiteConfig, schemaVersion 2) que le moteur
// sait rendre. Le profil est conservé dans la configuration (clé `starter`) : l'éditeur de site de l'admin
// (/admin/site) modifie le profil et reconstruit les pages, sans que le club ait à connaître la structure du moteur.
//
// Données pures, aucun accès réseau ni base. Les données vivantes (groupes, créneaux, lieu, tarif, coordonnées) restent
// en base et sont injectées à l'exécution dans les éléments liés (data-org-*), comme pour le club de démo.
import { org, orgIf, orgList, link, linkVariant, strong, bind, hook } from './segments.js';
import { paletteThemeColor } from '../renderer/palette.js';
import { sections as demoInscription } from './club-demo/content/inscription.js';

export const STARTER_VERSION = 1;

// Champs du profil modifiables par le club (texte simple ; `about` : paragraphes séparés par une ligne vide).
export const STARTER_FIELDS = Object.freeze({
  name: { label: 'Nom du club', max: 80, required: true },
  sportLabel: { label: 'Sport', max: 40, required: true },
  city: { label: 'Ville', max: 60, required: true },
  tagline: { label: 'Accroche (sous le nom)', max: 80 },
  audience: { label: 'Public accueilli (ex. « enfants de 6 à 12 ans »)', max: 80 },
  heroTitle: { label: 'Titre de la page d’accueil', max: 90 },
  heroLead: { label: 'Texte d’introduction', max: 300 },
  about: { label: 'Présentation du club (page Le club)', max: 3000, multiline: true },
  values: { label: 'Valeurs (une par ligne, « Titre : texte »)', max: 900, multiline: true },
  email: { label: 'E-mail public', max: 120 },
  phone: { label: 'Téléphone public', max: 30 },
  venueName: { label: 'Lieu des séances (nom)', max: 80 },
  venueAddress: { label: 'Adresse du lieu', max: 160 },
  legalAddress: { label: 'Adresse du siège (mentions légales)', max: 160 },
  rna: { label: 'Numéro RNA (W + 9 chiffres)', max: 20 },
  facebook: { label: 'Page Facebook (lien https)', max: 200 },
  instagram: { label: 'Compte Instagram (lien https)', max: 200 },
});

const trim = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

// Profil nettoyé (valeurs par défaut pour les champs vides).
export function normalizeProfile(input = {}) {
  const p = {};
  for (const [key, def] of Object.entries(STARTER_FIELDS)) {
    p[key] = def.multiline ? trim(String(input[key] ?? '').replace(/\r\n?/g, '\n'), def.max).replace(/\n{3,}/g, '\n\n') : trim(String(input[key] ?? '').replace(/\s+/g, ' '), def.max);
  }
  p.name ||= 'Mon club';
  p.sportLabel ||= 'Sport';
  p.city ||= 'Ma ville';
  p.tagline ||= `Club de ${p.sportLabel.toLowerCase()} à ${p.city}`;
  p.audience ||= 'Enfants et adultes, tous niveaux';
  p.heroTitle ||= `Bienvenue au ${p.name}`;
  p.heroLead ||= `Le ${p.sportLabel.toLowerCase()} à ${p.city}, pour progresser et se faire plaisir, dans un esprit familial.`;
  p.about ||= `Le ${p.name} est une association sportive de ${p.city}. Nos encadrants accueillent chacun à son niveau, pour apprendre, progresser et partager les valeurs du sport.\n\nLes inscriptions se font en ligne : le dossier se prépare en quelques minutes, puis se complète depuis l’espace famille.`;
  p.values ||= 'Plaisir : apprendre en s’amusant, à son rythme.\nRespect : des partenaires, des adversaires et des encadrants.\nProgrès : chacun progresse, quel que soit son niveau de départ.';
  p.venueName ||= 'Lieu des séances';
  p.venueAddress ||= p.city;
  for (const key of ['facebook', 'instagram']) if (!/^https:\/\/[^\s"'<>]+$/.test(p[key])) p[key] = '';
  if (p.rna && !/^W\d{9}$/i.test(p.rna)) p.rna = '';
  const colors = input.colors && typeof input.colors === 'object' ? input.colors : {};
  p.colors = {
    primary: /^#[0-9a-f]{6}$/i.test(colors.primary || '') ? colors.primary.toLowerCase() : '#1f4e79',
    accent: /^#[0-9a-f]{6}$/i.test(colors.accent || '') ? colors.accent.toLowerCase() : '#f2a900',
  };
  return p;
}

const shortNameOf = (name) => {
  const words = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w && !['DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'ET', 'D', 'L'].includes(w));
  return (words.length > 1 ? words.map((w) => w[0]).join('') : words[0] || 'CLUB').slice(0, 8);
};
const paragraphs = (text) => text.split(/\n\s*\n/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);
const valueCards = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => {
      const [title, ...rest] = line.split(/\s*:\s*/);
      return { title: [title.slice(0, 60) || 'Valeur'], text: [rest.join(' : ') || title] };
    });
const mapsQuery = (p) => encodeURIComponent(`${p.venueName} ${p.venueAddress}`);

// E-mail et téléphone publics liés aux données vivantes de l'organisation (valeur de secours : le profil).
const emailSegment = (p) => (p.email ? { link: { href: `mailto:${p.email}`, bind: [['data-org', 'org.email'], ['data-org-attr', 'href:org.mailto']], children: [p.email] } } : bind('span', [['data-org', 'org.email']], 'notre adresse e-mail'));
const telOf = (phone) => {
  const digits = phone.replace(/[^\d+]/g, '');
  return digits.startsWith('0') ? `+33${digits.slice(1)}` : digits;
};

function registrationSection(p) {
  const demo = demoInscription.find((s) => s.type === 'registration');
  const section = structuredClone(demo);
  const t = section.texts;
  const mail = emailSegment(p);
  section.id = 'inscription.formulaire';
  // Valeur de secours : remplacée dans le navigateur par les catégories actives du club (/api/categories).
  section.groupOptions = [{ value: 'Catégorie', label: 'Choisir une catégorie' }];
  section.sizes = [];
  section.asideItems = [
    { content: [p.audience] },
    { bind: [['data-org-if', 'schedule.any']], content: ['Séances ', orgList('slots-sentence', 'selon le planning du club'), orgIf('location.name', ', ', org('location.name', p.venueName))] },
    { content: ['Séance d’essai possible avant de s’inscrire'] },
    { content: ['Paiement en ligne, ou au club par carte bancaire, espèces ou chèque'] },
  ];
  t.intro = ['Environ 3 minutes. Le dossier se complète ensuite depuis votre espace famille.'];
  t.ageWarning = ['Cette date de naissance ne correspond à aucune catégorie ouverte cette saison. Vérifiez la date ou écrivez-nous à ', mail, '.'];
  t.duplicateWarning = ['Une inscription semble déjà exister pour ce nom avec cette adresse e-mail. Consultez vos e-mails ou écrivez-nous à ', mail, '.'];
  t.consentParticipation = [`J'autorise la participation aux séances et activités du ${p.name}.`];
  t.notes = [
    ['Un questionnaire de santé (ou certificat médical) pourra vous être demandé avant le début de la saison.'],
    [strong('Important :'), " l'inscription n'est définitive qu'une fois l'adhésion réglée et la licence enregistrée par le club auprès de la fédération."],
  ];
  t.duplicate.text = ["Une inscription existe déjà pour cette personne avec cette adresse e-mail. Le lien de votre espace famille vient d'être renvoyé à l'adresse enregistrée : pensez à vérifier les spams. Besoin d'aide ? ", mail];
  t.nextSteps.emailHint = ['Le lien vous est aussi envoyé par e-mail. Si vous ne le trouvez pas, regardez dans vos courriers indésirables.'];
  t.aside.help = ['Une question ? ', mail, { br: true }, link('/contact', 'Nous contacter')];
  // Tarif et saison : valeurs vivantes du club (page-data.js) ; secours neutres tant qu'elles ne sont pas réglées.
  t.aside.kicker = ['Adhésion saison ', hook('data-saison-text', ['en cours'])];
  t.aside.price = [hook('data-prix-text', ['Tarif'], [['data-org', 'price.seasonAmount']]), bind('span', [['data-org-if', 'price.seasonAmount']], '\u00a0€')];
  t.aside.priceSub = ['Paiement en ligne ou au club'];
  t.closed.text = ['Les inscriptions ne sont pas ouvertes actuellement. Contactez-nous pour être informé(e) dès leur ouverture.'];
  t.aside.noteStrong = `Bienvenue au ${p.name} !`;
  t.aside.note = 'Nous avons hâte de vous retrouver sur le terrain.';
  return section;
}

const legalArticles = (id, items) => [{ type: 'content', id, background: 'surface', width: 'narrow', blocks: [{ type: 'articles', items }] }];

function mentions(p) {
  const mail = emailSegment(p);
  return legalArticles('mentions-legales.articles', [
    {
      eyebrow: 'Éditeur du site',
      title: 'Qui édite ce site',
      paragraphs: [
        ['Ce site est édité par le ', strong(p.name), `, association loi 1901${p.legalAddress ? `, dont le siège social se situe ${p.legalAddress}` : ` (${p.city})`}.`],
        ...(p.rna ? [[`Numéro RNA : ${p.rna.toUpperCase()}.`]] : []),
        [`Directeur de la publication : le président du ${p.name}.`],
        ['Contact : ', mail],
      ],
    },
    { eyebrow: 'Hébergement', title: 'Hébergeur', paragraphs: [['Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, États-Unis.'], ['Plateforme : Licyo.']] },
    { eyebrow: 'Contenu', title: 'Propriété intellectuelle', paragraphs: [[`Les textes, le logo et les éléments graphiques de ce site appartiennent au ${p.name}, sauf mention contraire. Toute reproduction sans autorisation est interdite.`]] },
    { eyebrow: 'Responsabilité', title: 'Limitation de responsabilité', paragraphs: [[`Le ${p.name} s'efforce de publier des informations exactes, sans garantie de disponibilité continue ou d'absence d'erreur. Pour toute question : `, mail, '.']] },
  ]);
}

function privacy(p) {
  const mail = emailSegment(p);
  return legalArticles('confidentialite.articles', [
    { eyebrow: 'Responsable', title: 'Qui est responsable de vos données', paragraphs: [[`Le ${p.name}, association loi 1901${p.legalAddress ? ` (siège : ${p.legalAddress})` : ''}, est responsable des données collectées via ce site. Contact : `, mail, '.']] },
    {
      eyebrow: 'Données',
      title: 'Ce que nous collectons et pourquoi',
      paragraphs: [
        [strong('Formulaire d’inscription'), " : identité et date de naissance de l'adhérent, coordonnées des responsables légaux, autorisations, dossier signé et photo déposés depuis l'espace famille. Finalité : gérer l'adhésion et la licence (base légale : exécution du contrat d'adhésion ; autorisations de droit à l'image : consentement)."],
        [strong('Formulaire de contact'), ' : nom, e-mail et message, pour vous répondre (base légale : intérêt légitime). Le message est transmis par e-mail au club et n’est pas conservé sur le site.'],
        [strong('Paiement'), ' : les paiements en ligne sont traités par HelloAsso, qui nous transmet le nom et l’e-mail du payeur et le nom de l’adhérent.'],
      ],
    },
    {
      eyebrow: 'Stockage',
      title: 'Où sont vos données',
      paragraphs: [
        ["Les données sont hébergées par Cloudflare dans l'Union européenne (base de données et fichiers), sur la plateforme Licyo. Les e-mails sont envoyés par notre messagerie ou par Brevo (France). Seuls les responsables du club disposant d'un compte personnel y ont accès."],
      ],
    },
    { eyebrow: 'Durée', title: 'Combien de temps', paragraphs: [['Les dossiers sont conservés pendant la saison et au plus 3 ans après sa fin, puis supprimés par le club. Les liens personnels de l’espace famille expirent au bout de 30 jours.']] },
    { eyebrow: 'Vos droits', title: 'Accès, rectification, suppression', paragraphs: [['Vous pouvez accéder à vos données, les faire corriger ou supprimer, et retirer un consentement à tout moment en écrivant à ', mail, ". Vous pouvez aussi saisir la CNIL (cnil.fr)."]] },
    { eyebrow: 'Cookies', title: 'Cookies', paragraphs: [['Ce site ne dépose aucun cookie publicitaire ni de mesure d’audience. Seuls des cookies techniques peuvent être déposés (protection anti-robots de Cloudflare, connexion à l’espace admin), exemptés de consentement.']] },
  ]);
}

// Configuration complète. `organizationId`, `slug` et `siteUrl` viennent du serveur (jamais du formulaire).
export function buildStarterSite({ organizationId, slug, siteUrl, profile }) {
  const p = normalizeProfile(profile);
  const name = p.name;
  const mail = emailSegment(p);
  const lower = p.sportLabel.toLowerCase();
  const seo = (title, description) => ({ title: `${title} | ${name}`, description, canonical: true, ogTitle: `${title} | ${name}`, ogDescription: description });
  const social = [
    ...(p.facebook ? [{ network: 'facebook', href: p.facebook }] : []),
    ...(p.instagram ? [{ network: 'instagram', href: p.instagram }] : []),
  ];
  return {
    schemaVersion: 2,
    id: slug,
    organizationId,
    locale: 'fr-FR',
    starter: { version: STARTER_VERSION, ...p },
    theme: {
      id: 'dynamic_diagonal',
      version: 1,
      palette: 'club-demo',
      stylesheet: 'assets/css/styles.css',
      preloadFonts: ['assets/fonts/inter.woff2', 'assets/fonts/oswald.woff2'],
      colors: p.colors,
    },
    brand: {
      name,
      shortName: shortNameOf(name),
      tagline: p.tagline,
      logo: { small: 'assets/images/club/logo-96.webp', large: 'assets/images/club/logo.webp', alt: `Logo du ${name}` },
      favicon: 'assets/images/club/favicon.ico',
      appleTouchIcon: 'assets/images/club/apple-touch-icon.png',
      manifest: 'manifest.json',
      themeColor: paletteThemeColor(p.colors) || '#1b2b3a',
    },
    seo: {
      siteUrl,
      robots: 'index, follow',
      ogLocale: 'fr_FR',
      twitterCard: 'summary_large_image',
      ogImage: { url: `${siteUrl}/assets/images/club/og-image.jpg`, width: 1200, height: 630 },
    },
    contact: {
      location: {
        short: `${p.venueName}, ${p.city}`,
        href: '/contact',
        name: p.venueName,
        address: p.venueAddress,
        embedUrl: `https://www.google.com/maps?q=${mapsQuery(p)}&output=embed`,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${mapsQuery(p)}`,
        mapTitle: `Carte : ${p.venueName}, ${p.city}`,
      },
      email: p.email || `contact@${new URL(siteUrl).hostname}`,
      phone: { display: p.phone || '', tel: p.phone ? telOf(p.phone) : '' },
    },
    navigation: {
      items: [
        { label: 'Accueil', href: '/' },
        { label: 'Le club', href: '/le-club' },
        { label: 'Actualités', href: '/actualites' },
        { label: 'Contact', href: '/contact' },
      ],
      cta: { label: 'Inscription', href: '/inscription', statusHook: true },
    },
    social,
    footer: {
      about: [`${name} : ${lower} à ${p.city}. ${p.audience}.`],
      navigationTitle: 'Navigation',
      practical: { title: 'Infos pratiques', items: p.phone ? ['location', 'email', 'phone'] : ['location', 'email'] },
      bottom: [
        { content: [`© ${new Date().getUTCFullYear()} ${name}. Tous droits réservés.`], minimal: true },
        { content: [link('/mentions-legales', 'Mentions légales'), ' · ', link('/confidentialite', 'Confidentialité')], minimal: true },
        { content: ['Site propulsé par ', linkVariant('external-nofollow', 'https://licyo.fr', 'Licyo')], minimal: true },
      ],
    },
    news: {
      route: '/actualites',
      breadcrumbIndexPath: '/actualites',
      homeLabel: 'Accueil',
      indexLabel: 'Actualités',
      backLabel: 'Retour aux actualités',
      defaultCategory: 'club',
      categories: {
        club: { label: 'Club', icon: 'shield-check' },
        inscriptions: { label: 'Inscriptions', icon: 'clipboard' },
        evenement: { label: 'Événement', icon: 'calendar-star' },
      },
      scripts: ['assets/js/main.js'],
    },
    notFoundPage: 'introuvable',
    pages: [
      {
        id: 'accueil',
        route: '/',
        seo: seo(p.sportLabel, `${name} : ${lower} à ${p.city}. ${p.audience}. Inscriptions en ligne.`),
        scripts: ['assets/js/main.js', 'assets/js/actualites.js'],
        sections: [
          {
            type: 'hero',
            id: 'accueil.hero',
            eyebrow: p.tagline,
            title: [p.heroTitle],
            lead: [p.heroLead],
            actions: [
              { href: '/inscription', label: 'Inscription', style: 'primary', statusHook: true },
              { href: '/contact', label: 'Nous contacter', style: 'outline' },
            ],
            emblem: { src: 'assets/images/club/logo.webp', alt: `Logo du ${name}`, width: 360, height: 360, fetchpriority: 'high' },
            stats: [
              { value: { content: [p.sportLabel] }, label: { content: [p.city] } },
              {
                bind: [['data-org-if', 'schedule.any']],
                value: { bind: [['data-org-list', 'slots-compact']], content: ['Séances'] },
                label: { bind: [['data-org', 'location.name'], ['data-org-if', 'location.name']], content: [p.venueName] },
              },
              { bind: [['data-org-if', 'price.season']], value: { bind: [['data-org', 'price.season']], content: ['Adhésion'] }, label: { content: ['La saison'] } },
              { value: { content: ['Essai'] }, label: { content: ['Avant de s’inscrire'] } },
            ],
          },
          {
            type: 'content',
            id: 'accueil.valeurs',
            background: 'surface',
            blocks: [
              { type: 'heading', reveal: true, eyebrow: 'Notre club', title: ['Ce qui nous anime'], sub: [p.audience] },
              { type: 'cards', columns: 3, reveal: 'items', items: valueCards(p.values) },
            ],
          },
          {
            type: 'content',
            id: 'accueil.actualites',
            background: 'cream',
            blocks: [
              { type: 'heading', reveal: true, eyebrow: 'Vie du club', title: ['Actualités'], sub: [`Les dernières nouvelles du ${name}.`] },
              {
                type: 'news_feed',
                variant: 'teaser',
                empty: { text: ['Les premières actualités seront publiées ici très prochainement.'], link: { href: '/actualites', label: 'Voir la page actualités' } },
                limit: 3,
                more: { href: '/actualites', label: 'Voir toutes les actualités' },
              },
            ],
          },
          {
            type: 'content',
            id: 'accueil.rejoindre',
            background: 'surface',
            tight: true,
            blocks: [
              {
                type: 'cta_banner',
                title: 'Envie de nous rejoindre ?',
                text: [`Inscription en ligne, séance d’essai, bénévolat : il y a une place pour vous au ${name}.`],
                actions: [{ href: '/inscription', label: 'S’inscrire' }, { href: '/contact', label: 'Nous contacter' }],
              },
            ],
          },
        ],
      },
      {
        id: 'le-club',
        route: '/le-club',
        seo: seo('Le club', `Découvrez le ${name}, club de ${lower} à ${p.city} : notre projet, nos valeurs et nos séances.`),
        scripts: ['assets/js/main.js'],
        sections: [
          { type: 'page_header', id: 'le-club.header', eyebrow: p.tagline, title: 'Le club', lead: [p.audience] },
          { type: 'content', id: 'le-club.presentation', background: 'surface', width: 'narrow', blocks: paragraphs(p.about).map((text) => ({ type: 'text', content: [text] })) },
          { type: 'content', id: 'le-club.valeurs', background: 'cream', blocks: [{ type: 'heading', eyebrow: 'Nos valeurs', title: ['Ce qui nous anime'] }, { type: 'cards', columns: 3, items: valueCards(p.values) }] },
        ],
      },
      {
        id: 'actualites',
        route: '/actualites',
        seo: seo('Actualités', `Actualités du ${name} : vie du club, inscriptions et événements.`),
        scripts: ['assets/js/main.js', 'assets/js/actualites.js'],
        sections: [
          { type: 'page_header', id: 'actualites.header', eyebrow: 'Vie du club', title: 'Actualités', lead: [`Suivez la vie du ${name}.`] },
          {
            type: 'content',
            id: 'actualites.liste',
            background: 'surface',
            blocks: [
              {
                type: 'news_feed',
                variant: 'full',
                empty: { eyebrow: 'Bientôt disponible', title: ['Les actualités arrivent'], text: ['Les premières actualités du club seront publiées ici très prochainement.'] },
                filters: [
                  { key: 'all', label: 'Toutes' },
                  { key: 'club', label: 'Club' },
                  { key: 'inscriptions', label: 'Inscriptions' },
                  { key: 'evenement', label: 'Événements' },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'inscription',
        route: '/inscription',
        seo: seo('Inscription', `Inscription au ${name} : préparez le dossier en ligne, puis complétez-le depuis votre espace famille.`),
        scripts: ['assets/js/main.js', 'assets/js/pdf-inscription.js', 'assets/js/inscription.js', 'assets/js/adresse-autocomplete.js', 'assets/js/naissance-autocomplete.js'],
        sections: [
          {
            type: 'page_header',
            id: 'inscription.header',
            eyebrow: 'Rejoignez le club',
            title: 'Inscription',
            action: { href: '#formulaire', label: 'Remplir le formulaire' },
            lead: ['Saison ', hook('data-saison-text', ['en cours']), ' : trois étapes pour préparer le dossier, puis vous le finalisez depuis votre espace famille.'],
          },
          registrationSection(p),
        ],
      },
      {
        id: 'contact',
        route: '/contact',
        seo: seo('Contact', `Contactez le ${name} : inscriptions, essai, bénévolat ou partenariat.`),
        scripts: ['assets/js/main.js', 'assets/js/contact.js'],
        sections: [
          { type: 'page_header', id: 'contact.header', eyebrow: 'On vous répond vite', title: 'Contact', lead: ['Une question, une envie d’essayer ou de devenir bénévole ? Écrivez-nous.'] },
          {
            type: 'content',
            id: 'contact.main',
            background: 'surface',
            layout: 'split',
            align: 'start',
            columns: [
              {
                type: 'group',
                children: [
                  { type: 'heading', layout: 'none', eyebrow: 'Écrivez-nous', title: ['Envoyer un message'] },
                  {
                    type: 'contact_form',
                    name: { label: 'Votre nom', placeholder: 'Prénom Nom' },
                    email: { label: 'E-mail', placeholder: 'vous@exemple.fr' },
                    subject: { label: 'Sujet', options: ['Inscription ou essai', 'Devenir bénévole', 'Devenir partenaire', 'Autre demande'] },
                    message: { label: 'Message', placeholder: 'Votre message' },
                    consent: ["J'accepte que ces informations soient utilisées uniquement pour traiter ma demande (voir notre ", linkVariant('new-tab', '/confidentialite', 'politique de confidentialité'), ').'],
                    submit: 'Envoyer mon message',
                    sent: { title: 'Message envoyé', text: 'Merci ! Nous vous répondrons par e-mail.' },
                  },
                ],
              },
              {
                type: 'group',
                children: [
                  { type: 'heading', layout: 'none', eyebrow: 'Infos pratiques', title: ['Nous trouver'] },
                  {
                    type: 'info_list',
                    items: [
                      {
                        icon: 'pin',
                        bind: [['data-org-if', 'location.name']],
                        titleBind: [['data-org', 'location.name']],
                        title: [p.venueName],
                        textBind: [['data-org', 'location.address'], ['data-org-if', 'location.address']],
                        text: [p.venueAddress],
                      },
                      { icon: 'clock', bind: [['data-org-if', 'schedule.any']], titleBind: [['data-org-list', 'slots-title']], title: ['Séances'], text: ['Planning de la saison en cours.'] },
                      { icon: 'mail', bind: [['data-org-if', 'org.email']], title: ['E-mail'], text: [mail] },
                      ...(p.phone ? [{ icon: 'phone', bind: [['data-org-if', 'org.phone']], title: ['Téléphone'], text: [{ link: { href: `tel:${telOf(p.phone)}`, bind: [['data-org', 'org.phone'], ['data-org-attr', 'href:org.tel']], children: [p.phone] } }] }] : []),
                    ],
                  },
                  { type: 'map', labels: { show: 'Afficher la carte ici', open: 'Ouvrir dans Google Maps', note: 'Afficher la carte ici charge Google Maps, qui dépose des cookies.' } },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'mentions-legales',
        route: '/mentions-legales',
        seo: seo('Mentions légales', `Mentions légales du site du ${name}.`),
        scripts: ['assets/js/main.js'],
        sections: [{ type: 'page_header', id: 'mentions-legales.header', eyebrow: 'Informations légales', title: 'Mentions légales', lead: ['Éditeur du site, hébergement et propriété intellectuelle.'] }, ...mentions(p)],
      },
      {
        id: 'confidentialite',
        route: '/confidentialite',
        seo: seo('Confidentialité', `Comment le ${name} collecte, utilise et protège vos données.`),
        scripts: ['assets/js/main.js'],
        sections: [{ type: 'page_header', id: 'confidentialite.header', eyebrow: 'Vos données', title: 'Politique de confidentialité', lead: ['Comment nous collectons, utilisons et protégeons vos informations.'] }, ...privacy(p)],
      },
      {
        id: 'introuvable',
        route: '/404',
        seo: { title: `Page introuvable | ${name}`, robots: 'noindex, follow' },
        footer: 'minimal',
        sections: [
          { type: 'page_header', id: 'introuvable.header', eyebrow: 'Erreur 404', title: 'Page introuvable', lead: ['Cette page n’existe pas ou plus.'] },
          { type: 'content', id: 'introuvable.retour', background: 'surface', textAlign: 'center', blocks: [{ type: 'button', href: '/', label: "Retour à l'accueil", style: 'primary' }] },
        ],
      },
    ],
  };
}

