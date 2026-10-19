// Page « Erreur 403 » (2026-10-16), d'après une maquette fournie par l'utilisateur, adaptée à la charte du club (bordeaux
// et or, polices du site) et à la CSP (aucune bibliothèque externe, aucun script en ligne : assets/js/erreur-403.js).
// Servie par le middleware racine (security-headers.js) à la place d'un 403 en texte brut quand un navigateur demande une
// page HTML : formulaire envoyé depuis un autre site, lien de session admin invalide, etc. Coordonnées réelles du club.

export function forbiddenPageHtml() {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Accès refusé — Club Démo</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/assets/images/favicon.ico">
<meta name="theme-color" content="#4f1414">
<link rel="preload" href="/assets/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/oswald.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/styles.css?v=03b73c8724">
<link rel="stylesheet" href="/assets/css/erreur.css?v=ec4245f37c">
</head>
<body class="err-page">
<a href="#main" class="skip-link">Aller au contenu</a>
<header class="site-header">
  <div class="container">
    <a href="/" class="brand">
      <img src="/assets/images/logo-96.webp" alt="Blason du Club Démo" width="48" height="48">
      <span class="brand-name"><strong>Club Démo</strong><span>Club de démonstration</span></span>
    </a>
  </div>
</header>

<main id="main" class="err-main">
  <div class="container err-wrap">
    <div class="err-code" aria-hidden="true">
      <span>4</span>
      <button type="button" class="err-card" id="err-card" aria-label="Coup de sifflet">
        <span class="err-card-top">DEMO</span>
        <span class="err-card-label">Carton rouge</span>
        <span class="err-card-bottom">403</span>
      </button>
      <span>3</span>
    </div>

    <span class="eyebrow">Erreur 403</span>
    <h1>Carton rouge ! <em>Vous êtes hors-jeu.</em></h1>
    <p class="err-lead">Cette page est réservée aux responsables du club, ou la demande n'a pas pu être acceptée (lien ouvert depuis un autre site, session expirée…). Revenez sur le terrain, ou réessayez depuis le site.</p>

    <div class="err-actions">
      <a href="/" class="btn btn-primary">Retour à l'accueil</a>
      <a href="/contact" class="btn btn-ghost-dark">Contacter le club</a>
    </div>

    <ul class="err-contact">
      <li><span>Stade municipal, 1 rue du Stade, Sportville</span></li>
      <li><span>contact@clubdemo.licyo.fr</span><button type="button" class="err-copy" data-copy="contact@clubdemo.licyo.fr">Copier</button></li>
      <li><span>06 00 00 00 00</span></li>
    </ul>

    <section class="err-game" aria-labelledby="err-game-title">
      <div class="err-game-head">
        <h2 id="err-game-title">En attendant : jongle avec le ballon</h2>
        <p class="err-score">Score <strong id="err-score">0</strong> · Record <strong id="err-best">0</strong></p>
      </div>
      <div class="err-pitch">
        <canvas id="err-canvas" aria-label="Mini-jeu de jongles : touchez le ballon pour le garder en l'air"></canvas>
        <p class="err-hint" id="err-hint">Touchez le ballon pour le garder en l'air !</p>
      </div>
      <button type="button" class="err-reset" id="err-reset">Recommencer</button>
    </section>
  </div>
</main>

<footer class="err-footer">
  <div class="container"><p>© Club Démo · <a href="/mentions-legales">Mentions légales</a> · <a href="/confidentialite">Confidentialité</a></p></div>
</footer>
<script src="/assets/js/erreur-403.js?v=68399bc36f" defer></script>
</body>
</html>
`;
}

// Remplace le corps d'un 403 en texte brut par la page, pour une navigation de navigateur seulement (Accept text/html),
// jamais pour l'API ni pour une réponse déjà en HTML.
export function shouldServeForbiddenPage(request, response) {
  if (response.status !== 403) return false;
  const { pathname } = new URL(request.url);
  if (pathname.startsWith('/api/')) return false;
  if (/text\/html/i.test(response.headers.get('Content-Type') || '')) return false;
  return /text\/html/i.test(request.headers.get('Accept') || '');
}
